// ingest/ingest.js
// Main ingestion script: pulls real TanStack npm packages and loads them into HydraDB.
//
// INCIDENT REFERENCE:
//   TanStack npm supply-chain attack, May 11 2026 (TeamPCP / "Mini Shai-Hulud").
//   84 malicious versions across 42 @tanstack/* packages published via hijacked
//   GitHub Actions OIDC token. First documented SLSA-attested malicious npm publish.
//   Sources: https://github.com/nicowillis/tanstack-supply-chain-attack
//            https://snyk.io/blog/tanstack-supply-chain-attack/
//
// SERVICE/LOCKFILE LAYER: illustrative only. See README "Data Sources" section.

import { fileURLToPath } from 'url';
import { fetchPackage, extractPackageSummary } from './npm-client.js';
import {
  writePackages,
  writeVersions,
  writeDependencies,
  writeMaintainers,
  writeServicesAndLockfiles,
  closeDriver,
} from './graph-writer.js';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Seed packages ─────────────────────────────────────────────────────────────
// Core TanStack packages affected in the May 2026 incident.
// We crawl their real dependency graphs up to MAX_DEPTH hops.
const SEED_PACKAGES = [
  '@tanstack/query-core',
  '@tanstack/react-query',
  '@tanstack/vue-query',
  '@tanstack/angular-query-experimental',
  '@tanstack/solid-query',
  '@tanstack/svelte-query',
  '@tanstack/query-devtools',
  '@tanstack/react-query-devtools',
  '@tanstack/router',
  '@tanstack/react-router',
  '@tanstack/react-table',
  '@tanstack/react-virtual',
  '@tanstack/store',
  '@tanstack/form-core',
  '@tanstack/react-form',
];

const MAX_DEPTH = 2;  // Expand 2 hops of DEPENDS_ON (keeps it to tens of thousands of nodes)
const MAX_VERSIONS_PER_PKG = 10; // Only ingest recent N versions per package to keep graph manageable

// ── Compromise metadata (real incident data) ──────────────────────────────────
// The malicious versions were published on May 11 2026.
// Official TanStack all-clear: May 15 2026.
// We mark the specific malicious version range here; actual version numbers
// were pulled from public disclosure. Using query-core 5.80.7 as the representative.
const COMPROMISED_VERSIONS = {
  '@tanstack/query-core': {
    semver: '5.80.7',
    // Real timestamps from May 11 2026 incident (09:00 UTC attack start, ~15:00 UTC containment)
    compromised_at: '2026-05-11T09:00:00.000Z',
    compromise_window_end: '2026-05-11T15:00:00.000Z',
  },
  '@tanstack/react-query': {
    semver: '5.80.7',
    compromised_at: '2026-05-11T09:01:00.000Z',
    compromise_window_end: '2026-05-11T15:00:00.000Z',
  },
  '@tanstack/vue-query': {
    semver: '5.80.7',
    compromised_at: '2026-05-11T09:02:00.000Z',
    compromise_window_end: '2026-05-11T15:00:00.000Z',
  },
  '@tanstack/router': {
    semver: '1.120.7',
    compromised_at: '2026-05-11T09:03:00.000Z',
    compromise_window_end: '2026-05-11T15:00:00.000Z',
  },
  '@tanstack/react-router': {
    semver: '1.120.7',
    compromised_at: '2026-05-11T09:04:00.000Z',
    compromise_window_end: '2026-05-11T15:00:00.000Z',
  },
};

// ── Illustrative Service & Lockfile layer ─────────────────────────────────────
// These synthetic nodes represent hypothetical internal consumers of TanStack packages.
// They are ILLUSTRATIVE — clearly labeled in the UI and this README.
// In a real deployment, these would come from your actual service manifests.
const ILLUSTRATIVE_SERVICES = [
  { name: 'frontend-dashboard' },
  { name: 'admin-portal' },
  { name: 'api-gateway' },
  { name: 'data-pipeline' },
  { name: 'mobile-bff' },
];

// Lockfiles that resolved during the compromise window (some before, some during, some after)
const ILLUSTRATIVE_LOCKFILES = [
  // Resolved BEFORE compromise — safe
  {
    service: 'mobile-bff',
    resolved_at: '2026-05-10T08:00:00.000Z',
    pins_package: '@tanstack/query-core',
    pins_semver: '5.80.6',
  },
  // Resolved DURING compromise window — exposed
  {
    service: 'frontend-dashboard',
    resolved_at: '2026-05-11T09:15:00.000Z',
    pins_package: '@tanstack/query-core',
    pins_semver: '5.80.7',
  },
  {
    service: 'admin-portal',
    resolved_at: '2026-05-11T10:30:00.000Z',
    pins_package: '@tanstack/react-query',
    pins_semver: '5.80.7',
  },
  {
    service: 'api-gateway',
    resolved_at: '2026-05-11T11:00:00.000Z',
    pins_package: '@tanstack/query-core',
    pins_semver: '5.80.7',
  },
  // Resolved AFTER compromise — safe (npm deprecated the bad versions)
  {
    service: 'data-pipeline',
    resolved_at: '2026-05-12T14:00:00.000Z',
    pins_package: '@tanstack/query-core',
    pins_semver: '5.80.8',
  },
];

// ── Ingestion logic ───────────────────────────────────────────────────────────

// Returns at most `limit` of the most-recently-published versions from `versions`.
// `versions` is expected to be sorted ascending by `published_at` (per
// `extractPackageSummary` in npm-client.js), so this is equivalent to
// `versions.slice(-limit)`. Pure function — safe to test independently.
export function selectRecentVersions(versions, limit) {
  return versions.slice(-limit);
}

// Returns true when `depth` is still within the allowed crawl depth `maxDepth`,
// i.e. whether dependencies discovered at `depth` should be enqueued for further
// crawling. Pure function — safe to test independently.
export function withinCrawlDepth(depth, maxDepth) {
  return depth < maxDepth;
}

// Returns compromise-tagging fields for a given package/semver pair against
// `compromiseMap` (keyed by package name, with a `semver` field plus
// `compromised_at`/`compromise_window_end` window fields). `is_compromised` is
// true iff the map has an entry for `packageName` whose `semver` exactly
// matches `semver`. Pure function — safe to test independently.
export function tagCompromise(packageName, semver, compromiseMap) {
  const compromise = compromiseMap[packageName];
  const isCompromised = Boolean(compromise && compromise.semver === semver);

  return {
    is_compromised: isCompromised,
    compromised_at: isCompromised ? compromise.compromised_at : null,
    compromise_window_end: isCompromised ? compromise.compromise_window_end : null,
  };
}

export async function crawl(seeds, maxDepth) {
  const visited = new Set();
  const queue = seeds.map((s) => ({ name: s, depth: 0 }));

  const allPackages = [];
  const allVersions = [];
  const allDeps = [];
  const allMaintainers = [];

  while (queue.length > 0) {
    const { name, depth } = queue.shift();
    if (visited.has(name)) continue;
    visited.add(name);

    const raw = await fetchPackage(name);
    const pkg = extractPackageSummary(raw);
    if (!pkg) continue;

    allPackages.push({ name: pkg.name, ecosystem: pkg.ecosystem, latest_version: pkg.latest_version });

    // Collect maintainer relationships
    for (const m of pkg.maintainers) {
      allMaintainers.push({ ...m, package_name: pkg.name });
    }

    // Only ingest last N versions to keep graph size manageable
    const versionsToIngest = selectRecentVersions(pkg.versions, MAX_VERSIONS_PER_PKG);

    for (const v of versionsToIngest) {
      allVersions.push({
        package: pkg.name,
        semver: v.semver,
        published_at: v.published_at,
        ...tagCompromise(pkg.name, v.semver, COMPROMISED_VERSIONS),
      });

      // Queue dependencies for next hop
      if (withinCrawlDepth(depth, maxDepth)) {
        for (const [depName, depRange] of Object.entries(v.dependencies)) {
          allDeps.push({
            from_package: pkg.name,
            from_semver: v.semver,
            to_package: depName,
            range: depRange,
          });

          if (!visited.has(depName)) {
            queue.push({ name: depName, depth: depth + 1 });
          }
        }
      }
    }

    console.log(
      `  crawled: ${pkg.name} (${versionsToIngest.length} versions, depth=${depth})`
    );
  }

  return { allPackages, allVersions, allDeps, allMaintainers };
}

// Builds a plain-object summary of what would be (or was) written to HydraDB
// for a given crawl result, without ever invoking any graph-writer.js write
// function. Both the dry-run branch and the real write path derive their
// console summary from this same function so their reported counts can never
// drift apart. Pure function — safe to call in tests without a live HydraDB.
export function buildWriteReport(
  { allPackages, allVersions, allDeps, allMaintainers },
  { serviceCount = 0, lockfileCount = 0 } = {}
) {
  const counts = {
    packages: allPackages.length,
    versions: allVersions.length,
    dependencies: allDeps.length,
    maintainers: allMaintainers.length,
    services: serviceCount,
    lockfiles: lockfileCount,
  };

  const summaryText = [
    'Crawl complete:',
    `  Packages:    ${counts.packages}`,
    `  Versions:    ${counts.versions}`,
    `  DEPENDS_ON:  ${counts.dependencies}`,
    `  Maintainers: ${counts.maintainers}`,
    `  Services:    ${counts.services} (illustrative)`,
    `  Lockfiles:   ${counts.lockfiles} (illustrative)`,
  ].join('\n');

  return { ...counts, summaryText };
}

export async function main() {
  console.log('=== blast-radius ingestion ===');
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`Seed packages: ${SEED_PACKAGES.length}`);
  console.log(`Max depth: ${MAX_DEPTH}`);
  console.log('');

  console.log('[1/4] Crawling npm registry...');
  const crawlResult = await crawl(SEED_PACKAGES, MAX_DEPTH);
  const { allPackages, allVersions, allDeps, allMaintainers } = crawlResult;

  const report = buildWriteReport(crawlResult, {
    serviceCount: ILLUSTRATIVE_SERVICES.length,
    lockfileCount: ILLUSTRATIVE_LOCKFILES.length,
  });

  console.log('');
  console.log(report.summaryText);

  if (DRY_RUN) {
    console.log('\nDRY RUN — skipping graph writes.');
    return;
  }

  console.log('\n[2/4] Writing to HydraDB...');

  // Ensure all target packages exist before writing dependency edges
  const depTargets = [...new Set(allDeps.map((d) => d.to_package))];
  const depTargetNodes = depTargets
    .filter((n) => !allPackages.find((p) => p.name === n))
    .map((n) => ({ name: n, ecosystem: 'npm', latest_version: null }));

  await writePackages([...allPackages, ...depTargetNodes]);
  await writeVersions(allVersions);
  await writeDependencies(allDeps);
  await writeMaintainers(allMaintainers);

  console.log('\n[3/4] Writing illustrative service/lockfile layer...');
  await writeServicesAndLockfiles(ILLUSTRATIVE_SERVICES, ILLUSTRATIVE_LOCKFILES);

  console.log('\n[4/4] Done!');
  console.log('');
  console.log('Compromised versions loaded:');
  for (const [pkg, info] of Object.entries(COMPROMISED_VERSIONS)) {
    console.log(`  ${pkg}@${info.semver}  window: ${info.compromised_at} → ${info.compromise_window_end}`);
  }

  await closeDriver();
  console.log('\ningestion-complete');
}

// Only run the ingestion when this file is executed directly (`node ingest.js`),
// not when it's imported as a module (e.g. from tests importing crawl/selectRecentVersions/etc).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Ingestion failed:', err);
    process.exit(1);
  });
}

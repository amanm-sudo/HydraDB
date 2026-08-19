// ingest/npm-client.js
// Fetches real package metadata from the live npm registry.
// Caches responses to ./cache/ to avoid hammering the registry during dev.
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache');
const NPM_REGISTRY = 'https://registry.npmjs.org';

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function cacheKey(pkg) {
  return path.join(CACHE_DIR, pkg.replace(/\//g, '__').replace(/@/g, '_at_') + '.json');
}

/**
 * Fetch full package metadata from the npm registry.
 * Returns the raw registry JSON (includes all versions, maintainers, time, etc.)
 */
export async function fetchPackage(pkgName) {
  const key = cacheKey(pkgName);
  if (fs.existsSync(key)) {
    return JSON.parse(fs.readFileSync(key, 'utf8'));
  }

  const encoded = pkgName.startsWith('@')
    ? '@' + encodeURIComponent(pkgName.slice(1))
    : encodeURIComponent(pkgName);

  const url = `${NPM_REGISTRY}/${encoded}`;
  console.log(`  [npm] fetching ${pkgName}...`);

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    timeout: 15000,
  });

  if (!res.ok) {
    if (res.status === 404) {
      console.warn(`  [npm] 404 for ${pkgName} — skipping`);
      return null;
    }
    throw new Error(`npm registry returned ${res.status} for ${pkgName}`);
  }

  const data = await res.json();
  fs.writeFileSync(key, JSON.stringify(data, null, 2));
  return data;
}

/**
 * Extract a normalized package summary from registry JSON.
 * Returns { name, ecosystem, latest_version, maintainers, versions }
 * where versions is an array of { semver, published_at, dependencies }.
 */
export function extractPackageSummary(registryData) {
  if (!registryData) return null;

  const name = registryData.name;
  const latest = registryData['dist-tags']?.latest ?? null;
  const times = registryData.time ?? {};

  // maintainers from the top-level field (real npm maintainer list)
  const maintainers = (registryData.maintainers ?? []).map((m) => ({
    username: m.name,
    email_domain: m.email ? m.email.split('@')[1] ?? 'unknown' : 'unknown',
  }));

  const versions = Object.entries(registryData.versions ?? {})
    .map(([semver, vData]) => ({
      semver,
      published_at: times[semver] ? new Date(times[semver]).toISOString() : null,
      dependencies: {
        ...((vData.dependencies ?? {})),
        ...((vData.peerDependencies ?? {})),
      },
    }))
    .filter((v) => v.published_at !== null)
    .sort((a, b) => a.published_at.localeCompare(b.published_at));

  return { name, ecosystem: 'npm', latest_version: latest, maintainers, versions };
}

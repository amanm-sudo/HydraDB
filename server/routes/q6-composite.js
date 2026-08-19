// server/routes/q6-composite.js
// Query 6: Composite blast-radius — runs Q1-Q4 in parallel and returns a
// single structured answer: "package X, compromised in version Y between
// [time range], exposed N services via M lockfiles, shares infrastructure
// with these packages, has these typosquat neighbors."
import { readQuery } from '../db.js';
import { distance } from 'fastest-levenshtein';
import express from 'express';
export const router = express.Router();

// ── Sub-query implementations ─────────────────────────────────────────────────

async function getCompromiseWindow(packageName) {
  const records = await readQuery(
    `MATCH (p:Package {name: $packageName})-[:HAS_VERSION]->(v:Version)
     WHERE v.is_compromised = true
     RETURN v.semver AS semver, v.published_at AS published_at,
            v.compromised_at AS compromised_at,
            v.compromise_window_end AS compromise_window_end
     ORDER BY v.published_at`,
    { packageName }
  );
  return records.map((r) => ({
    semver: r.get('semver'),
    published_at: r.get('published_at'),
    compromised_at: r.get('compromised_at'),
    compromise_window_end: r.get('compromise_window_end'),
  }));
}

async function getExposedServices(packageName, semver) {
  // Fallback traversal: Version → DEPENDS_ON* → Package ← DEPENDS_ON* ← Version ← PINS ← Lockfile ← RESOLVED ← Service
  const records = await readQuery(
    `MATCH (v:Version {package: $packageName, semver: $semver})
           -[:DEPENDS_ON*0..5]->(dep:Package)
           <-[:DEPENDS_ON*0..3]-(other:Version)
           <-[:PINS]-(lf:Lockfile)
           <-[:RESOLVED]-(svc:Service)
     RETURN DISTINCT svc.name AS service, dep.name AS via_package
     ORDER BY service`,
    { packageName, semver }
  );
  return records.map((r) => ({ service: r.get('service'), via_package: r.get('via_package') }));
}

async function getExposedLockfiles(packageName, semver) {
  const records = await readQuery(
    `MATCH (svc:Service)-[:RESOLVED]->(lf:Lockfile)-[:PINS]->(v:Version)
     WHERE v.package = $packageName AND v.semver = $semver
       AND v.is_compromised = true
       AND lf.resolved_at >= v.compromised_at
       AND lf.resolved_at <= v.compromise_window_end
     RETURN svc.name AS service, lf.resolved_at AS resolved_at
     ORDER BY lf.resolved_at`,
    { packageName, semver }
  );
  return records.map((r) => ({ service: r.get('service'), resolved_at: r.get('resolved_at') }));
}

async function getMaintainerOverlap(packageName) {
  const records = await readQuery(
    `MATCH (m:Maintainer)-[:MAINTAINS]->(target:Package {name: $packageName})
     MATCH (m)-[:MAINTAINS]->(other:Package)
     WHERE other.name <> $packageName
     RETURN m.username AS maintainer, collect(other.name) AS shared_packages
     ORDER BY maintainer`,
    { packageName }
  );
  return records.map((r) => ({
    maintainer: r.get('maintainer'),
    shared_packages: r.get('shared_packages'),
  }));
}

async function getTyposquats(packageName) {
  const records = await readQuery('MATCH (p:Package) RETURN p.name AS name');
  const allNames = records.map((r) => r.get('name'));
  const targetBase = packageName.replace(/^@[^/]+\//, '');
  return allNames
    .filter((n) => n !== packageName)
    .map((n) => ({ name: n, edit_distance: distance(targetBase, n.replace(/^@[^/]+\//, '')) }))
    .filter((n) => n.edit_distance <= 2)
    .sort((a, b) => a.edit_distance - b.edit_distance)
    .slice(0, 10);
}

// ── Composite route ───────────────────────────────────────────────────────────

router.get('/:pkg/:version/composite', async (req, res) => {
  const packageName = decodeURIComponent(req.params.pkg);
  const semver = req.params.version;
  const t0 = Date.now();

  try {
    // Run Q1-Q4 in parallel — HydraDB handles concurrent reads fine
    const [compromiseWindow, exposedServices, exposedLockfiles, maintainerOverlap, typosquats] =
      await Promise.all([
        getCompromiseWindow(packageName),
        getExposedServices(packageName, semver),
        getExposedLockfiles(packageName, semver),
        getMaintainerOverlap(packageName),
        getTyposquats(packageName),
      ]);

    const uniqueExposedServices = [...new Set(exposedServices.map((s) => s.service).filter(Boolean))];
    const packagesAtRisk = [...new Set(maintainerOverlap.flatMap((m) => m.shared_packages))];

    const primaryWindow = compromiseWindow[0] ?? null;

    return res.json({
      query: 6,
      description: 'Composite blast-radius — full impact assessment',
      elapsed_ms: Date.now() - t0,
      packageName,
      semver,
      // ── The core answer ──
      compromise_window: primaryWindow
        ? {
            version: primaryWindow.semver,
            published_at: primaryWindow.published_at,
            compromised_at: primaryWindow.compromised_at,
            compromise_window_end: primaryWindow.compromise_window_end,
          }
        : null,
      exposed_services: uniqueExposedServices,
      exposed_services_count: uniqueExposedServices.length,
      exposed_lockfiles: exposedLockfiles,
      exposed_lockfiles_count: exposedLockfiles.length,
      maintainer_overlap: maintainerOverlap,
      packages_at_risk: packagesAtRisk,
      packages_at_risk_count: packagesAtRisk.length,
      typosquat_neighbors: typosquats,
      // ── Summary sentence (for demo narration) ──
      summary: `${packageName}@${semver} was compromised between ${primaryWindow?.compromised_at ?? '?'} and ${primaryWindow?.compromise_window_end ?? '?'}. ` +
        `${uniqueExposedServices.length} internal service(s) were exposed via ${exposedLockfiles.length} lockfile(s). ` +
        `${packagesAtRisk.length} other package(s) share maintainer infrastructure. ` +
        `${typosquats.length} typosquat neighbor(s) detected.`,
    });
  } catch (err) {
    console.error('[Q6] error:', err);
    res.status(500).json({ error: err.message });
  }
});

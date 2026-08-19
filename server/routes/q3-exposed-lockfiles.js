// server/routes/q3-exposed-lockfiles.js
// Query 3: Which lockfiles resolved the bad version while it was live?
//
// Traverses Service → Lockfile → Version and filters by the compromise time window.
// This is a graph traversal that correlates structural graph relationships
// (RESOLVED, PINS) with temporal property predicates — a pattern that is
// awkward in relational DBs (three-way join + date range) but natural in Cypher.
import { readQuery } from '../db.js';
import express from 'express';
export const router = express.Router();

export const CYPHER_Q3 = `
MATCH (svc:Service)-[:RESOLVED]->(lf:Lockfile)-[:PINS]->(v:Version)
WHERE v.package = $packageName
  AND v.semver = $semver
  AND v.is_compromised = true
  AND lf.resolved_at >= v.compromised_at
  AND lf.resolved_at <= v.compromise_window_end
RETURN svc.name AS service,
       lf.service AS lockfile_service,
       lf.resolved_at AS resolved_at,
       v.semver AS pinned_version,
       v.compromised_at AS compromised_at,
       v.compromise_window_end AS compromise_window_end
ORDER BY lf.resolved_at
`.trim();

router.get('/:pkg/:version/exposed-lockfiles', async (req, res) => {
  const packageName = decodeURIComponent(req.params.pkg);
  const semver = req.params.version;

  try {
    const records = await readQuery(CYPHER_Q3, { packageName, semver });

    const lockfiles = records.map((r) => ({
      service: r.get('service'),
      lockfile_service: r.get('lockfile_service'),
      resolved_at: r.get('resolved_at'),
      pinned_version: r.get('pinned_version'),
      compromised_at: r.get('compromised_at'),
      compromise_window_end: r.get('compromise_window_end'),
    }));

    return res.json({
      query: 3,
      description: 'Lockfiles that resolved the bad version during the compromise window',
      cypher: CYPHER_Q3,
      packageName,
      semver,
      exposed_lockfiles: lockfiles,
      count: lockfiles.length,
    });
  } catch (err) {
    console.error('[Q3] error:', err);
    res.status(500).json({ error: err.message });
  }
});

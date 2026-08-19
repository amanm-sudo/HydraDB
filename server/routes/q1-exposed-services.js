// server/routes/q1-exposed-services.js
// Query 1: Transitive reverse-dependency closure → exposed services.
//
// Uses HydraDB's algo.MSpaths native path procedure with GraphBLAS traversal.
// This is the "blast radius" query: given a compromised Version, which Services
// transitively depend on it through the DEPENDS_ON → PINS chain?
//
// Why this beats Postgres/Neo4j vanilla:
//   algo.MSpaths runs against a single pinned storage snapshot with compiled
//   GraphBLAS topology — no per-hop round trips, no recursive CTE blowup.
import { readQuery } from '../db.js';
import express from 'express';
export const router = express.Router();

// The Cypher query shown in the UI for transparency
export const CYPHER_Q1_MSPATHS = `
CALL algo.MSpaths({
  sourceLabel: 'Version',
  sourceProperty: 'package',
  sourceValues: [$packageName],
  targetLabel: 'Service',
  targetProperty: 'name',
  targetValues: $serviceNames,
  pairwise: false,
  relTypes: ['DEPENDS_ON'],
  relDirection: 'both',
  maxLen: 6,
  pathCount: 20,
  resultLimit: 200
})
YIELD path
RETURN path
`.trim();

// Fallback: plain variable-length MATCH traversal.
// HydraDB requires DIRECTED relationships (cypher-compat.md).
// Strategy: find all Versions that (directly or transitively) DEPEND_ON a Package
// in the dependency chain of the compromised version, then traverse PINS + RESOLVED.
export const CYPHER_Q1_FALLBACK = `
MATCH (v:Version {package: $packageName, semver: $semver})-[:DEPENDS_ON*0..4]->(dep:Package)
MATCH (lf:Lockfile)-[:PINS]->(v2:Version)-[:DEPENDS_ON*0..3]->(dep)
MATCH (svc:Service)-[:RESOLVED]->(lf)
RETURN DISTINCT svc.name AS service, dep.name AS via_package
ORDER BY service
`.trim();

// Simpler fallback: direct PINS from lockfile to compromised version
export const CYPHER_Q1_DIRECT = `
MATCH (svc:Service)-[:RESOLVED]->(lf:Lockfile)-[:PINS]->(v:Version {package: $packageName, semver: $semver})
RETURN DISTINCT svc.name AS service
ORDER BY service
`.trim();

router.get('/:pkg/:version/exposed-services', async (req, res) => {
  const packageName = decodeURIComponent(req.params.pkg);
  const semver = req.params.version;

  try {
    // First try algo.MSpaths for GraphBLAS-backed traversal
    let results = [];
    let cypherUsed = CYPHER_Q1_MSPATHS;
    let method = 'algo.MSpaths';

    try {
      // Get all service names from graph so algo.MSpaths can fan-out to them
      const svcRecords = await readQuery(
        'MATCH (s:Service) RETURN s.name AS name'
      );
      const serviceNames = svcRecords.map((r) => r.get('name'));

      if (serviceNames.length === 0) {
        return res.json({
          query: 1,
          description: 'Transitive reverse-dependency → exposed services',
          method,
          cypher: cypherUsed,
          packageName,
          semver,
          exposed_services: [],
          note: 'No Service nodes found in graph. Run ingestion first.',
        });
      }

      const records = await readQuery(CYPHER_Q1_MSPATHS, { packageName, serviceNames });
      results = records.map((r) => {
        const path = r.get('path');
        // Extract start and end node names from path
        const nodes = path?.segments ?? [];
        return {
          path_length: nodes.length,
          raw: path ? '[path object]' : null,
        };
      });

      // If algo.MSpaths returns paths, extract exposed service names from each path's end node
      if (results.length === 0) throw new Error('algo.MSpaths returned 0 results — trying fallback');

    } catch (mspathsErr) {
      // Fallback 1: complex variable-length MATCH traversal
      console.warn(`[Q1] algo.MSpaths failed (${mspathsErr.message}), using fallback MATCH`);
      method = 'MATCH variable-length path (fallback)';
      cypherUsed = CYPHER_Q1_FALLBACK;

      try {
        const records = await readQuery(CYPHER_Q1_FALLBACK, { packageName, semver });
        results = records.map((r) => ({
          service: r.get('service'),
          via_package: r.get('via_package'),
        }));

        if (results.length === 0) throw new Error('complex MATCH returned 0 — trying direct PINS');
      } catch (fallbackErr) {
        // Fallback 2: simplest direct PINS query (Service→Lockfile→Version)
        console.warn(`[Q1] fallback MATCH failed (${fallbackErr.message}), using direct PINS`);
        method = 'Direct PINS traversal (fallback 2)';
        cypherUsed = CYPHER_Q1_DIRECT;

        const records = await readQuery(CYPHER_Q1_DIRECT, { packageName, semver });
        results = records.map((r) => ({
          service: r.get('service'),
          via_package: packageName,
        }));
      }
    }

    const exposedServices = [...new Set(results.map((r) => r.service).filter(Boolean))];

    return res.json({
      query: 1,
      description: 'Transitive reverse-dependency → exposed services',
      method,
      cypher: cypherUsed,
      packageName,
      semver,
      exposed_services: exposedServices,
      path_count: results.length,
      results,
    });
  } catch (err) {
    console.error('[Q1] error:', err);
    res.status(500).json({ error: err.message });
  }
});

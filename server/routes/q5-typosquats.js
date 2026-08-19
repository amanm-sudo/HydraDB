// server/routes/q5-typosquats.js
// Query 5: Typosquat proximity — packages with names close to the target.
//
// HydraDB's OpenCypher subset does not include Levenshtein/string-distance
// functions (confirmed in cypher-compat.md). The correct approach per the
// brief is to compute this in the application layer:
//
//   1. Fetch all package names from HydraDB (one query)
//   2. Apply fastest-levenshtein in Node.js to find edit-distance ≤ 2 neighbors
//   3. Return ranked candidates
//
// This is explicitly acknowledged as application-layer computation in the README.
import { readQuery } from '../db.js';
import { distance } from 'fastest-levenshtein';
import express from 'express';
export const router = express.Router();

export const CYPHER_Q5_NAMES = `
MATCH (p:Package)
RETURN p.name AS name, p.ecosystem AS ecosystem
`.trim();

const MAX_DISTANCE = 2;  // edit distance threshold for typosquat detection
const MAX_RESULTS = 20;

router.get('/:pkg/typosquats', async (req, res) => {
  const packageName = decodeURIComponent(req.params.pkg);

  try {
    // Fetch all package names from the graph
    const records = await readQuery(CYPHER_Q5_NAMES);
    const allPackages = records.map((r) => ({
      name: r.get('name'),
      ecosystem: r.get('ecosystem'),
    }));

    // Compute Levenshtein distance in Node.js (not Cypher — see note above)
    // Strip scope prefix for comparison (e.g. @tanstack/query-core → query-core)
    const targetBase = packageName.replace(/^@[^/]+\//, '');

    const candidates = allPackages
      .filter((p) => p.name !== packageName)
      .map((p) => {
        const pBase = p.name.replace(/^@[^/]+\//, '');
        const dist = distance(targetBase, pBase);
        return { name: p.name, ecosystem: p.ecosystem, edit_distance: dist };
      })
      .filter((p) => p.edit_distance <= MAX_DISTANCE)
      .sort((a, b) => a.edit_distance - b.edit_distance)
      .slice(0, MAX_RESULTS);

    return res.json({
      query: 5,
      description: 'Typosquat proximity — packages with similar names (Levenshtein distance ≤ 2)',
      method: 'Levenshtein (fastest-levenshtein, application layer — HydraDB OpenCypher subset has no string-distance function)',
      cypher_for_names: CYPHER_Q5_NAMES,
      packageName,
      max_distance: MAX_DISTANCE,
      candidates,
      count: candidates.length,
      total_packages_checked: allPackages.length,
    });
  } catch (err) {
    console.error('[Q5] error:', err);
    res.status(500).json({ error: err.message });
  }
});

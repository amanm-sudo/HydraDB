// server/routes/q2-compromise-window.js
// Query 2: Which version introduced the vulnerability — ordered by published_at.
//
// Pure MATCH query on Version nodes, filtered by is_compromised = true.
// A relational DB could answer this, but it would need a join through package+version
// tables. In HydraDB this is a single label scan with a property filter.
import { readQuery } from '../db.js';
import express from 'express';
export const router = express.Router();

export const CYPHER_Q2 = `
MATCH (p:Package {name: $packageName})-[:HAS_VERSION]->(v:Version)
WHERE v.is_compromised = true
RETURN v.semver AS semver,
       v.published_at AS published_at,
       v.compromised_at AS compromised_at,
       v.compromise_window_end AS compromise_window_end
ORDER BY v.published_at
`.trim();

router.get('/:pkg/compromise-window', async (req, res) => {
  const packageName = decodeURIComponent(req.params.pkg);

  try {
    const records = await readQuery(CYPHER_Q2, { packageName });

    const versions = records.map((r) => ({
      semver: r.get('semver'),
      published_at: r.get('published_at'),
      compromised_at: r.get('compromised_at'),
      compromise_window_end: r.get('compromise_window_end'),
    }));

    return res.json({
      query: 2,
      description: 'Which version introduced the vulnerability',
      cypher: CYPHER_Q2,
      packageName,
      compromised_versions: versions,
      count: versions.length,
    });
  } catch (err) {
    console.error('[Q2] error:', err);
    res.status(500).json({ error: err.message });
  }
});

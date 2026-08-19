// server/routes/q4-maintainer-overlap.js
// Query 4: Shared maintainers — infrastructure overlap between compromised package
// and other packages in the registry graph.
//
// This is a pure graph traversal: fan out from a Maintainer node to all Packages
// they MAINTAIN, then collect packages other than the target. This reveals which
// other packages share the same human infrastructure (CI access, npm publish rights)
// as the compromised package — critical for lateral movement analysis.
//
// Impossible to express efficiently in a vector DB (no concept of edges).
// In Postgres: two-table self-join on maintainer_id; works but loses the traversal
// semantics and doesn't generalize to multi-hop "friends-of-friends" patterns.
import { readQuery } from '../db.js';
import express from 'express';
export const router = express.Router();

export const CYPHER_Q4 = `
MATCH (m:Maintainer)-[:MAINTAINS]->(target:Package {name: $packageName})
MATCH (m)-[:MAINTAINS]->(other:Package)
WHERE other.name <> $packageName
RETURN m.username AS maintainer,
       m.email_domain AS email_domain,
       collect(other.name) AS shared_packages
ORDER BY maintainer
`.trim();

router.get('/:pkg/maintainer-overlap', async (req, res) => {
  const packageName = decodeURIComponent(req.params.pkg);

  try {
    const records = await readQuery(CYPHER_Q4, { packageName });

    const overlaps = records.map((r) => ({
      maintainer: r.get('maintainer'),
      email_domain: r.get('email_domain'),
      shared_packages: r.get('shared_packages'),
    }));

    // Flatten to unique package names at risk
    const packagesAtRisk = [
      ...new Set(overlaps.flatMap((o) => o.shared_packages)),
    ].filter(Boolean);

    return res.json({
      query: 4,
      description: 'Packages sharing infrastructure (maintainers) with the compromised package',
      cypher: CYPHER_Q4,
      packageName,
      maintainer_overlaps: overlaps,
      packages_at_risk: packagesAtRisk,
      maintainer_count: overlaps.length,
      packages_at_risk_count: packagesAtRisk.length,
    });
  } catch (err) {
    console.error('[Q4] error:', err);
    res.status(500).json({ error: err.message });
  }
});

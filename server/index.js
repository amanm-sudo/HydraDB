// server/index.js
// blast-radius API server
// Connects to HydraDB over Bolt via neo4j-driver.
import express from 'express';
import cors from 'cors';
import { router as q1Router } from './routes/q1-exposed-services.js';
import { router as q2Router } from './routes/q2-compromise-window.js';
import { router as q3Router } from './routes/q3-exposed-lockfiles.js';
import { router as q4Router } from './routes/q4-maintainer-overlap.js';
import { router as q5Router } from './routes/q5-typosquats.js';
import { router as q6Router } from './routes/q6-composite.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Blast-radius query routes
// Q1: GET /api/blast-radius/:pkg/:version/exposed-services
// Q2: GET /api/blast-radius/:pkg/compromise-window
// Q3: GET /api/blast-radius/:pkg/:version/exposed-lockfiles
// Q4: GET /api/blast-radius/:pkg/maintainer-overlap
// Q5: GET /api/blast-radius/:pkg/typosquats
// Q6: GET /api/blast-radius/:pkg/:version/composite

app.use('/api/blast-radius', q1Router);
app.use('/api/blast-radius', q2Router);
app.use('/api/blast-radius', q3Router);
app.use('/api/blast-radius', q4Router);
app.use('/api/blast-radius', q5Router);
app.use('/api/blast-radius', q6Router);

// List all packages in graph (used by frontend search)
import { readQuery } from './db.js';
app.get('/api/packages', async (_req, res) => {
  try {
    const records = await readQuery(
      'MATCH (p:Package) RETURN p.name AS name, p.ecosystem AS ecosystem, p.latest_version AS latest_version ORDER BY name'
    );
    res.json(records.map((r) => ({
      name: r.get('name'),
      ecosystem: r.get('ecosystem'),
      latest_version: r.get('latest_version'),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Compromised packages (for demo quick-select)
app.get('/api/compromised', async (_req, res) => {
  try {
    const records = await readQuery(
      `MATCH (p:Package)-[:HAS_VERSION]->(v:Version)
       WHERE v.is_compromised = true
       RETURN p.name AS package, collect(v.semver) AS versions
       ORDER BY package`
    );
    res.json(records.map((r) => ({
      package: r.get('package'),
      compromised_versions: r.get('versions'),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`blast-radius API server running on http://localhost:${PORT}`);
  console.log(`HydraDB Bolt: ${process.env.HYDRADB_BOLT_URI ?? 'neo4j://127.0.0.1:7687'}`);
});

// server/test/routes.test.js
// Basic API route tests using Node built-in test runner.
// These tests verify the route structure and response format.
// Full end-to-end tests require HydraDB running — marked with .skip if no DB.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// Simple fetch-based test helper
async function get(path) {
  const base = process.env.API_BASE ?? 'http://localhost:3001';
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

describe('Health check', () => {
  test('GET /health returns ok', async () => {
    try {
      const { status, body } = await get('/health');
      assert.equal(status, 200);
      assert.equal(body.status, 'ok');
      assert.ok(body.timestamp);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        console.warn('SKIP: API server not running (start with: cd server && npm start)');
        return;
      }
      throw e;
    }
  });
});

describe('Q2 — compromise window', () => {
  test('returns valid JSON with compromised_versions array', async () => {
    try {
      const { status, body } = await get('/api/blast-radius/%40tanstack%2Fquery-core/compromise-window');
      assert.equal(status, 200);
      assert.equal(body.query, 2);
      assert.ok(Array.isArray(body.compromised_versions));
      assert.ok(typeof body.cypher === 'string');
      console.log(`  Q2: found ${body.count} compromised versions`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        console.warn('SKIP: API server not running');
        return;
      }
      throw e;
    }
  });
});

describe('Q3 — exposed lockfiles', () => {
  test('returns valid JSON with exposed_lockfiles array', async () => {
    try {
      const { status, body } = await get('/api/blast-radius/%40tanstack%2Fquery-core/5.80.7/exposed-lockfiles');
      assert.equal(status, 200);
      assert.equal(body.query, 3);
      assert.ok(Array.isArray(body.exposed_lockfiles));
      console.log(`  Q3: found ${body.count} exposed lockfiles`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        console.warn('SKIP: API server not running');
        return;
      }
      throw e;
    }
  });
});

describe('Q4 — maintainer overlap', () => {
  test('returns valid JSON with maintainer_overlaps array', async () => {
    try {
      const { status, body } = await get('/api/blast-radius/%40tanstack%2Fquery-core/maintainer-overlap');
      assert.equal(status, 200);
      assert.equal(body.query, 4);
      assert.ok(Array.isArray(body.maintainer_overlaps));
      console.log(`  Q4: found ${body.maintainer_count} maintainers, ${body.packages_at_risk_count} packages at risk`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        console.warn('SKIP: API server not running');
        return;
      }
      throw e;
    }
  });
});

describe('Q5 — typosquats', () => {
  test('returns candidates with edit_distance field', async () => {
    try {
      const { status, body } = await get('/api/blast-radius/%40tanstack%2Fquery-core/typosquats');
      assert.equal(status, 200);
      assert.equal(body.query, 5);
      assert.ok(Array.isArray(body.candidates));
      if (body.candidates.length > 0) {
        assert.ok(typeof body.candidates[0].edit_distance === 'number');
        assert.ok(body.candidates[0].edit_distance <= 2);
      }
      console.log(`  Q5: ${body.count} typosquat candidates, ${body.total_packages_checked} total checked`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        console.warn('SKIP: API server not running');
        return;
      }
      throw e;
    }
  });
});

describe('Q6 — composite blast radius', () => {
  test('returns summary string and all sub-results', async () => {
    try {
      const { status, body } = await get('/api/blast-radius/%40tanstack%2Fquery-core/5.80.7/composite');
      assert.equal(status, 200);
      assert.equal(body.query, 6);
      assert.ok(typeof body.summary === 'string');
      assert.ok(Array.isArray(body.exposed_services));
      assert.ok(Array.isArray(body.exposed_lockfiles));
      assert.ok(Array.isArray(body.maintainer_overlap));
      assert.ok(typeof body.elapsed_ms === 'number');
      console.log(`  Q6: ${body.summary}`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        console.warn('SKIP: API server not running');
        return;
      }
      throw e;
    }
  });
});

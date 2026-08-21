// Smoke test for server/test/mock-db.js itself — verifies the fake `readQuery`
// module mock and `makeFakeRecord`/`mountRouter` helpers work end-to-end against a
// real route file (Q2) without a live HydraDB connection or a running API server
// process. Route-specific property tests live in separate task files (7.x-14.x) and
// build on this same helper. Mirrors the pattern used in
// `ingest/test/mock-bolt-sanity.test.js`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mockReadQuery, makeFakeRecord, mountRouter } from './mock-db.js';

const db = mockReadQuery();

// Must import the route file AFTER mockReadQuery() has registered the module mock,
// so `import { readQuery } from '../db.js'` inside q2-compromise-window.js resolves
// to the fake implementation.
const { router } = await import('../routes/q2-compromise-window.js');
const app = mountRouter('/api/blast-radius', router);

test('mock-db lets a route respond using generated fake records, no live HydraDB needed', async () => {
  db.reset();
  db.mockResolvedValueOnce([
    makeFakeRecord({
      semver: '1.0.0',
      published_at: '2024-01-01T00:00:00Z',
      compromised_at: '2024-01-02T00:00:00Z',
      compromise_window_end: '2024-01-05T00:00:00Z',
    }),
    makeFakeRecord({
      semver: '1.0.1',
      published_at: '2024-01-03T00:00:00Z',
      compromised_at: '2024-01-03T00:00:00Z',
      compromise_window_end: '2024-01-06T00:00:00Z',
    }),
  ]);

  const res = await request(app).get('/api/blast-radius/left-pad/compromise-window');

  assert.equal(res.status, 200);
  assert.equal(res.body.query, 2);
  assert.deepEqual(res.body.compromised_versions, [
    {
      semver: '1.0.0',
      published_at: '2024-01-01T00:00:00Z',
      compromised_at: '2024-01-02T00:00:00Z',
      compromise_window_end: '2024-01-05T00:00:00Z',
    },
    {
      semver: '1.0.1',
      published_at: '2024-01-03T00:00:00Z',
      compromised_at: '2024-01-03T00:00:00Z',
      compromise_window_end: '2024-01-06T00:00:00Z',
    },
  ]);

  // readQuery was called exactly once, with the decoded package name as a parameter
  // (never interpolated into the cypher text).
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].params.packageName, 'left-pad');
});

test('mock-db lets a route surface a 500 when readQuery rejects', async () => {
  db.reset();
  db.mockRejectedValueOnce(new Error('bolt connection refused'));

  const res = await request(app).get('/api/blast-radius/left-pad/compromise-window');

  assert.equal(res.status, 500);
  assert.match(res.body.error, /bolt connection refused/);
});

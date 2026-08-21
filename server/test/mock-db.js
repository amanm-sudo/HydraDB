// server/test/mock-db.js
//
// Shared test helper (NOT a test file itself) for `server/test/*.test.js`.
//
// Provides:
//   1. `makeFakeRecord(fields)` / `makeFakeRecords(rows)` — objects shaped like a
//      `neo4j.Record` (i.e. exposing `.get(fieldName)`, plus `.keys` and `.toObject()`)
//      so route handlers that do `records.map((r) => r.get('semver'))` etc. work
//      unmodified against generated test data.
//   2. `mockReadQuery()` — mocks the `../db.js` module's `readQuery` export using
//      Node's built-in ESM module mocking (`node:test`'s `mock.module`, enabled via
//      `--experimental-test-module-mocks` in server/package.json's "test" script —
//      the same mechanism already used successfully in
//      `ingest/test/npm-client.test.js` and `ingest/test/mock-bolt.js`). Returns a
//      small controllable mock object so tests can queue return values or plug in an
//      implementation function, without needing a live HydraDB.
//   3. `mountRouter(basePath, router)` — builds a minimal `express()` app with a
//      given route file's `express.Router()` mounted under a base path, for use with
//      `supertest` (routes in `server/routes/*.js` export a bare Router, not a full
//      app, so tests must assemble one themselves).
//
// Usage in a test file:
//
//   import { test } from 'node:test';
//   import assert from 'node:assert/strict';
//   import request from 'supertest';
//   import { mockReadQuery, makeFakeRecord, mountRouter } from './mock-db.js';
//
//   const db = mockReadQuery();
//
//   // Must import the route file AFTER mockReadQuery() has called mock.module(),
//   // so its `import { readQuery } from '../db.js'` resolves to the fake
//   // implementation instead of the real Bolt-backed one.
//   const { router } = await import('../routes/q2-compromise-window.js');
//   const app = mountRouter('/api/blast-radius', router);
//
//   test('Q2 returns compromised versions', async () => {
//     db.reset();
//     db.mockResolvedValueOnce([
//       makeFakeRecord({
//         semver: '1.0.0',
//         published_at: '2024-01-01',
//         compromised_at: '2024-01-02',
//         compromise_window_end: '2024-01-03',
//       }),
//     ]);
//
//     const res = await request(app).get('/api/blast-radius/left-pad/compromise-window');
//
//     assert.equal(res.status, 200);
//     assert.equal(db.calls.length, 1);
//     assert.equal(db.calls[0].params.packageName, 'left-pad');
//   });
//
// Error injection (e.g. for Property 18 — API responds 500 only on failure):
//
//   db.mockRejectedValueOnce(new Error('bolt down'));
//   const res = await request(app).get('/api/blast-radius/left-pad/compromise-window');
//   assert.equal(res.status, 500);
//
// Reset between test cases (clears queued results/impls and call history, but keeps
// the module mock itself installed — call this at the start of every test/property run):
//
//   db.reset();

import { mock } from 'node:test';
import express from 'express';

/**
 * Wraps a plain object of field values in an object shaped like a `neo4j.Record`.
 * Only `.get(fieldName)` is required by every route in this codebase (they all do
 * `records.map((r) => ({ field: r.get('field'), ... }))`), but `.keys` and
 * `.toObject()` are included too since they're part of the real interface and cheap
 * to support.
 *
 * @param {object} fields - e.g. { semver: '1.0.0', published_at: '2024-01-01' }
 * @returns {{ get: (key: string) => any, keys: string[], toObject: () => object }}
 */
export function makeFakeRecord(fields) {
  return {
    get(key) {
      return fields[key];
    },
    keys: Object.keys(fields),
    toObject() {
      return { ...fields };
    },
  };
}

/**
 * Convenience wrapper for building an array of fake records from an array of plain
 * field objects — mirrors what `readQuery` normally returns (`result.records`).
 *
 * @param {object[]} rows
 * @returns {ReturnType<typeof makeFakeRecord>[]}
 */
export function makeFakeRecords(rows) {
  return rows.map(makeFakeRecord);
}

/**
 * Mocks the `../db.js` module (resolved relative to this helper file, i.e.
 * `server/db.js` — the exact file every route under `server/routes/*.js` and
 * `server/index.js` import via `import { readQuery } from '../db.js'` / `'./db.js'`)
 * so tests can control what `readQuery` returns without a live HydraDB connection.
 *
 * Must be called, and the returned mock configured (or left on its default
 * behavior of resolving to `[]`), BEFORE dynamically importing the route file under
 * test — ESM module mocking only affects imports that happen after `mock.module()`
 * is registered.
 *
 * @returns {{
 *   calls: Array<{ cypher: string, params: object }>,
 *   mockResolvedValueOnce: (records: object[]) => void,
 *   mockResolvedValue: (records: object[]) => void,
 *   mockRejectedValueOnce: (error: Error | string) => void,
 *   mockRejectedValue: (error: Error | string) => void,
 *   mockImplementationOnce: (fn: (cypher: string, params: object) => any) => void,
 *   mockImplementation: (fn: (cypher: string, params: object) => any) => void,
 *   reset: () => void,
 * }}
 */
export function mockReadQuery() {
  const calls = [];
  const queue = [];
  let defaultImpl = async () => [];

  async function readQuery(cypher, params = {}) {
    calls.push({ cypher, params });
    const next = queue.shift();
    if (next) {
      return next(cypher, params);
    }
    return defaultImpl(cypher, params);
  }

  mock.module('../db.js', {
    namedExports: {
      readQuery,
      getDriver: () => ({}),
      closeDb: async () => {},
    },
  });

  return {
    calls,
    mockResolvedValueOnce(records) {
      queue.push(async () => records);
    },
    mockResolvedValue(records) {
      defaultImpl = async () => records;
    },
    mockRejectedValueOnce(error) {
      queue.push(async () => {
        throw error instanceof Error ? error : new Error(error);
      });
    },
    mockRejectedValue(error) {
      defaultImpl = async () => {
        throw error instanceof Error ? error : new Error(error);
      };
    },
    mockImplementationOnce(fn) {
      queue.push(fn);
    },
    mockImplementation(fn) {
      defaultImpl = fn;
    },
    reset() {
      calls.length = 0;
      queue.length = 0;
      defaultImpl = async () => [];
    },
  };
}

/**
 * Builds a minimal `express()` app with the given router mounted, for use with
 * `supertest`. Route files in `server/routes/*.js` export a bare `express.Router()`
 * rather than a fully assembled app, so tests need to mount it themselves under the
 * same base path `server/index.js` uses in production (`/api/blast-radius`).
 *
 * @param {string} basePath - e.g. '/api/blast-radius'
 * @param {import('express').Router} router
 * @returns {import('express').Express}
 */
export function mountRouter(basePath, router) {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  return app;
}

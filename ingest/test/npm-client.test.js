import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'cache');

// Mock the node-fetch module so these tests never hit the real network.
// Requires `node --experimental-test-module-mocks` (see ingest/package.json "test" script).
mock.module('node-fetch', {
  defaultExport: async () => ({
    ok: false,
    status: 404,
    json: async () => ({}),
  }),
});

const { fetchPackage } = await import('../npm-client.js');

// _Requirements: 1.4_
test('fetchPackage returns null on a 404 response and does not write a cache file', async () => {
  const pkgName = '__test-404-pkg-does-not-exist__';
  const cacheFile = path.join(
    CACHE_DIR,
    pkgName.replace(/\//g, '__').replace(/@/g, '_at_') + '.json'
  );

  // Ensure a clean slate in case a previous failed run left a file behind.
  if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);

  try {
    const result = await fetchPackage(pkgName);

    assert.equal(result, null);
    assert.equal(
      fs.existsSync(cacheFile),
      false,
      'expected no cache file to be created for a 404 response'
    );
  } finally {
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  }
});

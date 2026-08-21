// ingest/test/mock-bolt.js
//
// Shared test helper (NOT a test file itself) for `ingest/test/*.test.js`.
//
// Provides a fake Bolt driver/session pair shaped like the `neo4j-driver` package's
// Driver/Session so that `graph-writer.js`'s internal `run(cypher, params)` function
// (which calls `getDriver().session({ defaultAccessMode }).run(cypher, params)` then
// `.close()`) can be exercised without a live HydraDB connection.
//
// Usage in a test file, using Node's built-in ESM module mocking (already enabled via
// `--experimental-test-module-mocks` in ingest/package.json's "test" script, and already
// used the same way for `node-fetch` in `ingest/test/npm-client.test.js`):
//
//   import { mock } from 'node:test';
//   import { createBoltRecorder, fakeNeo4jModule } from './mock-bolt.js';
//
//   const recorder = createBoltRecorder();
//   mock.module('neo4j-driver', { defaultExport: fakeNeo4jModule(recorder) });
//
//   // Must import graph-writer.js AFTER mock.module() so its
//   // `import neo4j from 'neo4j-driver'` resolves to the fake module.
//   const { writePackages, closeDriver } = await import('../graph-writer.js');
//
//   await writePackages([{ name: 'left-pad', ecosystem: 'npm', latest_version: '1.0.0' }]);
//   assert.equal(recorder.calls.length, 1);
//   assert.match(recorder.calls[0].cypher, /MERGE \(p:Package/);
//   assert.deepEqual(recorder.calls[0].params, { rows: [...] });
//
//   recorder.reset(); // clear captured calls between test cases
//   await closeDriver();
//
// Error injection (for tests like Property 9 that need one specific `run()` call in a
// sequence to fail while earlier/later calls succeed normally):
//
//   // Fail the 2nd run() call overall (0-indexed), regardless of its cypher text:
//   recorder.failOnCall(1, new Error('boom'));
//
//   // Or match by predicate on the cypher text instead of a fixed index — matches the
//   // first not-yet-consumed call whose cypher satisfies the predicate:
//   recorder.failOnCall((cypher) => /MERGE .*RESOLVED/.test(cypher), new Error('boom'));
//
//   await assert.rejects(() => writeServicesAndLockfiles(services, lockfiles), /boom/);
//   // The failing call (and every call before it) is still recorded in `calls`.

/**
 * Creates a fresh fake-driver + call recorder pair.
 *
 * @returns {{
 *   calls: Array<{ cypher: string, params: object }>,
 *   driver: object,
 *   reset: () => void,
 *   failOnCall: (matcher: number | ((cypher: string) => boolean), error?: Error | string) => void,
 * }}
 *
 * - `calls` is populated, in order, with `{ cypher, params }` for every `session.run()`
 *   invocation across every session obtained from `driver.session()`. Tests can read
 *   this array directly for assertions.
 * - `driver` is shaped like a `neo4j-driver` Driver: `.session({ defaultAccessMode })`
 *   returns a fake Session with `.run(cypher, params)` and `.close()`, and the driver
 *   itself has a `.close()` (since `graph-writer.js`'s `closeDriver()` calls it).
 * - `reset()` clears `calls` and any pending injected failures so the same recorder can
 *   be reused across multiple test cases without state leaking between them.
 * - `failOnCall(matcher, error)` schedules a future `run()` invocation to reject instead
 *   of resolve. `matcher` is either a 0-based call index (matching the Nth call overall,
 *   counting from 0 across all sessions) or a predicate function invoked with the
 *   cypher text of each call. The predicate form matches the first not-yet-consumed call
 *   whose cypher satisfies it (in case the same cypher text is run multiple times, only
 *   one invocation is failed). Every call — including the one that's about to fail — is
 *   still pushed onto `calls` before the rejection happens, matching real Bolt driver
 *   behavior where the call is attempted and then the returned promise rejects.
 */
export function createBoltRecorder() {
  const calls = [];
  const pendingFailures = [];

  function takeInjectedError(cypher, callIndex) {
    for (const failure of pendingFailures) {
      if (failure.consumed) continue;
      const isMatch =
        typeof failure.matcher === 'number'
          ? failure.matcher === callIndex
          : failure.matcher(cypher);
      if (isMatch) {
        failure.consumed = true;
        return failure.error;
      }
    }
    return null;
  }

  function makeSession() {
    return {
      async run(cypher, params = {}) {
        const callIndex = calls.length;
        calls.push({ cypher, params });
        const injectedError = takeInjectedError(cypher, callIndex);
        if (injectedError) {
          throw injectedError;
        }
        // Minimal fake neo4j Result shape so callers awaiting it don't break.
        return { records: [] };
      },
      async close() {
        // no-op: nothing to release for the fake session
      },
    };
  }

  const driver = {
    session(/* { defaultAccessMode } */) {
      return makeSession();
    },
    async close() {
      // no-op: nothing to release for the fake driver
    },
  };

  return {
    calls,
    driver,
    reset() {
      calls.length = 0;
      pendingFailures.length = 0;
    },
    failOnCall(matcher, error) {
      pendingFailures.push({
        matcher,
        error: error instanceof Error ? error : new Error(error ?? 'injected mock Bolt run() failure'),
        consumed: false,
      });
    },
  };
}

/**
 * Builds the fake `neo4j-driver` module namespace to pass as the `defaultExport`
 * option to `mock.module('neo4j-driver', { defaultExport: ... })`.
 *
 * `graph-writer.js` does `import neo4j from 'neo4j-driver'` and then references
 * `neo4j.driver(...)`, `neo4j.auth.basic(...)`, and `neo4j.session.WRITE`. This helper
 * returns an object providing all three so the module substitution is transparent to
 * `graph-writer.js` while `neo4j.driver(...)` actually returns the recorder's fake
 * driver instead of constructing a real Bolt connection.
 *
 * @param {{ driver: object }} recorder - a recorder created by `createBoltRecorder()`
 * @returns {object} the fake `neo4j-driver` default export
 */
export function fakeNeo4jModule(recorder) {
  return {
    driver: () => recorder.driver,
    auth: {
      basic: () => ({}),
    },
    session: {
      READ: 'READ',
      WRITE: 'WRITE',
    },
  };
}

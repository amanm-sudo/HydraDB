// Smoke test for ingest/test/mock-bolt.js itself — verifies the fake Bolt
// recorder correctly intercepts graph-writer.js's internal run() calls without
// hitting a real neo4j-driver connection. The property tests that exercise
// graph-writer.js's actual upsert/round-trip behavior live in separate task
// files (4.2, 4.3, 4.4, 4.6, 4.7) and build on this same helper.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createBoltRecorder, fakeNeo4jModule } from './mock-bolt.js';

const recorder = createBoltRecorder();
mock.module('neo4j-driver', { defaultExport: fakeNeo4jModule(recorder) });

const { writePackages, writeServicesAndLockfiles, closeDriver } = await import('../graph-writer.js');

test('mock-bolt recorder captures cypher and params from writePackages', async () => {
  recorder.reset();
  await writePackages([{ name: 'left-pad', ecosystem: 'npm', latest_version: '1.0.0' }]);

  assert.equal(recorder.calls.length, 1);
  assert.match(recorder.calls[0].cypher, /MERGE \(p:Package/);
  assert.deepEqual(recorder.calls[0].params, {
    rows: [{ name: 'left-pad', ecosystem: 'npm', latest_version: '1.0.0' }],
  });

  await closeDriver();
});

test('mock-bolt recorder failOnCall rejects the matched call while recording prior successful calls', async () => {
  recorder.reset();
  // With no illustrative services configured, writeServicesAndLockfiles issues 3
  // sequential run() calls for the lockfiles: 0) Lockfile node write, 1) RESOLVED edge
  // write, 2) PINS edge write.
  recorder.failOnCall((cypher) => /RESOLVED/.test(cypher), new Error('bolt write failed'));

  await assert.rejects(
    () =>
      writeServicesAndLockfiles(
        [],
        [{ service: 'svc-a', resolved_at: '2024-01-01T00:00:00Z', pins_package: 'left-pad', pins_semver: '1.0.0' }]
      ),
    /bolt write failed/
  );

  // The Lockfile node write (call 0) and the failing RESOLVED write (call 1) were both
  // attempted and recorded; the PINS write (call 2) never ran because the rejection
  // propagated out of writeServicesAndLockfiles.
  assert.equal(recorder.calls.length, 2);
  assert.match(recorder.calls[0].cypher, /MERGE \(lf:Lockfile/);
  assert.match(recorder.calls[1].cypher, /RESOLVED/);

  await closeDriver();
});

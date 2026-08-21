import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

// Smoke test confirming `node --test` discovers files under ingest/test/
// and that fast-check is installed and usable.
// _Requirements: 1.2, 1.3_
test('fast-check property infrastructure is wired up', () => {
  fc.assert(
    fc.property(fc.integer(), (n) => n === n),
    { numRuns: 100 }
  );
});

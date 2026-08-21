import { test } from 'node:test';
import fc from 'fast-check';

// Smoke test confirming `node --test` discovers files under server/test/
// and that fast-check is installed and usable, independent of a live API server.
// _Requirements: 1.2, 1.3_
test('fast-check property infrastructure is wired up', () => {
  fc.assert(
    fc.property(fc.integer(), (n) => n === n),
    { numRuns: 100 }
  );
});

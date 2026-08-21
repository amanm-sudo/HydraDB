// server/db.js
// HydraDB connection via neo4j-driver over Bolt.
// HydraDB is fully Bolt 5.x compatible — no custom protocol needed.
import neo4j from 'neo4j-driver';
import { resolveBoltUri, resolveAuthToken } from './config.js';

const BOLT_URI = resolveBoltUri(process.env);
const AUTH_TOKEN = resolveAuthToken(process.env);

let driver;

export function getDriver() {
  if (!driver) {
    driver = neo4j.driver(
      BOLT_URI,
      neo4j.auth.bearer(AUTH_TOKEN),
      {
        encrypted: false,
        trust: 'TRUST_ALL_CERTIFICATES',
        maxConnectionPoolSize: 10,
      }
    );
  }
  return driver;
}

/**
 * Run a read query. Returns array of record objects.
 */
export async function readQuery(cypher, params = {}) {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

export async function closeDb() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

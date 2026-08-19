// server/db.js
// HydraDB connection via neo4j-driver over Bolt.
// HydraDB is fully Bolt 5.x compatible — no custom protocol needed.
import neo4j from 'neo4j-driver';

const BOLT_URI = process.env.HYDRADB_BOLT_URI ?? 'neo4j://127.0.0.1:7687';
const AUTH_TOKEN = process.env.HYDRADB_TOKEN ?? 'local-development-token-32-bytes';

let driver;

export function getDriver() {
  if (!driver) {
    driver = neo4j.driver(
      BOLT_URI,
      neo4j.auth.basic('', AUTH_TOKEN),
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

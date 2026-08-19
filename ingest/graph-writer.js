// ingest/graph-writer.js
// Writes nodes and edges into HydraDB using neo4j-driver over Bolt.
// Uses UNWIND-based batch writes as HydraDB explicitly supports and recommends.
import neo4j from 'neo4j-driver';

const BOLT_URI = process.env.HYDRADB_BOLT_URI ?? 'neo4j://127.0.0.1:7687';
const AUTH_TOKEN = process.env.HYDRADB_TOKEN ?? 'local-development-token-32-bytes';

let _driver = null;

export function getDriver() {
  if (!_driver) {
    _driver = neo4j.driver(
      BOLT_URI,
      neo4j.auth.basic('', AUTH_TOKEN),
      { encrypted: false, trust: 'TRUST_ALL_CERTIFICATES' }
    );
  }
  return _driver;
}

export async function closeDriver() {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}

async function run(cypher, params = {}) {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    const result = await session.run(cypher, params);
    return result;
  } finally {
    await session.close();
  }
}

/**
 * Batch-upsert Package nodes via UNWIND.
 * packages: [{ name, ecosystem, latest_version }]
 */
export async function writePackages(packages) {
  if (!packages.length) return;
  console.log(`  [graph] writing ${packages.length} Package nodes...`);
  await run(
    `UNWIND $rows AS row
     MERGE (p:Package {name: row.name})
     SET p.ecosystem = row.ecosystem, p.latest_version = row.latest_version`,
    { rows: packages }
  );
}

/**
 * Batch-upsert Version nodes and HAS_VERSION edges via UNWIND.
 * versions: [{ package, semver, published_at, is_compromised, compromised_at, compromise_window_end }]
 */
export async function writeVersions(versions) {
  if (!versions.length) return;
  console.log(`  [graph] writing ${versions.length} Version nodes...`);
  // Write Version nodes
  await run(
    `UNWIND $rows AS row
     MERGE (v:Version {package: row.package, semver: row.semver})
     SET v.published_at = row.published_at,
         v.is_compromised = row.is_compromised,
         v.compromised_at = row.compromised_at,
         v.compromise_window_end = row.compromise_window_end`,
    { rows: versions }
  );
  // Write HAS_VERSION edges in a separate pass (HydraDB: one relationship type per pattern)
  await run(
    `UNWIND $rows AS row
     MATCH (p:Package {name: row.package})
     MATCH (v:Version {package: row.package, semver: row.semver})
     MERGE (p)-[:HAS_VERSION]->(v)`,
    { rows: versions }
  );
}

/**
 * Batch-upsert DEPENDS_ON edges from a Version to Package nodes.
 * deps: [{ from_package, from_semver, to_package, range }]
 */
export async function writeDependencies(deps) {
  if (!deps.length) return;
  console.log(`  [graph] writing ${deps.length} DEPENDS_ON edges...`);
  await run(
    `UNWIND $rows AS row
     MATCH (v:Version {package: row.from_package, semver: row.from_semver})
     MATCH (p:Package {name: row.to_package})
     MERGE (v)-[r:DEPENDS_ON]->(p)
     SET r.range = row.range`,
    { rows: deps }
  );
}

/**
 * Batch-upsert Maintainer nodes and MAINTAINS edges.
 * maintainers: [{ username, email_domain, package_name }]
 */
export async function writeMaintainers(maintainers) {
  if (!maintainers.length) return;
  console.log(`  [graph] writing ${maintainers.length} Maintainer->Package edges...`);
  await run(
    `UNWIND $rows AS row
     MERGE (m:Maintainer {username: row.username})
     SET m.email_domain = row.email_domain`,
    { rows: maintainers }
  );
  await run(
    `UNWIND $rows AS row
     MATCH (m:Maintainer {username: row.username})
     MATCH (p:Package {name: row.package_name})
     MERGE (m)-[:MAINTAINS]->(p)`,
    { rows: maintainers }
  );
}

/**
 * Write illustrative Service and Lockfile nodes with RESOLVED/PINS edges.
 * These represent hypothetical internal consumers. Clearly labeled as synthetic.
 * services: [{ name }]
 * lockfiles: [{ service, resolved_at, pins_package, pins_semver }]
 */
export async function writeServicesAndLockfiles(services, lockfiles) {
  if (services.length) {
    console.log(`  [graph] writing ${services.length} Service nodes (illustrative)...`);
    await run(
      `UNWIND $rows AS row
       MERGE (s:Service {name: row.name})`,
      { rows: services }
    );
  }

  if (lockfiles.length) {
    console.log(`  [graph] writing ${lockfiles.length} Lockfile nodes (illustrative)...`);
    // Lockfile nodes
    await run(
      `UNWIND $rows AS row
       MERGE (lf:Lockfile {service: row.service, resolved_at: row.resolved_at})`,
      { rows: lockfiles }
    );
    // Service -[:RESOLVED]-> Lockfile
    await run(
      `UNWIND $rows AS row
       MATCH (s:Service {name: row.service})
       MATCH (lf:Lockfile {service: row.service, resolved_at: row.resolved_at})
       MERGE (s)-[:RESOLVED]->(lf)`,
      { rows: lockfiles }
    );
    // Lockfile -[:PINS]-> Version
    await run(
      `UNWIND $rows AS row
       MATCH (lf:Lockfile {service: row.service, resolved_at: row.resolved_at})
       MATCH (v:Version {package: row.pins_package, semver: row.pins_semver})
       MERGE (lf)-[:PINS]->(v)`,
      { rows: lockfiles }
    );
  }
}

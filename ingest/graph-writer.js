// ingest/graph-writer.js
// Writes nodes and edges into HydraDB using neo4j-driver over Bolt.
// Uses UNWIND-based batch writes as HydraDB explicitly supports and recommends.
//
// HydraDB's UNWIND/MERGE batch form requires vertices to be identified by a
// literal non-negative integer `id` property (see hydradb-core/cypher-compat.md:
// "A vertex upsert has to be MERGE by id followed by SET"). Since our domain
// identity is string-based (package name, package+semver, etc.), we derive a
// stable integer id via a deterministic hash of the domain key, and keep the
// original domain properties as regular SET properties so all reads (the six
// query routes, which MATCH by name/package/semver) are unaffected.
import neo4j from 'neo4j-driver';
import crypto from 'node:crypto';
import { resolveBoltUri, resolveAuthToken } from './config.js';

const BOLT_URI = resolveBoltUri(process.env);
const AUTH_TOKEN = resolveAuthToken(process.env);

let _driver = null;

export function getDriver() {
  if (!_driver) {
    _driver = neo4j.driver(
      BOLT_URI,
      neo4j.auth.bearer(AUTH_TOKEN),
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
 * Deterministic non-negative integer id derived from a domain key string.
 * Uses the first 6 bytes of a SHA-256 digest (well within JS's safe integer
 * range) so the same domain key always maps to the same vertex id.
 */
export function stableId(key) {
  const digest = crypto.createHash('sha256').update(String(key)).digest();
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + digest[i];
  // Wrap as a neo4j-driver Integer so it's transmitted as a Bolt integer, not
  // a float — HydraDB's UNWIND vertex-upsert batch form requires a literal
  // non-negative integer id.
  return neo4j.int(n);
}

// HydraDB's Bolt parameter encoding rejects `null` values (only boolean,
// signed integer, finite float, and string are supported). Our domain data
// legitimately has null compromise fields for non-compromised versions, so
// we sanitize null -> '' immediately before sending any batch write.
function sanitizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v === null || v === undefined ? '' : v;
  }
  return out;
}
const sanitizeRows = (rows) => rows.map(sanitizeRow);

const packageId = (name) => stableId(`pkg:${name}`);
const versionId = (pkg, semver) => stableId(`ver:${pkg}@${semver}`);
const maintainerId = (username) => stableId(`maint:${username}`);
const serviceId = (name) => stableId(`svc:${name}`);
const lockfileId = (service, resolvedAt) => stableId(`lock:${service}@${resolvedAt}`);

/**
 * Batch-upsert Package nodes via UNWIND.
 * packages: [{ name, ecosystem, latest_version }]
 */
export async function writePackages(packages) {
  if (!packages.length) return;
  console.log(`  [graph] writing ${packages.length} Package nodes...`);
  const rows = sanitizeRows(packages.map((p) => ({ ...p, id: packageId(p.name) })));
  await run(
    `UNWIND $rows AS row
     MERGE (p {id: row.id})
     SET p:Package, p.name = row.name, p.ecosystem = row.ecosystem, p.latest_version = row.latest_version`,
    { rows }
  );
}

/**
 * Batch-upsert Version nodes and HAS_VERSION edges via UNWIND.
 * versions: [{ package, semver, published_at, is_compromised, compromised_at, compromise_window_end }]
 */
export async function writeVersions(versions) {
  if (!versions.length) return;
  console.log(`  [graph] writing ${versions.length} Version nodes...`);
  const rows = sanitizeRows(versions.map((v) => ({
    ...v,
    id: versionId(v.package, v.semver),
    package_id: packageId(v.package),
  })));
  // Write Version nodes
  await run(
    `UNWIND $rows AS row
     MERGE (v {id: row.id})
     SET v:Version, v.package = row.package, v.semver = row.semver,
         v.published_at = row.published_at,
         v.is_compromised = row.is_compromised,
         v.compromised_at = row.compromised_at,
         v.compromise_window_end = row.compromise_window_end`,
    { rows }
  );
  // Write HAS_VERSION edges in a separate pass (HydraDB: one relationship type per
  // pattern). Per cypher-compat.md, a single MATCH clause with comma-separated
  // patterns (not two chained MATCH clauses) followed by MERGE works.
  await run(
    `UNWIND $rows AS row
     MATCH (p:Package {id: row.package_id}), (v:Version {id: row.id})
     MERGE (p)-[r:HAS_VERSION {id: row.id}]->(v)`,
    { rows }
  );
}

/**
 * Batch-upsert DEPENDS_ON edges from a Version to Package nodes.
 * deps: [{ from_package, from_semver, to_package, range }]
 */
export async function writeDependencies(deps) {
  if (!deps.length) return;
  console.log(`  [graph] writing ${deps.length} DEPENDS_ON edges...`);
  const rows = sanitizeRows(deps.map((d) => ({
    ...d,
    from_id: versionId(d.from_package, d.from_semver),
    to_id: packageId(d.to_package),
    dep_id: stableId(`dep:${d.from_package}@${d.from_semver}->${d.to_package}`),
  })));
  await run(
    `UNWIND $rows AS row
     MATCH (v:Version {id: row.from_id}), (p:Package {id: row.to_id})
     MERGE (v)-[r:DEPENDS_ON {id: row.dep_id}]->(p)
     SET r.range = row.range`,
    { rows }
  );
}

/**
 * Batch-upsert Maintainer nodes and MAINTAINS edges.
 * maintainers: [{ username, email_domain, package_name }]
 */
export async function writeMaintainers(maintainers) {
  if (!maintainers.length) return;
  console.log(`  [graph] writing ${maintainers.length} Maintainer->Package edges...`);
  const rows = sanitizeRows(maintainers.map((m) => ({
    ...m,
    id: maintainerId(m.username),
    package_id: packageId(m.package_name),
    rel_id: stableId(`maintains:${m.username}->${m.package_name}`),
  })));
  await run(
    `UNWIND $rows AS row
     MERGE (m {id: row.id})
     SET m:Maintainer, m.username = row.username, m.email_domain = row.email_domain`,
    { rows }
  );
  await run(
    `UNWIND $rows AS row
     MATCH (m:Maintainer {id: row.id}), (p:Package {id: row.package_id})
     MERGE (m)-[r:MAINTAINS {id: row.rel_id}]->(p)`,
    { rows }
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
    const svcRows = sanitizeRows(services.map((s) => ({ ...s, id: serviceId(s.name) })));
    await run(
      `UNWIND $rows AS row
       MERGE (s {id: row.id})
       SET s:Service, s.name = row.name`,
      { rows: svcRows }
    );
  }

  if (lockfiles.length) {
    console.log(`  [graph] writing ${lockfiles.length} Lockfile nodes (illustrative)...`);
    const lfRows = sanitizeRows(lockfiles.map((lf) => ({
      ...lf,
      id: lockfileId(lf.service, lf.resolved_at),
      service_id: serviceId(lf.service),
      version_id: versionId(lf.pins_package, lf.pins_semver),
    })));
    // Lockfile nodes
    await run(
      `UNWIND $rows AS row
       MERGE (lf {id: row.id})
       SET lf:Lockfile, lf.service = row.service, lf.resolved_at = row.resolved_at`,
      { rows: lfRows }
    );
    // Service -[:RESOLVED]-> Lockfile
    await run(
      `UNWIND $rows AS row
       MATCH (s:Service {id: row.service_id}), (lf:Lockfile {id: row.id})
       MERGE (s)-[r:RESOLVED {id: row.id}]->(lf)`,
      { rows: lfRows }
    );
    // Lockfile -[:PINS]-> Version, via UNWIND batch (single-row writes through
    // this MATCH+MERGE shape are rejected by HydraDB's shard/mutation engine —
    // batch writes go through the client transport, which supports it). If the
    // pinned semver wasn't in the ingested per-package version window, the
    // whole batch is rejected by HydraDB (MATCH endpoint must exist for every
    // row) — this is logged and skipped rather than failing the run.
    try {
      await run(
        `UNWIND $rows AS row
         MATCH (lf:Lockfile {id: row.id}), (v:Version {id: row.version_id})
         MERGE (lf)-[r:PINS {id: row.id}]->(v)`,
        { rows: lfRows }
      );
    } catch (err) {
      console.warn(`  [graph] PINS batch write skipped (one or more pinned versions not in the ingested window): ${err.message}`);
    }
  }
}

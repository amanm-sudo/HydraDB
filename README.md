# 💥 blast-radius

> **Supply chain blast radius analysis via graph traversal** — given a compromised npm package, instantly compute which internal services are exposed, which lockfiles resolved the bad version while it was live, which packages share maintainer infrastructure with the attacker, and how far the blast radius spreads. Powered by [HydraDB](https://github.com/hydra-db/hydradb).

**Hydra Hack 2026 — Track 2A: Supply Chain Blast Radius**

---

## The Problem

On May 11, 2026, a CI/CD pipeline breach in the TanStack ecosystem led to 84 malicious package artifacts published across 42 `@tanstack/*` packages within six minutes. The attack — attributed to threat group TeamPCP ("Mini Shai-Hulud") — hijacked the GitHub Actions OIDC token via cache poisoning on a `pull_request_target` workflow. It produced the first documented npm packages with **valid SLSA Build Level 3 provenance attestations** on malicious artifacts.

The organizer's framing question: **"When a package is compromised at 09:00, which of your services are exposed by 09:06?"**

`blast-radius` answers that question — and five others — via real graph traversal in HydraDB. No vector similarity. No recursive SQL CTEs. Pure graph.

---

## What Was Built

A full-stack application with:

- **`ingest/`** — Node.js script that pulls real package metadata from the live npm registry and loads it into HydraDB using `UNWIND`-based batch Cypher writes
- **`server/`** — Node.js + Express API with six dedicated query routes, each backed by a parameterized OpenCypher query running against HydraDB
- **`web/`** — Next.js 14 frontend with a search interface, live query results, and the exact Cypher query shown for each answer (judge transparency)
- **`hydradb-core/`** — the HydraDB server (gitignored, see Setup)

### The six queries

| # | Question | Cypher technique |
|---|----------|-----------------|
| Q1 | Which services are exposed? | `algo.MSpaths` native path procedure (GraphBLAS) with fallback to variable-length `MATCH` |
| Q2 | Which version introduced the vulnerability? | `MATCH` on `:Version` filtered by `is_compromised = true` |
| Q3 | Which lockfiles resolved the bad version while it was live? | `MATCH` traversal + temporal window filter on `resolved_at` |
| Q4 | Which packages share maintainer infrastructure? | `(:Maintainer)-[:MAINTAINS]->` fan-out traversal |
| Q5 | Typosquat proximity | Package names fetched from HydraDB, Levenshtein distance in Node.js (see note) |
| Q6 | Composite blast radius | Runs Q1–Q4 in parallel, returns structured JSON summary |

---

## Why HydraDB

The judges ask: **"what makes this graph-native?"** Here are the exact queries and why they require a graph database, not Postgres or a vector store.

### Q1 — Transitive reverse-dependency closure (`algo.MSpaths`)

```cypher
CALL algo.MSpaths({
  sourceLabel: 'Version',
  sourceProperty: 'package',
  sourceValues: ['@tanstack/query-core'],
  targetLabel: 'Service',
  targetProperty: 'name',
  targetValues: ['frontend-dashboard', 'admin-portal', ...],
  pairwise: false,
  relTypes: ['DEPENDS_ON'],
  relDirection: 'both',
  maxLen: 6,
  pathCount: 20,
  resultLimit: 200
})
YIELD path
RETURN path
```

**Why HydraDB wins here:** `algo.MSpaths` runs against a single pinned SlateDB snapshot with compiled SuiteSparse GraphBLAS topology. It resolves paths between many source and target values together — no client-side fan-out, no per-hop round trips. In **Postgres**, this is a recursive CTE that allocates O(V·E) intermediate rows and doesn't scale past 4–5 hops on a real dependency graph. In a **vector DB**, this question doesn't exist — vector DBs store embeddings and return cosine-similar vectors; they have no concept of graph edges, paths, or structural reachability.

### Q3 — Temporal window join via graph traversal

```cypher
MATCH (svc:Service)-[:RESOLVED]->(lf:Lockfile)-[:PINS]->(v:Version)
WHERE v.package = $packageName
  AND v.is_compromised = true
  AND lf.resolved_at >= v.compromised_at
  AND lf.resolved_at <= v.compromise_window_end
RETURN svc.name, lf.resolved_at, v.semver
```

**Why graph:** This correlates structural graph relationships (three hops: Service → Lockfile → Version) with temporal property predicates in a single traversal. In Postgres this is a three-table join with a self-referencing date range subquery — workable but loses the traversal semantics entirely and doesn't generalize to multi-hop patterns.

### Q4 — Shared infrastructure via Maintainer fan-out

```cypher
MATCH (m:Maintainer)-[:MAINTAINS]->(target:Package {name: $packageName})
MATCH (m)-[:MAINTAINS]->(other:Package)
WHERE other.name <> $packageName
RETURN m.username, collect(other.name) AS shared_packages
```

**Why graph:** This is a classic "friend-of-friend" graph pattern — enumerate all packages that share a maintainer with the compromised package. In a graph DB this is two steps. In a vector DB this is impossible (no edges). In Postgres it's a self-join on a `maintainer_packages` junction table — possible, but each additional hop (e.g., "packages that share a maintainer with a package that shares a maintainer with the target") multiplies join complexity exponentially.

### Q1 (fallback) — Variable-length reverse traversal

```cypher
MATCH (v:Version {package: $packageName, semver: $semver})
      -[:DEPENDS_ON*0..5]->(dep:Package)
      <-[:DEPENDS_ON*0..3]-(other:Version)
      <-[:PINS]-(lf:Lockfile)
      <-[:RESOLVED]-(svc:Service)
RETURN DISTINCT svc.name, dep.name
```

Variable-length paths `*0..5` are native to HydraDB's OpenCypher engine and use the compiled adjacency index. In Postgres this is `WITH RECURSIVE` — correct but slow at scale and not composable.

### Q5 — Typosquat (application layer, with honest note)

HydraDB's OpenCypher subset (confirmed in `cypher-compat.md`) does not include Levenshtein or string-distance functions. Per the brief's instructions ("compute this in the ingestion or API layer"), we fetch all package names from HydraDB in one query and apply `fastest-levenshtein` in Node.js. This is honestly documented here and in the UI.

### A note on HydraDB's batch-write contract

HydraDB's `UNWIND ... MERGE` batch write form (used throughout `ingest/graph-writer.js`)
requires every vertex to carry a literal, non-negative **integer** `id` property —
domain keys like `{name: row.name}` are rejected in the batch form (`cypher-compat.md`:
"a vertex upsert has to be `MERGE` by id followed by `SET`"). Since our domain identity
is string-based (package name, package+semver, etc.), the ingestion pipeline derives a
stable integer `id` via a SHA-256-based hash of the domain key for every node, and keeps
the original domain properties (`name`, `package`, `semver`, ...) as regular `SET`
properties. All six query routes still `MATCH` by those domain properties — the
integer `id` is purely an internal write-path detail, invisible to the API and frontend.
Batch relationship writes similarly need `MATCH (a:Label {id: ...}), (b:Label {id: ...})`
(a single `MATCH` with comma-separated patterns, exactly one label per endpoint) followed
by `MERGE (a)-[r:REL {id: ...}]->(b)` — chained `MATCH` clauses or a bare `MERGE` without
a relationship `id` are both rejected by HydraDB's OpenCypher engine.

---

## Data Sources

| Layer | Source | Real or synthetic? |
|---|---|---|
| Package graph | [npm registry API](https://registry.npmjs.org/) — public, no auth | **Real** |
| Maintainers | npm registry `maintainers` field | **Real** |
| Version timestamps | npm registry `time` field | **Real** |
| Compromise markers | Public TanStack incident disclosure | **Real** (mapped to actual semvers) |
| Service nodes | Synthetic | **Illustrative — clearly labeled** |
| Lockfile nodes | Synthetic with realistic timestamps | **Illustrative — clearly labeled** |

The Service and Lockfile layer represents **hypothetical internal consumers**. In a real deployment, these would come from your actual `package-lock.json` files and service manifests. They are always labeled as illustrative in the UI and in this README.

### Incident reference

> TanStack npm supply chain attack, May 11 2026. Threat group: TeamPCP. Campaign: "Mini Shai-Hulud".  
> Sources:  
> — https://github.com/nicowillis/tanstack-supply-chain-attack  
> — https://snyk.io/blog/tanstack-supply-chain-attack/  
> — https://tanstack.com/blog/security-update-may-2026

---

## Setup & Run

### Prerequisites

- **WSL2 with Ubuntu** (for running HydraDB)
- **Node.js 20+** (on Windows)
- **npm 9+**

### 1. Start HydraDB (WSL2)

HydraDB is built from source in WSL2. Open a WSL terminal and run:

```bash
# Install dependencies (first time only)
sudo apt-get update
sudo apt-get install -y build-essential clang libclang-dev cmake pkg-config \
  libcypher-parser-dev libgraphblas-dev curl git

# Install Rust (first time only)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install just (first time only)
cargo install just --locked

# Clone HydraDB
git clone https://github.com/hydra-db/hydradb.git hydradb-core
cd hydradb-core

# Verify environment
just native-check
just smoke         # Must print success

# Start server (holds foreground — use a dedicated terminal)
bash ../scripts/start-hydradb.sh
```

**Verify it's alive:**
```bash
bash scripts/verify-hydradb.sh
# Must print: verify-ok
```

> **Important — data directory must be on native Linux storage, not a Windows-mounted path.**
> HydraDB's local object-store backend uses conditional/atomic file updates
> (`PutMode::Update`) that WSL2's `/mnt/d/...` (9p/drvfs) filesystem does not
> support — writes past the very first one will fail with
> `object store error: Operation put_opts with mode PutMode::Update not yet
> implemented by LocalFileSystem`. Point `LOCAL_PATH` / `GRAPH_DATA_CACHE_DIR` /
> `GRAPH_AUTH_TOKEN_FILE` at a path under the WSL2 filesystem itself (e.g.
> `/root/.hydradb/...` or `~/.hydradb/...`), not under `/mnt/c` or `/mnt/d`.
>
> **Also:** connect with `bolt://` (direct), not `neo4j://` (routing) — HydraDB
> is a single-node server and does not implement the Bolt routing-table
> discovery that `neo4j://` triggers, so `neo4j://` URIs fail with
> `ServiceUnavailable: Could not perform discovery`. This repo's `HYDRADB_BOLT_URI`
> default and `.env.example` already use `bolt://127.0.0.1:7687`.

### 2. Ingest real npm data

```bash
cd ingest
npm install
node ingest.js
# Prints: ingestion-complete
```

### 3. Start the API server

```bash
cd server
npm install
npm start
# Listening on http://localhost:3001
```

### 4. Start the frontend

```bash
cd web
npm install
npm run dev
# Open http://localhost:3000
```

### Quick demo

```bash
# Get composite blast radius for the compromised TanStack version:
curl "http://localhost:3001/api/blast-radius/%40tanstack%2Fquery-core/5.80.7/composite"
```

---

## Architecture

```
HydraDB (WSL2, port 7687 Bolt / 8443 HTTP)
    │
    │  neo4j-driver (Bolt 5.x)
    │
Express API (localhost:3001)
    │
    │  fetch
    │
Next.js frontend (localhost:3000)
```

HydraDB is the **only** source of truth for the dependency graph. The Express server talks to HydraDB over Bolt using the standard `neo4j-driver` npm package — HydraDB is Bolt 5.x compatible, so no custom protocol code is needed.

---

## Project Structure

```
blast-radius/
├── ingest/           # npm registry → HydraDB ingestion (Node.js)
├── server/           # Express API — six query routes
│   └── routes/       # q1 through q6
├── web/              # Next.js 14 frontend
│   └── src/
│       ├── app/      # page.tsx — main UI
│       ├── components/ # CypherBlock, etc.
│       └── lib/      # api.ts — typed fetch helpers
├── scripts/          # setup-hydradb-wsl.sh, start-hydradb.sh, verify-hydradb.sh
├── hydradb-core/     # gitignored — clone separately (see Setup)
├── LICENSE           # MIT
└── README.md
```

---

## Hackathon Submission Checklist

- [x] Fresh public GitHub repo, first commit Aug 20 2026
- [x] `LICENSE` file (MIT)
- [x] README with problem, what was built, setup instructions, "Why HydraDB" section, data attribution
- [x] All six queries return real, non-hardcoded results against real ingested npm data
- [x] Service/Lockfile layer clearly labeled as illustrative throughout
- [x] `hydradb-core/` gitignored — not committing HydraDB's history as our own

---

## Third-party Attribution

- [HydraDB](https://github.com/hydra-db/hydradb) — AGPL-3.0 — the graph database engine
- [neo4j-driver](https://github.com/neo4j/neo4j-javascript-driver) — Apache-2.0 — Bolt client
- [npm registry API](https://registry.npmjs.org/) — public JSON API, no auth required
- [fastest-levenshtein](https://github.com/ka-weihe/fastest-levenshtein) — MIT — edit distance
- [Express](https://expressjs.com/) — MIT
- [Next.js](https://nextjs.org/) — MIT

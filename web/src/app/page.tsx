'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchCompromised,
  fetchQ1, fetchQ2, fetchQ3, fetchQ4, fetchQ5, fetchComposite,
  type CompromisedPackage,
  type CompositeResult,
  type QueryResult,
} from '@/lib/api';
import { CypherBlock } from '@/components/CypherBlock';

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueryState {
  loading: boolean;
  data: QueryResult | CompositeResult | null;
  error: string | null;
}

function emptyState(): QueryState {
  return { loading: false, data: null, error: null };
}

// ── Query Panel ───────────────────────────────────────────────────────────────

function QueryPanel({
  queryNum,
  title,
  badge,
  state,
  children,
}: {
  queryNum: number;
  title: string;
  badge?: string;
  state: QueryState;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">Q{queryNum}</span>
        <h3 className="text-white font-semibold text-sm">{title}</h3>
        {badge && (
          <span className="ml-auto text-xs bg-purple-900 text-purple-300 border border-purple-700 px-2 py-0.5 rounded">
            {badge}
          </span>
        )}
      </div>

      {state.loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-blue-500" />
          Running HydraDB query...
        </div>
      )}

      {state.error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
          {state.error}
        </div>
      )}

      {!state.loading && !state.error && state.data && children}
      {!state.loading && !state.error && !state.data && (
        <p className="text-gray-500 text-sm italic">Run a query above to see results here.</p>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BlastRadiusPage() {
  const [compromised, setCompromised] = useState<CompromisedPackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState('@tanstack/query-core');
  const [selectedVersion, setSelectedVersion] = useState('5.80.7');
  const [running, setRunning] = useState(false);

  const [q1, setQ1] = useState<QueryState>(emptyState());
  const [q2, setQ2] = useState<QueryState>(emptyState());
  const [q3, setQ3] = useState<QueryState>(emptyState());
  const [q4, setQ4] = useState<QueryState>(emptyState());
  const [q5, setQ5] = useState<QueryState>(emptyState());
  const [q6, setQ6] = useState<QueryState>(emptyState());

  // Load compromised packages for quick-select
  useEffect(() => {
    fetchCompromised()
      .then(setCompromised)
      .catch((e) => console.warn('Could not load compromised list:', e.message));
  }, []);

  const runAllQueries = useCallback(async () => {
    if (!selectedPkg || !selectedVersion) return;
    setRunning(true);

    // Reset all states
    const loading: QueryState = { loading: true, data: null, error: null };
    setQ1(loading); setQ2(loading); setQ3(loading);
    setQ4(loading); setQ5(loading); setQ6(loading);

    // Fire all six queries in parallel
    const run = async <T extends QueryResult | CompositeResult>(
      fetcher: () => Promise<T>,
      setter: (s: QueryState) => void
    ) => {
      try {
        const data = await fetcher();
        setter({ loading: false, data, error: null });
      } catch (e) {
        setter({ loading: false, data: null, error: (e as Error).message });
      }
    };

    await Promise.all([
      run(() => fetchQ1(selectedPkg, selectedVersion), setQ1),
      run(() => fetchQ2(selectedPkg), setQ2),
      run(() => fetchQ3(selectedPkg, selectedVersion), setQ3),
      run(() => fetchQ4(selectedPkg), setQ4),
      run(() => fetchQ5(selectedPkg), setQ5),
      run(async () => (await fetchComposite(selectedPkg, selectedVersion)) as unknown as QueryResult, setQ6),
    ]);

    setRunning(false);
  }, [selectedPkg, selectedVersion]);

  const composite = q6.data as CompositeResult | null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              💥 blast-radius
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Supply chain compromise impact analysis — powered by{' '}
              <span className="text-blue-400 font-medium">HydraDB</span> graph traversal
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-gray-500">Hydra Hack 2026 · Track 2A</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Incident context banner */}
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🚨</span>
            <div>
              <h2 className="text-red-400 font-semibold mb-1">
                TanStack Supply Chain Attack — May 11, 2026
              </h2>
              <p className="text-gray-300 text-sm">
                84 malicious versions across 42 <code className="bg-gray-800 px-1 rounded">@tanstack/*</code> packages were
                published via a hijacked CI/CD pipeline (GitHub Actions OIDC token exfiltration via
                cache poisoning). First documented npm attack with valid SLSA Build Level 3 attestations.
                This tool answers: <strong className="text-white">which of your services were exposed by 09:06?</strong>
              </p>
              <p className="text-yellow-500/80 text-xs mt-2">
                ⚠️ Service and Lockfile nodes are <strong>illustrative</strong> — they represent hypothetical internal consumers.
                Package graph, maintainers, and version timestamps are real npm registry data.
              </p>
            </div>
          </div>
        </div>

        {/* Search / input */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Analyze a Package Compromise</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                Package name
              </label>
              <input
                type="text"
                value={selectedPkg}
                onChange={(e) => setSelectedPkg(e.target.value)}
                placeholder="e.g. @tanstack/query-core"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="w-48">
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                Compromised version
              </label>
              <input
                type="text"
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
                placeholder="e.g. 5.80.7"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={runAllQueries}
                disabled={running}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
              >
                {running ? 'Querying HydraDB...' : '🔍 Compute Blast Radius'}
              </button>
            </div>
          </div>

          {/* Quick-select compromised packages */}
          {compromised.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-gray-500 mb-2">Quick-select known compromised packages:</p>
              <div className="flex flex-wrap gap-2">
                {compromised.slice(0, 8).map((c) => (
                  <button
                    key={c.package}
                    onClick={() => {
                      setSelectedPkg(c.package);
                      setSelectedVersion(c.compromised_versions[0] ?? '');
                    }}
                    className="text-xs bg-red-900/40 border border-red-700 text-red-300 hover:bg-red-800/60 px-3 py-1 rounded-full transition-colors"
                  >
                    {c.package}@{c.compromised_versions[0]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Q6 Composite summary (shown first as the headline answer) */}
        {(q6.data || q6.loading || q6.error) && (
          <div className="bg-gradient-to-r from-blue-950/60 to-purple-950/60 border border-blue-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs font-bold px-3 py-1 rounded">
                Q6 COMPOSITE
              </span>
              <h3 className="text-white font-bold text-lg">Blast Radius Summary</h3>
              {q6.data && !q6.loading && (
                <span className="ml-auto text-xs text-gray-400">
                  {(q6.data as CompositeResult).elapsed_ms}ms
                </span>
              )}
            </div>

            {q6.loading && (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-blue-500" />
                Computing full blast radius...
              </div>
            )}
            {q6.error && <p className="text-red-400 text-sm">{q6.error}</p>}
            {composite && (
              <>
                <p className="text-gray-200 text-base mb-4 leading-relaxed">{composite.summary}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Exposed Services', value: composite.exposed_services_count, color: 'text-red-400' },
                    { label: 'Exposed Lockfiles', value: composite.exposed_lockfiles_count, color: 'text-orange-400' },
                    { label: 'Packages at Risk', value: composite.packages_at_risk_count, color: 'text-yellow-400' },
                    { label: 'Typosquat Neighbors', value: composite.typosquat_neighbors.length, color: 'text-blue-400' },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-gray-900/60 rounded-lg p-3 text-center">
                      <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                      <div className="text-gray-400 text-xs mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>
                {composite.compromise_window && (
                  <div className="mt-4 text-xs text-gray-400 grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-gray-500">Compromised at:</span>{' '}
                      <span className="text-white">{new Date(composite.compromise_window.compromised_at).toUTCString()}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Contained at:</span>{' '}
                      <span className="text-white">{new Date(composite.compromise_window.compromise_window_end).toUTCString()}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Individual query panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Q1 */}
          <QueryPanel
            queryNum={1}
            title="Transitive Reverse-Dependency → Exposed Services"
            badge="algo.MSpaths · GraphBLAS"
            state={q1}
          >
            {q1.data && (
              <>
                <div className="mb-3">
                  <span className="text-xs text-gray-400">Method: </span>
                  <span className="text-xs text-blue-400">{(q1.data as QueryResult).method as string}</span>
                </div>
                {((q1.data as QueryResult).exposed_services as string[])?.length > 0 ? (
                  <div className="space-y-1">
                    {((q1.data as QueryResult).exposed_services as string[]).map((svc: string) => (
                      <div key={svc} className="flex items-center gap-2 bg-red-900/30 border border-red-800 rounded px-3 py-2">
                        <span className="text-red-400">⚠</span>
                        <span className="text-white text-sm font-mono">{svc}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No services exposed (or no path found — check ingestion).</p>
                )}
                <CypherBlock cypher={(q1.data as QueryResult).cypher as string} label="Cypher used" />
              </>
            )}
          </QueryPanel>

          {/* Q2 */}
          <QueryPanel queryNum={2} title="Compromise Window — Version Timeline" state={q2}>
            {q2.data && (
              <>
                {((q2.data as QueryResult).compromised_versions as Array<{semver:string;published_at:string;compromised_at:string;compromise_window_end:string}>)?.map((v) => (
                  <div key={v.semver} className="bg-gray-900 border border-yellow-800 rounded-lg p-4 mb-2">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="bg-red-700 text-white text-xs px-2 py-0.5 rounded font-mono">{v.semver}</span>
                      <span className="text-red-400 text-xs">COMPROMISED</span>
                    </div>
                    <div className="text-xs text-gray-400 space-y-1">
                      <div><span className="text-gray-500">Published:</span> {v.published_at}</div>
                      <div><span className="text-gray-500">Compromised at:</span> <span className="text-yellow-400">{v.compromised_at}</span></div>
                      <div><span className="text-gray-500">Contained at:</span> <span className="text-green-400">{v.compromise_window_end}</span></div>
                    </div>
                  </div>
                ))}
                {!((q2.data as QueryResult).compromised_versions as unknown[])?.length && (
                  <p className="text-gray-400 text-sm">No compromised versions found for this package.</p>
                )}
                <CypherBlock cypher={(q2.data as QueryResult).cypher as string} label="Cypher used" />
              </>
            )}
          </QueryPanel>

          {/* Q3 */}
          <QueryPanel queryNum={3} title="Lockfiles Resolved During Compromise Window" state={q3}>
            {q3.data && (
              <>
                {((q3.data as QueryResult).exposed_lockfiles as Array<{service:string;resolved_at:string;pinned_version:string}>)?.length > 0 ? (
                  <div className="space-y-2">
                    {((q3.data as QueryResult).exposed_lockfiles as Array<{service:string;resolved_at:string;pinned_version:string}>).map((lf, i) => (
                      <div key={i} className="bg-orange-900/20 border border-orange-800 rounded px-3 py-2 text-sm">
                        <span className="text-orange-300 font-mono">{lf.service}</span>
                        <span className="text-gray-400 text-xs ml-3">resolved at {lf.resolved_at}</span>
                        <span className="text-gray-500 text-xs ml-3">pinned: {lf.pinned_version}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No lockfiles resolved during the compromise window.</p>
                )}
                <CypherBlock cypher={(q3.data as QueryResult).cypher as string} label="Cypher used" />
              </>
            )}
          </QueryPanel>

          {/* Q4 */}
          <QueryPanel queryNum={4} title="Maintainer/Infrastructure Overlap" state={q4}>
            {q4.data && (
              <>
                <p className="text-gray-400 text-xs mb-3">
                  {(q4.data as QueryResult).packages_at_risk_count as number} other package(s) share maintainer access with the compromised package.
                </p>
                {((q4.data as QueryResult).maintainer_overlaps as Array<{maintainer:string;shared_packages:string[]}>)?.slice(0, 5).map((m) => (
                  <div key={m.maintainer} className="bg-gray-900 border border-gray-700 rounded px-3 py-2 mb-2 text-sm">
                    <span className="text-purple-300 font-mono">@{m.maintainer}</span>
                    <div className="text-gray-400 text-xs mt-1 flex flex-wrap gap-1">
                      {m.shared_packages.slice(0, 4).map((p: string) => (
                        <span key={p} className="bg-gray-800 px-1 rounded">{p}</span>
                      ))}
                      {m.shared_packages.length > 4 && <span>+{m.shared_packages.length - 4} more</span>}
                    </div>
                  </div>
                ))}
                <CypherBlock cypher={(q4.data as QueryResult).cypher as string} label="Cypher used" />
              </>
            )}
          </QueryPanel>

          {/* Q5 */}
          <QueryPanel queryNum={5} title="Typosquat Proximity" state={q5}>
            {q5.data && (
              <>
                <p className="text-gray-400 text-xs mb-3">
                  Edit distance ≤ 2 neighbors in the graph.{' '}
                  <span className="text-gray-500 italic">
                    (Computed in app layer via fastest-levenshtein — HydraDB OpenCypher subset has no string-distance function)
                  </span>
                </p>
                {((q5.data as QueryResult).candidates as Array<{name:string;edit_distance:number}>)?.length > 0 ? (
                  <div className="space-y-1">
                    {((q5.data as QueryResult).candidates as Array<{name:string;edit_distance:number}>).slice(0, 8).map((c) => (
                      <div key={c.name} className="flex items-center gap-2 text-sm">
                        <span className="text-xs bg-gray-700 rounded px-1 font-mono text-blue-300">d={c.edit_distance}</span>
                        <span className="text-gray-300 font-mono">{c.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No typosquat candidates found within edit distance 2.</p>
                )}
                <CypherBlock cypher={(q5.data as QueryResult).cypher_for_names as string} label="Cypher (fetch all names from HydraDB)" />
              </>
            )}
          </QueryPanel>

          {/* Q6 algo.MSpaths explanation */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-purple-700 text-white text-xs font-bold px-2 py-1 rounded">WHY HydraDB</span>
              <h3 className="text-white font-semibold text-sm">algo.MSpaths vs. Recursive CTEs</h3>
            </div>
            <div className="space-y-3 text-sm text-gray-300">
              <p>
                HydraDB&apos;s <code className="bg-gray-900 text-green-400 px-1 rounded">algo.MSpaths</code> resolves
                paths between many source and target values in a <strong className="text-white">single pinned storage snapshot</strong>,
                using compiled SuiteSparse GraphBLAS topology. No client-side query fan-out, no per-hop round trips.
              </p>
              <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-green-400 overflow-x-auto">
                {`CALL algo.MSpaths({
  sourceLabel: 'Version',
  sourceValues: ['@tanstack/query-core'],
  targetLabel: 'Service',
  relTypes: ['DEPENDS_ON'],
  maxLen: 6, pathCount: 20
})
YIELD path RETURN path`}
              </div>
              <p className="text-gray-400 text-xs">
                In <strong className="text-gray-300">Postgres</strong>: recursive CTE that allocates O(V·E) intermediate rows,
                doesn&apos;t scale past ~5 hops on large graphs. In a <strong className="text-gray-300">vector DB</strong>:
                the question doesn&apos;t exist — there are no edges, only similarity scores.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-800 mt-12 py-6 text-center text-gray-600 text-xs">
        blast-radius · Hydra Hack 2026 Track 2A · Data: npm registry API (real) · Services/Lockfiles: illustrative
      </footer>
    </div>
  );
}

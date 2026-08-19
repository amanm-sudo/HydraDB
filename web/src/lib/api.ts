// web/src/lib/api.ts
// Client-side API helpers for the blast-radius backend

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface CompromisedPackage {
  package: string;
  compromised_versions: string[];
}

export interface CompositeResult {
  query: number;
  description: string;
  elapsed_ms: number;
  packageName: string;
  semver: string;
  compromise_window: {
    version: string;
    published_at: string;
    compromised_at: string;
    compromise_window_end: string;
  } | null;
  exposed_services: string[];
  exposed_services_count: number;
  exposed_lockfiles: Array<{ service: string; resolved_at: string }>;
  exposed_lockfiles_count: number;
  maintainer_overlap: Array<{ maintainer: string; shared_packages: string[] }>;
  packages_at_risk: string[];
  packages_at_risk_count: number;
  typosquat_neighbors: Array<{ name: string; edit_distance: number }>;
  summary: string;
}

export interface QueryResult {
  query: number;
  description: string;
  cypher?: string;
  method?: string;
  [key: string]: unknown;
}

export async function fetchCompromised(): Promise<CompromisedPackage[]> {
  const res = await fetch(`${API_BASE}/api/compromised`);
  if (!res.ok) throw new Error(`Failed to fetch compromised packages: ${res.status}`);
  return res.json();
}

export async function fetchQ1(pkg: string, version: string): Promise<QueryResult> {
  const res = await fetch(`${API_BASE}/api/blast-radius/${encodeURIComponent(pkg)}/${version}/exposed-services`);
  if (!res.ok) throw new Error(`Q1 failed: ${res.status}`);
  return res.json();
}

export async function fetchQ2(pkg: string): Promise<QueryResult> {
  const res = await fetch(`${API_BASE}/api/blast-radius/${encodeURIComponent(pkg)}/compromise-window`);
  if (!res.ok) throw new Error(`Q2 failed: ${res.status}`);
  return res.json();
}

export async function fetchQ3(pkg: string, version: string): Promise<QueryResult> {
  const res = await fetch(`${API_BASE}/api/blast-radius/${encodeURIComponent(pkg)}/${version}/exposed-lockfiles`);
  if (!res.ok) throw new Error(`Q3 failed: ${res.status}`);
  return res.json();
}

export async function fetchQ4(pkg: string): Promise<QueryResult> {
  const res = await fetch(`${API_BASE}/api/blast-radius/${encodeURIComponent(pkg)}/maintainer-overlap`);
  if (!res.ok) throw new Error(`Q4 failed: ${res.status}`);
  return res.json();
}

export async function fetchQ5(pkg: string): Promise<QueryResult> {
  const res = await fetch(`${API_BASE}/api/blast-radius/${encodeURIComponent(pkg)}/typosquats`);
  if (!res.ok) throw new Error(`Q5 failed: ${res.status}`);
  return res.json();
}

export async function fetchComposite(pkg: string, version: string): Promise<CompositeResult> {
  const res = await fetch(`${API_BASE}/api/blast-radius/${encodeURIComponent(pkg)}/${version}/composite`);
  if (!res.ok) throw new Error(`Q6 failed: ${res.status}`);
  return res.json();
}

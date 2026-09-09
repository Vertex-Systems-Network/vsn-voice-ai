"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Repository = {
  id: number;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string;
};

type AuditResult = {
  ok: boolean;
  classification?: string;
  readiness?: { level?: string; control_files_present?: number; control_files_total?: number };
  protocol?: { detected?: boolean; version?: string | null; instance_status?: string | null; bootstrap_completed?: boolean | null };
  gaps?: string[];
  privacy_scope?: { source_code_read?: boolean; audited_paths?: string[]; result_persistence?: string };
  limitations?: string[];
  error?: string;
};

export default function CommunityClient() {
  const searchParams = useSearchParams();
  const installationId = useMemo(() => Number(searchParams.get("installation_id") ?? "0"), [searchParams]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selected, setSelected] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [auditing, setAuditing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);

  useEffect(() => {
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      setError("A valid GitHub Marketplace installation is required.");
      setLoadingRepos(false);
      return;
    }
    let cancelled = false;
    void fetch(`/api/v1/audit/repositories?installation_id=${installationId}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.ok !== true) throw new Error(body.error ?? "repository_discovery_failed");
        if (!cancelled) {
          const list = Array.isArray(body.repositories) ? body.repositories as Repository[] : [];
          setRepositories(list);
          setSelected(list[0]?.full_name ?? "");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "repository_discovery_failed");
      })
      .finally(() => { if (!cancelled) setLoadingRepos(false); });
    return () => { cancelled = true; };
  }, [installationId]);

  async function runAudit() {
    if (!selected) return;
    setAuditing(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/v1/audit/repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository: selected }),
      });
      const body = await response.json() as AuditResult;
      if (!response.ok || body.ok !== true) throw new Error(body.error ?? "repository_audit_failed");
      setResult(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "repository_audit_failed");
    } finally {
      setAuditing(false);
    }
  }

  return <main style={{ maxWidth: 920, margin: "48px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif" }}>
    <p style={{ fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>ANPOS Community</p>
    <h1>Repository Readiness Audit</h1>
    <p>Read-only audit of ten ANPOS control files. Application source code is not read and audit results are not persisted by this endpoint.</p>

    {loadingRepos ? <p>Loading authorized repositories…</p> : null}
    {!loadingRepos && repositories.length > 0 ? <section>
      <label htmlFor="repository"><strong>Repository</strong></label><br />
      <select id="repository" value={selected} onChange={(event) => setSelected(event.target.value)} style={{ marginTop: 8, minWidth: 320, padding: 8 }}>
        {repositories.map((repository) => <option key={repository.id} value={repository.full_name}>
          {repository.full_name}{repository.private ? " · private" : ""}{repository.archived ? " · archived" : ""}
        </option>)}
      </select>
      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={runAudit} disabled={auditing || !selected} style={{ padding: "10px 16px" }}>
          {auditing ? "Auditing…" : "Run readiness audit"}
        </button>
      </div>
    </section> : null}

    {!loadingRepos && repositories.length === 0 && !error ? <p>No repositories are available to this installation for the authenticated GitHub user.</p> : null}
    {error ? <p role="alert"><strong>Error:</strong> {error}</p> : null}

    {result ? <section style={{ marginTop: 32 }}>
      <h2>Result</h2>
      <dl>
        <dt>Classification</dt><dd>{result.classification ?? "unknown"}</dd>
        <dt>Readiness</dt><dd>{result.readiness?.level ?? "unknown"}</dd>
        <dt>Control files</dt><dd>{result.readiness?.control_files_present ?? 0}/{result.readiness?.control_files_total ?? 10}</dd>
        <dt>Protocol</dt><dd>{result.protocol?.version ?? "not detected"}</dd>
      </dl>
      {result.gaps?.length ? <><h3>Gaps</h3><ul>{result.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></> : <p>No baseline control-file gaps were detected by this bounded audit.</p>}
      <h3>Privacy boundary</h3>
      <p>Application source read: <strong>{result.privacy_scope?.source_code_read ? "yes" : "no"}</strong>. Result persistence: {result.privacy_scope?.result_persistence ?? "unknown"}.</p>
      {result.limitations?.length ? <><h3>Limitations</h3><ul>{result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></> : null}
    </section> : null}
  </main>;
}

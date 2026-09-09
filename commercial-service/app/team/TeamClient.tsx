"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type SeatAssignment = {
  github_user_id: number;
  github_login: string;
  status: "active" | "revoked";
  assigned_at: string | null;
  revoked_at: string | null;
};

type TeamSummary = {
  ok: true;
  installation_id: number;
  viewer: { github_user_id: number; github_login: string; organization_role: "admin" };
  account: { id: number; login: string; type: "Organization" };
  plan: {
    id: string;
    state: string;
    billing_cycle: string | null;
    marketplace_plan_id: number | null;
    billing_updated_at: string | null;
    record_updated_at: string | null;
    billing_authority: "github_marketplace";
  };
  seats: {
    capacity: number;
    active: number;
    available: number;
    assignments: SeatAssignment[];
  };
  support: {
    contractual_support_activated_by_source: false;
    note: string;
  };
};

type ApiError = { ok?: false; error?: string };

function messageFor(error: string): string {
  const map: Record<string, string> = {
    unauthorized_github: "A valid GitHub session is required. Open ANPOS from the GitHub Marketplace setup flow and authenticate again.",
    organization_account_required: "Team administration is available only for an organization installation.",
    organization_admin_required: "GitHub organization owner/admin access is required to manage ANPOS seats.",
    organization_team_features_required: "The reconciled Marketplace plan does not currently include ANPOS organization team features.",
    entitlement_not_active: "The Marketplace entitlement is not active. Billing changes must be resolved in GitHub Marketplace.",
    marketplace_installation_user_access_required: "The authenticated GitHub user can no longer access this App installation.",
  };
  return map[error] ?? error.replaceAll("_", " ");
}

export default function TeamClient() {
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/team/summary", { cache: "no-store" });
      const body = await response.json() as TeamSummary | ApiError;
      if (!response.ok || body.ok !== true) throw new Error((body as ApiError).error ?? "team_dashboard_unavailable");
      setSummary(body as TeamSummary);
    } catch (reason) {
      setSummary(null);
      const code = reason instanceof Error ? reason.message : "team_dashboard_unavailable";
      setError(messageFor(code));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function assignSeat(event: FormEvent) {
    event.preventDefault();
    if (!summary || !username.trim()) return;
    setMutating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: summary.account.id, username: username.trim() }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; assigned?: boolean; already_active?: boolean };
      if (!response.ok || body.ok !== true) throw new Error(body.error ?? "seat_assignment_failed");
      setNotice(body.already_active ? "That GitHub member already has an active seat." : "Seat assigned. Access reconciliation has been updated.");
      setUsername("");
      await load();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "seat_assignment_failed";
      setError(messageFor(code));
    } finally {
      setMutating(false);
    }
  }

  async function revokeSeat(userId: number, login: string) {
    if (!summary || !window.confirm(`Revoke the active ANPOS seat for ${login}?`)) return;
    setMutating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/seats", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: summary.account.id, user_id: userId }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; revoked?: boolean; not_active?: boolean };
      if (!response.ok || body.ok !== true) throw new Error(body.error ?? "seat_revocation_failed");
      setNotice(body.not_active ? "That seat was already inactive." : "Seat revoked. Premium template access reconciliation was queued where applicable.");
      await load();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "seat_revocation_failed";
      setError(messageFor(code));
    } finally {
      setMutating(false);
    }
  }

  return <main style={{ maxWidth: 980, margin: "48px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif" }}>
    <p style={{ fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>ANPOS Team</p>
    <h1>Organization Administration</h1>
    <p>Manage entitlement-bound GitHub organization seats. GitHub Marketplace remains the billing authority; this page reflects reconciled state and does not change purchases, billing cycles, prices, or subscriptions.</p>

    {loading ? <p>Reconciling organization entitlement and seat state…</p> : null}
    {error ? <p role="alert"><strong>Error:</strong> {error}</p> : null}
    {notice ? <p role="status"><strong>{notice}</strong></p> : null}

    {summary ? <>
      <section style={{ marginTop: 28 }}>
        <h2>{summary.account.login}</h2>
        <dl>
          <dt>Plan</dt><dd>{summary.plan.id}</dd>
          <dt>Entitlement state</dt><dd>{summary.plan.state}</dd>
          <dt>Billing cycle</dt><dd>{summary.plan.billing_cycle ?? "not reported"}</dd>
          <dt>Billing authority</dt><dd>GitHub Marketplace</dd>
          <dt>Signed-in admin</dt><dd>@{summary.viewer.github_login}</dd>
        </dl>
        <p>Plan upgrades, downgrades, cancellation, trial state, renewal and payment details must be managed through GitHub Marketplace. ANPOS reconciles that state before exposing Team administration.</p>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Seat usage</h2>
        <p><strong>{summary.seats.active}</strong> active · <strong>{summary.seats.available}</strong> available · <strong>{summary.seats.capacity}</strong> total capacity</p>
        <form onSubmit={assignSeat} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 16 }}>
          <label>
            <span style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>GitHub organization member</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="github-username"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={mutating || summary.seats.available <= 0}
              style={{ padding: 10, minWidth: 260 }}
            />
          </label>
          <button type="submit" disabled={mutating || !username.trim() || summary.seats.available <= 0} style={{ padding: "10px 16px" }}>
            {mutating ? "Updating…" : "Assign seat"}
          </button>
        </form>
        {summary.seats.available <= 0 ? <p>Seat capacity is full. Change Marketplace seat quantity/plan first; ANPOS does not bypass purchased capacity.</p> : null}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Seat assignments</h2>
        {summary.seats.assignments.length === 0 ? <p>No seat assignments have been recorded yet.</p> : <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th align="left">GitHub user</th><th align="left">Status</th><th align="left">Assigned</th><th align="left">Action</th></tr></thead>
            <tbody>{summary.seats.assignments.map((seat) => <tr key={seat.github_user_id}>
              <td style={{ padding: "10px 0" }}>@{seat.github_login}</td>
              <td>{seat.status}</td>
              <td>{seat.assigned_at ? new Date(seat.assigned_at).toLocaleString() : "—"}</td>
              <td>{seat.status === "active" ? <button type="button" disabled={mutating} onClick={() => void revokeSeat(seat.github_user_id, seat.github_login)}>Revoke</button> : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Support boundary</h2>
        <p>{summary.support.note}</p>
        <p>This source UI does not activate a staffed support channel, response-time SLA, resolution target, or service credits.</p>
      </section>
    </> : null}

    <p style={{ marginTop: 32 }}><a href="/community">Open Community repository audit</a></p>
  </main>;
}

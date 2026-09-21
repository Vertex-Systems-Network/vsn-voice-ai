'use client';

import { useState } from 'react';

import { WorkspaceTeamWorkspace } from '../components/workspace-team-workspace';
import {
  workspaceSessionView,
  type WorkspaceSessionState,
} from '../lib/workspace-session-state';

const workspaceNavigation = [
  { href: '#overview', label: 'Overview' },
  { href: '#meetings', label: 'Meetings' },
  { href: '#devices', label: 'Devices' },
  { href: '#team', label: 'Team' },
  { href: '#settings', label: 'Settings' },
] as const;

const workspaceAreas = [
  {
    id: 'meetings',
    eyebrow: 'Meeting library',
    title: 'No meetings yet',
    description:
      'Authorized meeting records and artifacts will appear here after capture and consent-enabled workflows are connected.',
  },
  {
    id: 'settings',
    eyebrow: 'Preferences',
    title: 'Settings are not connected yet',
    description:
      'Notification and workspace preferences stay unset until the control API exposes their persisted contracts.',
  },
] as const;

export default function WorkspacePage() {
  const [sessionState, setSessionState] =
    useState<WorkspaceSessionState>('checking');
  const sessionView = workspaceSessionView(sessionState);

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <div>
          <p className="brand-kicker">VSN Voice AI</p>
          <p className="brand-title">Workspace</p>
        </div>
        <div
          className="session-state"
          data-tone={sessionView.tone}
          role="status"
          aria-live="polite"
        >
          {sessionView.label}
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar">
          <nav aria-label="Workspace navigation">
            <ul className="nav-list">
              {workspaceNavigation.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <p className="sidebar-note">
            This shell never invents user identity. Tenant-bound data loads only after the authenticated workspace directory succeeds and an active organization is explicitly selected.
          </p>
        </aside>

        <main id="main-content" className="main-content">
          <section id="overview" className="hero" aria-labelledby="workspace-title">
            <p className="eyebrow">Control plane</p>
            <h1 id="workspace-title">Your communication workspace, without invented account state.</h1>
            <p className="hero-copy">
              The web application now derives authentication state from the workspace directory and loads tenant-bound access, team and device data only after an active organization is explicitly selected.
            </p>
            <div className="status-row" aria-label="Workspace implementation status">
              <span>Responsive shell</span>
              <span>Keyboard focus</span>
              <span>Tenant-safe boundary</span>
            </div>
          </section>

          <section className="section-heading" aria-labelledby="workspace-areas-title">
            <div>
              <p className="eyebrow">Workspace areas</p>
              <h2 id="workspace-areas-title">Ready for authenticated data contracts</h2>
            </div>
            <p>
              No production credential, identity provider, tenant record or meeting artifact is embedded in this frontend scaffold.
            </p>
          </section>

          <div className="area-grid">
            {workspaceAreas.slice(0, 1).map((area) => (
              <section className="area-card" id={area.id} key={area.id} aria-labelledby={`${area.id}-title`}>
                <p className="eyebrow">{area.eyebrow}</p>
                <h3 id={`${area.id}-title`}>{area.title}</h3>
                <p>{area.description}</p>
                <span className="empty-state-badge">Empty state</span>
              </section>
            ))}

            <WorkspaceTeamWorkspace onSessionStateChange={setSessionState} />

            {workspaceAreas.slice(1).map((area) => (
              <section className="area-card" id={area.id} key={area.id} aria-labelledby={`${area.id}-title`}>
                <p className="eyebrow">{area.eyebrow}</p>
                <h3 id={`${area.id}-title`}>{area.title}</h3>
                <p>{area.description}</p>
                <span className="empty-state-badge">Empty state</span>
              </section>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

'use client';

import { type FormEvent, useEffect, useState } from 'react';

import { issueWorkspaceDesktopLink } from '../lib/workspace-desktop-link-client';
import { revokeWorkspaceDesktopLink } from '../lib/workspace-desktop-link-revoke-client';
import { requestWorkspaceDesktopLinkStatus } from '../lib/workspace-desktop-link-status-client';
import {
  requestWorkspaceLinkedDesktops,
  type WorkspaceLinkedDesktopInventoryResult,
} from '../lib/workspace-linked-desktop-client';
import {
  workspaceDesktopLinkCancelledView,
  workspaceDesktopLinkCancelUnavailableView,
  workspaceDesktopLinkExpiredView,
  workspaceDesktopLinkIdleView,
  workspaceDesktopLinkIssuingView,
  workspaceDesktopLinkLinkedView,
  workspaceDesktopLinkPanelView,
  workspaceDesktopLinkSelectionRequiredView,
  workspaceDesktopLinkUnavailableView,
  type WorkspaceDesktopLinkPanelView,
} from '../lib/workspace-desktop-link-panel-state';

export interface WorkspaceDesktopLinkPanelProps {
  readonly organizationId: string | null;
}

export function WorkspaceDesktopLinkPanel({
  organizationId,
}: WorkspaceDesktopLinkPanelProps) {
  const [deviceId, setDeviceId] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const [linkedInventory, setLinkedInventory] =
    useState<WorkspaceLinkedDesktopInventoryResult | null>(null);
  const [view, setView] = useState<WorkspaceDesktopLinkPanelView>(() =>
    organizationId === null
      ? workspaceDesktopLinkSelectionRequiredView()
      : workspaceDesktopLinkIdleView(),
  );

  useEffect(() => {
    setDeviceId('');
    setCancelling(false);
    setInventoryRevision(0);
    setLinkedInventory(null);
    setView(
      organizationId === null
        ? workspaceDesktopLinkSelectionRequiredView()
        : workspaceDesktopLinkIdleView(),
    );
  }, [organizationId]);

  useEffect(() => {
    if (organizationId === null) {
      setLinkedInventory(null);
      return;
    }

    let cancelled = false;
    setLinkedInventory(null);

    void requestWorkspaceLinkedDesktops(
      globalThis.fetch.bind(globalThis),
      organizationId,
    ).then((result) => {
      if (!cancelled) {
        setLinkedInventory(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [inventoryRevision, organizationId]);

  useEffect(() => {
    const exchange = view.exchange;
    if (exchange === null) {
      return;
    }

    const remainingMs = Date.parse(exchange.expires_at) - Date.now();
    if (remainingMs <= 0) {
      setView(workspaceDesktopLinkExpiredView());
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setView(workspaceDesktopLinkExpiredView());
    }, remainingMs);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [view.exchange]);

  useEffect(() => {
    const exchange = view.exchange;
    if (exchange === null || organizationId === null || cancelling) {
      return;
    }

    let cancelled = false;

    const refreshStatus = async () => {
      const result = await requestWorkspaceDesktopLinkStatus(
        globalThis.fetch.bind(globalThis),
        organizationId,
        exchange.record_id,
      );
      if (cancelled) {
        return;
      }
      if (result.status === 'ready') {
        if (result.data.device_id !== deviceId.trim()) {
          setView(workspaceDesktopLinkUnavailableView());
          return;
        }
        if (result.data.status === 'consumed') {
          setView(workspaceDesktopLinkLinkedView());
          setInventoryRevision((current) => current + 1);
          return;
        }
        if (
          result.data.status === 'expired' ||
          result.data.status === 'revoked'
        ) {
          setView(
            result.data.status === 'revoked'
              ? workspaceDesktopLinkCancelledView()
              : workspaceDesktopLinkExpiredView(),
          );
        }
        return;
      }
      if (
        result.status === 'authentication_required' ||
        result.status === 'forbidden' ||
        result.status === 'invalid_response'
      ) {
        setView(workspaceDesktopLinkUnavailableView());
      }
    };

    void refreshStatus();
    const intervalId = globalThis.setInterval(() => {
      void refreshStatus();
    }, 2_000);

    return () => {
      cancelled = true;
      globalThis.clearInterval(intervalId);
    };
  }, [cancelling, deviceId, organizationId, view.exchange]);

  const issuing = view.badge === 'Issuing';
  const busy = issuing || cancelling;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (organizationId === null || issuing) {
      return;
    }

    setView(workspaceDesktopLinkIssuingView());
    const result = await issueWorkspaceDesktopLink(
      globalThis.fetch.bind(globalThis),
      organizationId,
      deviceId,
    );
    setView(workspaceDesktopLinkPanelView(result));
  }

  async function handleCancel() {
    const exchange = view.exchange;
    if (
      organizationId === null ||
      exchange === null ||
      cancelling
    ) {
      return;
    }

    setCancelling(true);
    const result = await revokeWorkspaceDesktopLink(
      globalThis.fetch.bind(globalThis),
      organizationId,
      exchange.record_id,
    );
    setCancelling(false);

    if (result.status === 'ready') {
      setView(workspaceDesktopLinkCancelledView());
      return;
    }
    if (
      result.status === 'authentication_required' ||
      result.status === 'forbidden' ||
      result.status === 'invalid_response'
    ) {
      setView(workspaceDesktopLinkUnavailableView());
      return;
    }
    if (Date.now() >= Date.parse(exchange.expires_at)) {
      setView(workspaceDesktopLinkExpiredView());
      return;
    }
    setView(workspaceDesktopLinkCancelUnavailableView(exchange));
  }

  return (
    <section
      className="area-card workspace-desktop-link-panel"
      id="devices"
      aria-labelledby="desktop-link-title"
      aria-busy={busy}
    >
      <p className="eyebrow">Desktop linking</p>
      <h3 id="desktop-link-title">{view.heading}</h3>
      <p>{view.description}</p>
      <span
        className="empty-state-badge"
        data-tone={view.tone}
        role="status"
        aria-live="polite"
      >
        {view.badge}
      </span>

      {organizationId !== null ? (
        <form className="desktop-link-form" onSubmit={handleSubmit}>
          <label htmlFor="desktop-link-device-id">Desktop device ID</label>
          <input
            id="desktop-link-device-id"
            name="device_id"
            type="text"
            autoComplete="off"
            maxLength={256}
            value={deviceId}
            onChange={(event) => {
              setDeviceId(event.currentTarget.value);
              if (view.exchange !== null) {
                setView(workspaceDesktopLinkIdleView());
              }
            }}
            disabled={busy}
            required
          />
          <button type="submit" disabled={busy}>
            {issuing ? 'Issuing…' : 'Create one-time link'}
          </button>
        </form>
      ) : null}

      {organizationId !== null ? (
        <div
          className="linked-desktop-inventory"
          aria-labelledby="linked-desktops-title"
          aria-live="polite"
        >
          <h4 id="linked-desktops-title">Linked desktops</h4>
          {linkedInventory === null ? (
            <p>Loading linked desktops…</p>
          ) : linkedInventory.status !== 'ready' ? (
            <p>Linked desktops are temporarily unavailable.</p>
          ) : linkedInventory.data.devices.length === 0 ? (
            <p>No linked desktops yet.</p>
          ) : (
            <>
              <ul className="linked-desktop-list">
                {linkedInventory.data.devices.map((device) => (
                  <li key={device.record_id}>
                    <strong>{device.device_id}</strong>
                    <span>
                      Linked{' '}
                      <time dateTime={device.linked_at}>
                        {device.linked_at}
                      </time>
                    </span>
                  </li>
                ))}
              </ul>
              {linkedInventory.data.has_more ? (
                <p className="linked-desktop-limit-note">
                  More linked desktops exist than this bounded view shows.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {view.exchange !== null ? (
        <div className="desktop-link-exchange" role="group" aria-label="One-time desktop link exchange">
          <span>Exchange ID</span>
          <code>{view.exchange.record_id}</code>
          <span>One-time token</span>
          <code>{view.exchange.exchange_token}</code>
          <span>Expires</span>
          <time dateTime={view.exchange.expires_at}>{view.exchange.expires_at}</time>
          <button
            className="desktop-link-cancel"
            type="button"
            onClick={() => void handleCancel()}
            disabled={busy}
          >
            {cancelling ? 'Cancelling…' : 'Cancel desktop link'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

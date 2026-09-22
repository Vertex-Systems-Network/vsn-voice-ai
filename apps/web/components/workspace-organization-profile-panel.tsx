'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { requestWorkspaceBootstrap } from '../lib/workspace-bootstrap-client';
import {
  requestWorkspaceOrganizationProfile,
  updateWorkspaceOrganizationProfile,
} from '../lib/workspace-organization-profile-client';

export interface WorkspaceOrganizationProfilePanelProps {
  readonly organizationId: string | null;
}

type PanelStatus =
  | 'unselected'
  | 'loading'
  | 'ready'
  | 'authentication_required'
  | 'forbidden'
  | 'invalid_response'
  | 'unavailable';

function statusCopy(status: Exclude<PanelStatus, 'ready'>): {
  heading: string;
  description: string;
  badge: string;
} {
  switch (status) {
    case 'unselected':
      return {
        heading: 'Select a workspace for organization settings',
        description:
          'Organization display settings stay unloaded until an active workspace is explicitly selected.',
        badge: 'No workspace selected',
      };
    case 'loading':
      return {
        heading: 'Loading organization settings',
        description: 'Reading the selected tenant’s display profile.',
        badge: 'Loading',
      };
    case 'authentication_required':
      return {
        heading: 'Authentication required',
        description:
          'Organization settings are unavailable until the workspace session is authenticated.',
        badge: 'Signed out',
      };
    case 'forbidden':
      return {
        heading: 'Organization settings unavailable',
        description:
          'The selected membership does not authorize this organization profile.',
        badge: 'Access denied',
      };
    case 'invalid_response':
      return {
        heading: 'Organization settings rejected',
        description:
          'The organization profile response did not match the closed tenant-bound contract.',
        badge: 'Invalid response',
      };
    case 'unavailable':
      return {
        heading: 'Organization settings unavailable',
        description:
          'The organization profile service could not be reached safely. No local fallback was invented.',
        badge: 'Unavailable',
      };
  }
}

export function WorkspaceOrganizationProfilePanel({
  organizationId,
}: WorkspaceOrganizationProfilePanelProps) {
  const [status, setStatus] = useState<PanelStatus>(
    organizationId === null ? 'unselected' : 'loading',
  );
  const [displayName, setDisplayName] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle');
  const activeOrganizationId = useRef<string | null>(organizationId);
  activeOrganizationId.current = organizationId;

  useEffect(() => {
    let cancelled = false;
    setDisplayName('');
    setCanManage(false);
    setSaveState('idle');

    if (organizationId === null) {
      setStatus('unselected');
      return () => {
        cancelled = true;
      };
    }

    setStatus('loading');
    void requestWorkspaceOrganizationProfile(
      globalThis.fetch.bind(globalThis),
      organizationId,
    ).then((result) => {
      if (cancelled) return;
      if (result.status === 'ready') {
        setDisplayName(result.data.display_name);
        setStatus('ready');
      } else {
        setStatus(result.status);
      }
    });

    void requestWorkspaceBootstrap(
      globalThis.fetch.bind(globalThis),
      organizationId,
    ).then((result) => {
      if (cancelled) return;
      setCanManage(
        result.status === 'ready' &&
          result.data.authorization.permissions.includes('team.manage'),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      organizationId === null ||
      !canManage ||
      saveState === 'saving'
    ) {
      return;
    }

    const requestOrganizationId = organizationId;
    setSaveState('saving');
    const result = await updateWorkspaceOrganizationProfile(
      globalThis.fetch.bind(globalThis),
      requestOrganizationId,
      { display_name: displayName },
    );
    if (activeOrganizationId.current !== requestOrganizationId) {
      return;
    }

    if (result.status === 'ready') {
      setDisplayName(result.data.display_name);
      setSaveState('saved');
      return;
    }

    if (
      result.status === 'authentication_required' ||
      result.status === 'forbidden'
    ) {
      setCanManage(false);
    }
    setSaveState('failed');
  }

  if (status !== 'ready') {
    const copy = statusCopy(status);
    return (
      <section
        className="area-card workspace-organization-profile-panel"
        id="organization-settings"
        aria-labelledby="organization-settings-title"
        aria-busy={status === 'loading'}
      >
        <p className="eyebrow">Organization settings</p>
        <h3 id="organization-settings-title">{copy.heading}</h3>
        <p>{copy.description}</p>
        <span className="empty-state-badge" role="status" aria-live="polite">
          {copy.badge}
        </span>
      </section>
    );
  }

  return (
    <section
      className="area-card workspace-organization-profile-panel"
      id="organization-settings"
      aria-labelledby="organization-settings-title"
    >
      <p className="eyebrow">Organization settings</p>
      <h3 id="organization-settings-title">
        {displayName.length > 0 ? displayName : 'Unnamed workspace'}
      </h3>
      <p>
        This display profile belongs to the selected tenant and contains no
        user or session identity fields.
      </p>

      {canManage ? (
        <form
          className="workspace-organization-profile-form"
          onSubmit={handleSubmit}
        >
          <label>
            <span>Organization display name</span>
            <input
              type="text"
              name="display_name"
              value={displayName}
              maxLength={100}
              autoComplete="organization"
              onChange={(event) => {
                setDisplayName(event.target.value);
                setSaveState('idle');
              }}
              disabled={saveState === 'saving'}
            />
          </label>
          <button type="submit" disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Saving…' : 'Save organization name'}
          </button>
          <span
            className="workspace-organization-profile-save-state"
            role="status"
            aria-live="polite"
          >
            {saveState === 'saved'
              ? 'Organization name saved'
              : saveState === 'failed'
                ? 'Organization name was not saved'
                : ''}
          </span>
        </form>
      ) : (
        <dl className="workspace-organization-profile-readonly">
          <div>
            <dt>Display name</dt>
            <dd>{displayName.length > 0 ? displayName : 'Not set'}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

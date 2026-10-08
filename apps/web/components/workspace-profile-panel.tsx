'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  requestWorkspaceProfile,
  updateWorkspaceProfile,
  type WorkspaceProfileValues,
} from '../lib/workspace-profile-client';

export interface WorkspaceProfilePanelProps {
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
        heading: 'Select a workspace for your profile',
        description:
          'Your workspace profile stays unloaded until an active workspace is explicitly selected.',
        badge: 'No workspace selected',
      };
    case 'loading':
      return {
        heading: 'Loading workspace profile',
        description:
          'Reading the authenticated subject’s tenant-bound profile.',
        badge: 'Loading',
      };
    case 'authentication_required':
      return {
        heading: 'Authentication required',
        description:
          'Your workspace profile is unavailable until the workspace session is authenticated.',
        badge: 'Signed out',
      };
    case 'forbidden':
      return {
        heading: 'Workspace profile unavailable',
        description:
          'The selected membership does not authorize access to this profile.',
        badge: 'Access denied',
      };
    case 'invalid_response':
      return {
        heading: 'Workspace profile rejected',
        description:
          'The profile response did not match the closed tenant-bound contract.',
        badge: 'Invalid response',
      };
    case 'unavailable':
      return {
        heading: 'Workspace profile unavailable',
        description:
          'The profile service could not be reached safely. No local fallback was invented.',
        badge: 'Unavailable',
      };
  }
}

export function WorkspaceProfilePanel({
  organizationId,
}: WorkspaceProfilePanelProps) {
  const [status, setStatus] = useState<PanelStatus>(
    organizationId === null ? 'unselected' : 'loading',
  );
  const [profile, setProfile] = useState<WorkspaceProfileValues | null>(null);
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle');
  const activeOrganizationId = useRef<string | null>(organizationId);
  activeOrganizationId.current = organizationId;

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setSaveState('idle');

    if (organizationId === null) {
      setStatus('unselected');
      return () => {
        cancelled = true;
      };
    }

    setStatus('loading');
    void requestWorkspaceProfile(
      globalThis.fetch.bind(globalThis),
      organizationId,
    ).then((result) => {
      if (cancelled) return;
      if (result.status === 'ready') {
        setProfile({
          display_name: result.data.display_name,
          job_title: result.data.job_title,
        });
        setStatus('ready');
      } else {
        setStatus(result.status);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  function setProfileField(
    key: keyof WorkspaceProfileValues,
    value: string,
  ): void {
    setSaveState('idle');
    setProfile((current) =>
      current === null ? current : { ...current, [key]: value },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      organizationId === null ||
      profile === null ||
      saveState === 'saving'
    ) {
      return;
    }

    setSaveState('saving');
    const requestOrganizationId = organizationId;
    const result = await updateWorkspaceProfile(
      globalThis.fetch.bind(globalThis),
      requestOrganizationId,
      profile,
    );
    if (activeOrganizationId.current !== requestOrganizationId) {
      return;
    }
    if (result.status === 'ready') {
      setProfile({
        display_name: result.data.display_name,
        job_title: result.data.job_title,
      });
      setSaveState('saved');
      return;
    }
    setSaveState('failed');
    setStatus(result.status);
  }

  if (status !== 'ready' || profile === null) {
    const copy = statusCopy(status === 'ready' ? 'invalid_response' : status);
    return (
      <section
        className="area-card workspace-profile-panel"
        id="profile"
        aria-labelledby="profile-title"
        aria-busy={status === 'loading'}
      >
        <p className="eyebrow">Account profile</p>
        <h3 id="profile-title">{copy.heading}</h3>
        <p>{copy.description}</p>
        <span className="empty-state-badge" role="status" aria-live="polite">
          {copy.badge}
        </span>
      </section>
    );
  }

  return (
    <section
      className="area-card workspace-profile-panel"
      id="profile"
      aria-labelledby="profile-title"
    >
      <p className="eyebrow">Account profile</p>
      <h3 id="profile-title">Workspace profile</h3>
      <p>
        This profile is persisted only for the authenticated user in the
        selected workspace.
      </p>

      <form className="workspace-profile-form" onSubmit={handleSubmit}>
        <label>
          <span>Display name</span>
          <input
            type="text"
            name="display_name"
            value={profile.display_name}
            maxLength={80}
            autoComplete="name"
            onChange={(event) =>
              setProfileField('display_name', event.target.value)
            }
            disabled={saveState === 'saving'}
          />
        </label>
        <label>
          <span>Job title</span>
          <input
            type="text"
            name="job_title"
            value={profile.job_title}
            maxLength={120}
            autoComplete="organization-title"
            onChange={(event) =>
              setProfileField('job_title', event.target.value)
            }
            disabled={saveState === 'saving'}
          />
        </label>
        <button type="submit" disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Saving…' : 'Save profile'}
        </button>
        <span
          className="workspace-profile-save-state"
          role="status"
          aria-live="polite"
        >
          {saveState === 'saved'
            ? 'Workspace profile saved'
            : saveState === 'failed'
              ? 'Workspace profile was not saved'
              : ''}
        </span>
      </form>
    </section>
  );
}

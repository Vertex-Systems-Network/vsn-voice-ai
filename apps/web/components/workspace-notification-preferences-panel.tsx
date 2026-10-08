'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  requestWorkspaceNotificationPreferences,
  updateWorkspaceNotificationPreferences,
  type WorkspaceNotificationPreferenceValues,
} from '../lib/workspace-notification-preferences-client';

export interface WorkspaceNotificationPreferencesPanelProps {
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

const preferenceLabels = [
  ['meeting_reminders', 'Meeting reminders'],
  ['transcript_ready', 'Transcript ready'],
  ['action_items', 'Action items'],
  ['desktop_link_events', 'Desktop link events'],
] as const;

function statusCopy(status: Exclude<PanelStatus, 'ready'>): {
  heading: string;
  description: string;
  badge: string;
} {
  switch (status) {
    case 'unselected':
      return {
        heading: 'Select a workspace for notification settings',
        description:
          'Notification preferences stay unloaded until an active workspace is explicitly selected.',
        badge: 'No workspace selected',
      };
    case 'loading':
      return {
        heading: 'Loading notification settings',
        description:
          'Reading the authenticated subject’s tenant-bound preferences.',
        badge: 'Loading',
      };
    case 'authentication_required':
      return {
        heading: 'Authentication required',
        description:
          'Notification settings are unavailable until the workspace session is authenticated.',
        badge: 'Signed out',
      };
    case 'forbidden':
      return {
        heading: 'Notification settings unavailable',
        description:
          'The selected membership does not authorize access to these preferences.',
        badge: 'Access denied',
      };
    case 'invalid_response':
      return {
        heading: 'Notification settings rejected',
        description:
          'The settings response did not match the closed tenant-bound contract.',
        badge: 'Invalid response',
      };
    case 'unavailable':
      return {
        heading: 'Notification settings unavailable',
        description:
          'The settings service could not be reached safely. No local fallback was invented.',
        badge: 'Unavailable',
      };
  }
}

export function WorkspaceNotificationPreferencesPanel({
  organizationId,
}: WorkspaceNotificationPreferencesPanelProps) {
  const [status, setStatus] = useState<PanelStatus>(
    organizationId === null ? 'unselected' : 'loading',
  );
  const [preferences, setPreferences] =
    useState<WorkspaceNotificationPreferenceValues | null>(null);
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle');
  const activeOrganizationId = useRef<string | null>(organizationId);
  activeOrganizationId.current = organizationId;

  useEffect(() => {
    let cancelled = false;
    setPreferences(null);
    setSaveState('idle');

    if (organizationId === null) {
      setStatus('unselected');
      return () => {
        cancelled = true;
      };
    }

    setStatus('loading');
    void requestWorkspaceNotificationPreferences(
      globalThis.fetch.bind(globalThis),
      organizationId,
    ).then((result) => {
      if (cancelled) return;
      if (result.status === 'ready') {
        setPreferences({
          meeting_reminders: result.data.meeting_reminders,
          transcript_ready: result.data.transcript_ready,
          action_items: result.data.action_items,
          desktop_link_events: result.data.desktop_link_events,
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

  function setPreference(
    key: keyof WorkspaceNotificationPreferenceValues,
    value: boolean,
  ): void {
    setSaveState('idle');
    setPreferences((current) =>
      current === null ? current : { ...current, [key]: value },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      organizationId === null ||
      preferences === null ||
      saveState === 'saving'
    ) {
      return;
    }

    setSaveState('saving');
    const requestOrganizationId = organizationId;
    const result = await updateWorkspaceNotificationPreferences(
      globalThis.fetch.bind(globalThis),
      requestOrganizationId,
      preferences,
    );
    if (activeOrganizationId.current !== requestOrganizationId) {
      return;
    }
    if (result.status === 'ready') {
      setPreferences({
        meeting_reminders: result.data.meeting_reminders,
        transcript_ready: result.data.transcript_ready,
        action_items: result.data.action_items,
        desktop_link_events: result.data.desktop_link_events,
      });
      setSaveState('saved');
      return;
    }
    setSaveState('failed');
    setStatus(result.status);
  }

  if (status !== 'ready' || preferences === null) {
    const copy = statusCopy(status === 'ready' ? 'invalid_response' : status);
    return (
      <section
        className="area-card notification-preferences-panel"
        id="settings"
        aria-labelledby="settings-title"
        aria-busy={status === 'loading'}
      >
        <p className="eyebrow">Preferences</p>
        <h3 id="settings-title">{copy.heading}</h3>
        <p>{copy.description}</p>
        <span className="empty-state-badge" role="status" aria-live="polite">
          {copy.badge}
        </span>
      </section>
    );
  }

  return (
    <section
      className="area-card notification-preferences-panel"
      id="settings"
      aria-labelledby="settings-title"
    >
      <p className="eyebrow">Preferences</p>
      <h3 id="settings-title">Notification settings</h3>
      <p>
        These preferences are persisted only for the authenticated user in the
        selected workspace.
      </p>

      <form className="notification-preferences-form" onSubmit={handleSubmit}>
        <fieldset disabled={saveState === 'saving'}>
          <legend>Workspace notifications</legend>
          {preferenceLabels.map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={(event) => setPreference(key, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Saving…' : 'Save notification settings'}
        </button>
        <span
          className="notification-preferences-save-state"
          role="status"
          aria-live="polite"
        >
          {saveState === 'saved'
            ? 'Notification settings saved'
            : saveState === 'failed'
              ? 'Notification settings were not saved'
              : ''}
        </span>
      </form>
    </section>
  );
}

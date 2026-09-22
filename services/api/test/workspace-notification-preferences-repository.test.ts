import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import { AuthorizationDeniedError } from '../src/organizations/tenant-authorization.js';
import {
  DEFAULT_WORKSPACE_NOTIFICATION_PREFERENCES,
  loadWorkspaceNotificationPreferences,
  saveWorkspaceNotificationPreferences,
  type WorkspaceNotificationPreferenceValues,
  type WorkspaceNotificationPreferencesRepository,
} from '../src/workspace/workspace-notification-preferences-repository.js';

const principal: AuthenticatedPrincipal = {
  subjectId: 'user_123',
  sessionId: 'session_internal',
};

const membership: OrganizationMembership = {
  membershipId: 'membership_123',
  subjectId: 'user_123',
  organizationId: 'org_456',
  status: 'active',
  roles: ['member'],
  permissions: ['conversation.read'],
};

class MemoryPreferencesRepository
  implements WorkspaceNotificationPreferencesRepository
{
  public getCalls: Array<readonly [string, string]> = [];
  public putCalls: Array<
    readonly [string, string, WorkspaceNotificationPreferenceValues]
  > = [];

  public constructor(
    private value: WorkspaceNotificationPreferenceValues | null = null,
  ) {}

  public async get(
    subjectId: string,
    organizationId: string,
  ): Promise<WorkspaceNotificationPreferenceValues | null> {
    this.getCalls.push([subjectId, organizationId]);
    return this.value;
  }

  public async put(
    subjectId: string,
    organizationId: string,
    preferences: WorkspaceNotificationPreferenceValues,
  ): Promise<WorkspaceNotificationPreferenceValues> {
    this.putCalls.push([subjectId, organizationId, preferences]);
    this.value = Object.freeze({ ...preferences });
    return this.value;
  }
}

function request(
  overrides: Partial<{
    principal: AuthenticatedPrincipal | null;
    membership: OrganizationMembership | null;
    organizationId: string;
  }> = {},
) {
  return {
    principal,
    membership,
    organizationId: 'org_456',
    ...overrides,
  };
}

test('missing scoped row returns explicit browser-safe defaults', async () => {
  const repository = new MemoryPreferencesRepository();

  const response = await loadWorkspaceNotificationPreferences(
    request(),
    repository,
  );

  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    ...DEFAULT_WORKSPACE_NOTIFICATION_PREFERENCES,
  });
  assert.deepEqual(repository.getCalls, [['user_123', 'org_456']]);
  assert.equal(Object.isFrozen(response), true);
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('user_123'), false);
  assert.equal(serialized.includes('session_internal'), false);
});

test('save writes only the authenticated subject and returns browser-safe values', async () => {
  const repository = new MemoryPreferencesRepository();
  const update = {
    meeting_reminders: false,
    transcript_ready: true,
    action_items: false,
    desktop_link_events: true,
  } as const;

  const response = await saveWorkspaceNotificationPreferences(
    request(),
    update,
    repository,
  );

  assert.deepEqual(repository.putCalls, [
    ['user_123', 'org_456', update],
  ]);
  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    ...update,
  });
  assert.equal('subject_id' in response, false);
  assert.equal('session_id' in response, false);
});

test('preferences require active same-tenant membership with conversation.read', async () => {
  const repository = new MemoryPreferencesRepository();
  const deniedRequests = [
    request({ principal: null }),
    request({ membership: null }),
    request({ membership: { ...membership, status: 'suspended' } }),
    request({ membership: { ...membership, subjectId: 'user_other' } }),
    request({ membership: { ...membership, organizationId: 'org_other' } }),
    request({ membership: { ...membership, permissions: [] } }),
  ];

  for (const denied of deniedRequests) {
    await assert.rejects(
      () => loadWorkspaceNotificationPreferences(denied, repository),
      AuthorizationDeniedError,
    );
  }
  assert.equal(repository.getCalls.length, 0);
});

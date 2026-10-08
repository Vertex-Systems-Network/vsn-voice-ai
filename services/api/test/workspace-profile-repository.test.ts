import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import { AuthorizationDeniedError } from '../src/organizations/tenant-authorization.js';
import {
  DEFAULT_WORKSPACE_PROFILE,
  loadWorkspaceProfile,
  saveWorkspaceProfile,
  type WorkspaceProfileRepository,
  type WorkspaceProfileValues,
} from '../src/workspace/workspace-profile-repository.js';

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

class MemoryProfileRepository implements WorkspaceProfileRepository {
  public getCalls: Array<readonly [string, string]> = [];
  public putCalls: Array<readonly [string, string, WorkspaceProfileValues]> = [];

  public constructor(private value: WorkspaceProfileValues | null = null) {}

  public async getProfile(
    subjectId: string,
    organizationId: string,
  ): Promise<WorkspaceProfileValues | null> {
    this.getCalls.push([subjectId, organizationId]);
    return this.value;
  }

  public async putProfile(
    subjectId: string,
    organizationId: string,
    profile: WorkspaceProfileValues,
  ): Promise<WorkspaceProfileValues> {
    this.putCalls.push([subjectId, organizationId, profile]);
    this.value = Object.freeze({ ...profile });
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

test('missing profile returns explicit browser-safe defaults', async () => {
  const repository = new MemoryProfileRepository();

  const response = await loadWorkspaceProfile(request(), repository);

  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    ...DEFAULT_WORKSPACE_PROFILE,
  });
  assert.deepEqual(repository.getCalls, [['user_123', 'org_456']]);
  assert.equal(Object.isFrozen(response), true);
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('user_123'), false);
  assert.equal(serialized.includes('session_internal'), false);
});

test('save writes only the authenticated subject and returns browser-safe values', async () => {
  const repository = new MemoryProfileRepository();
  const update = {
    display_name: 'Ada Lovelace',
    job_title: 'Research Engineer',
  } as const;

  const response = await saveWorkspaceProfile(request(), update, repository);

  assert.deepEqual(repository.putCalls, [['user_123', 'org_456', update]]);
  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    ...update,
  });
  assert.equal('subject_id' in response, false);
  assert.equal('session_id' in response, false);
});

test('profile requires active same-tenant membership with conversation.read', async () => {
  const repository = new MemoryProfileRepository();
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
      () => loadWorkspaceProfile(denied, repository),
      AuthorizationDeniedError,
    );
  }
  assert.equal(repository.getCalls.length, 0);
});

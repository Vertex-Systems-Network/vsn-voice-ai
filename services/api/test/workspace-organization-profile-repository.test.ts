import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import { AuthorizationDeniedError } from '../src/organizations/tenant-authorization.js';
import {
  DEFAULT_WORKSPACE_ORGANIZATION_PROFILE,
  loadWorkspaceOrganizationProfile,
  saveWorkspaceOrganizationProfile,
  type WorkspaceOrganizationProfileRepository,
  type WorkspaceOrganizationProfileValues,
} from '../src/workspace/workspace-organization-profile-repository.js';

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
  permissions: ['conversation.read', 'team.manage'],
};

class MemoryRepository implements WorkspaceOrganizationProfileRepository {
  public getCalls: string[] = [];
  public putCalls: Array<readonly [string, WorkspaceOrganizationProfileValues]> = [];

  public constructor(
    private value: WorkspaceOrganizationProfileValues | null = null,
  ) {}

  public async getOrganizationProfile(
    organizationId: string,
  ): Promise<WorkspaceOrganizationProfileValues | null> {
    this.getCalls.push(organizationId);
    return this.value;
  }

  public async putOrganizationProfile(
    organizationId: string,
    profile: WorkspaceOrganizationProfileValues,
  ): Promise<WorkspaceOrganizationProfileValues> {
    this.putCalls.push([organizationId, profile]);
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

test('missing organization profile returns explicit safe defaults', async () => {
  const repository = new MemoryRepository();

  const result = await loadWorkspaceOrganizationProfile(
    request(),
    repository,
  );

  assert.deepEqual(result, {
    schema_version: 1,
    organization_id: 'org_456',
    ...DEFAULT_WORKSPACE_ORGANIZATION_PROFILE,
  });
  assert.deepEqual(repository.getCalls, ['org_456']);
  assert.equal(Object.isFrozen(result), true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('user_123'), false);
  assert.equal(serialized.includes('session_internal'), false);
});

test('read requires conversation.read but not team.manage', async () => {
  const repository = new MemoryRepository({ display_name: 'Vertex Systems' });

  const result = await loadWorkspaceOrganizationProfile(
    request({
      membership: {
        ...membership,
        permissions: ['conversation.read'],
      },
    }),
    repository,
  );

  assert.equal(result.display_name, 'Vertex Systems');
  assert.deepEqual(repository.getCalls, ['org_456']);
});

test('write requires team.manage and persists only organization display name', async () => {
  const repository = new MemoryRepository();
  const update = { display_name: 'Vertex Systems Network' } as const;

  const result = await saveWorkspaceOrganizationProfile(
    request(),
    update,
    repository,
  );

  assert.deepEqual(repository.putCalls, [['org_456', update]]);
  assert.deepEqual(result, {
    schema_version: 1,
    organization_id: 'org_456',
    display_name: 'Vertex Systems Network',
  });
});

test('write without team.manage fails before persistence access', async () => {
  const repository = new MemoryRepository();

  await assert.rejects(
    () =>
      saveWorkspaceOrganizationProfile(
        request({
          membership: {
            ...membership,
            permissions: ['conversation.read'],
          },
        }),
        { display_name: 'Blocked' },
        repository,
      ),
    AuthorizationDeniedError,
  );
  assert.equal(repository.putCalls.length, 0);
});

test('cross-tenant, inactive and mismatched subject requests fail closed', async () => {
  const denied = [
    request({ principal: null }),
    request({ membership: null }),
    request({ membership: { ...membership, status: 'suspended' } }),
    request({ membership: { ...membership, subjectId: 'user_other' } }),
    request({ membership: { ...membership, organizationId: 'org_other' } }),
  ];

  for (const candidate of denied) {
    const repository = new MemoryRepository();
    await assert.rejects(
      () => loadWorkspaceOrganizationProfile(candidate, repository),
      AuthorizationDeniedError,
    );
    assert.equal(repository.getCalls.length, 0);
  }
});

test('invalid organization identifiers fail before repository access', async () => {
  for (const organizationId of [' org_456', 'x'.repeat(129)]) {
    const repository = new MemoryRepository();
    await assert.rejects(
      () =>
        loadWorkspaceOrganizationProfile(
          request({ organizationId }),
          repository,
        ),
      TypeError,
    );
    assert.equal(repository.getCalls.length, 0);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import { AuthorizationDeniedError } from '../src/organizations/tenant-authorization.js';
import {
  changeWorkspaceTeamMemberStatus,
  type ManagedWorkspaceTeamMemberStatus,
  type WorkspaceTeamMemberStatusRepository,
  type WorkspaceTeamMemberStatusResponse,
  WorkspaceTeamMemberStatusDataIntegrityError,
  WorkspaceTeamMemberStatusMutationDeniedError,
} from '../src/workspace/workspace-team-member-status-repository.js';

const principal: AuthenticatedPrincipal = {
  subjectId: 'manager_123',
  sessionId: 'session_internal',
};

const membership: OrganizationMembership = {
  membershipId: 'membership_manager',
  subjectId: 'manager_123',
  organizationId: 'org_456',
  status: 'active',
  roles: ['manager'],
  permissions: ['team.manage'],
};

class FakeStatusRepository implements WorkspaceTeamMemberStatusRepository {
  public calls: Array<readonly [string, string, string, ManagedWorkspaceTeamMemberStatus]> = [];

  public constructor(
    private readonly result: WorkspaceTeamMemberStatusResponse | null = {
      schema_version: 1,
      organization_id: 'org_456',
      membership_id: 'membership_target',
      status: 'suspended',
    },
  ) {}

  public async changeOrdinaryMemberStatus(
    actorSubjectId: string,
    organizationId: string,
    membershipId: string,
    status: ManagedWorkspaceTeamMemberStatus,
  ): Promise<WorkspaceTeamMemberStatusResponse | null> {
    this.calls.push([actorSubjectId, organizationId, membershipId, status]);
    return this.result;
  }
}

function request(
  overrides: Partial<{
    principal: AuthenticatedPrincipal | null;
    membership: OrganizationMembership | null;
    organizationId: string;
    membershipId: string;
    status: ManagedWorkspaceTeamMemberStatus;
  }> = {},
) {
  return {
    principal,
    membership,
    organizationId: 'org_456',
    membershipId: 'membership_target',
    status: 'suspended' as const,
    ...overrides,
  };
}

test('authorized team manager status update is subject-derived and browser-safe', async () => {
  const repository = new FakeStatusRepository();

  const result = await changeWorkspaceTeamMemberStatus(request(), repository);

  assert.deepEqual(repository.calls, [[
    'manager_123',
    'org_456',
    'membership_target',
    'suspended',
  ]]);
  assert.deepEqual(result, {
    schema_version: 1,
    organization_id: 'org_456',
    membership_id: 'membership_target',
    status: 'suspended',
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('manager_123'), false);
  assert.equal(serialized.includes('session_internal'), false);
  assert.equal(serialized.includes('permissions'), false);
  assert.equal(serialized.includes('roles'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('missing team.manage and tenant/subject/status authorization fail before mutation', async () => {
  const denied = [
    request({ principal: null }),
    request({ membership: null }),
    request({ membership: { ...membership, permissions: [] } }),
    request({ membership: { ...membership, status: 'suspended' } }),
    request({ membership: { ...membership, subjectId: 'manager_other' } }),
    request({ membership: { ...membership, organizationId: 'org_other' } }),
  ];

  for (const candidate of denied) {
    const repository = new FakeStatusRepository();
    await assert.rejects(
      () => changeWorkspaceTeamMemberStatus(candidate, repository),
      AuthorizationDeniedError,
    );
    assert.equal(repository.calls.length, 0);
  }
});

test('ineligible, self, no-op or missing targets collapse to one mutation denial', async () => {
  const repository = new FakeStatusRepository(null);

  await assert.rejects(
    () => changeWorkspaceTeamMemberStatus(request(), repository),
    WorkspaceTeamMemberStatusMutationDeniedError,
  );
});

test('cross-scope or mismatched repository results fail closed', async () => {
  for (const result of [
    {
      schema_version: 1 as const,
      organization_id: 'org_other',
      membership_id: 'membership_target',
      status: 'suspended' as const,
    },
    {
      schema_version: 1 as const,
      organization_id: 'org_456',
      membership_id: 'membership_other',
      status: 'suspended' as const,
    },
    {
      schema_version: 1 as const,
      organization_id: 'org_456',
      membership_id: 'membership_target',
      status: 'active' as const,
    },
  ]) {
    await assert.rejects(
      () =>
        changeWorkspaceTeamMemberStatus(
          request(),
          new FakeStatusRepository(result),
        ),
      WorkspaceTeamMemberStatusDataIntegrityError,
    );
  }
});

test('invalid route identifiers fail before repository access', async () => {
  for (const candidate of [
    request({ organizationId: ' org_456' }),
    request({ membershipId: ' membership_target' }),
    request({ organizationId: 'x'.repeat(129) }),
    request({ membershipId: 'x'.repeat(129) }),
  ]) {
    const repository = new FakeStatusRepository();
    await assert.rejects(
      () => changeWorkspaceTeamMemberStatus(candidate, repository),
      TypeError,
    );
    assert.equal(repository.calls.length, 0);
  }
});

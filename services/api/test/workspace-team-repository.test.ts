import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import {
  loadWorkspaceTeam,
  MAX_WORKSPACE_TEAM_MEMBERS,
  type WorkspaceTeamRepository,
  type WorkspaceTeamSnapshot,
  WorkspaceTeamDataIntegrityError,
} from '../src/workspace/workspace-team-repository.js';

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
  permissions: ['conversation.read', 'team.read'],
};

class FakeWorkspaceTeamRepository implements WorkspaceTeamRepository {
  public calls = 0;

  public constructor(private readonly snapshot: WorkspaceTeamSnapshot) {}

  public async listByOrganization(_organizationId: string): Promise<WorkspaceTeamSnapshot> {
    this.calls++;
    return this.snapshot;
  }
}

function snapshot(overrides: Partial<WorkspaceTeamSnapshot> = {}): WorkspaceTeamSnapshot {
  return {
    schema_version: 1,
    organization_id: 'org_456',
    members: [
      {
        schema_version: 1,
        membership_id: 'membership_123',
        display_name: 'Ada Lovelace',
        status: 'active',
        roles: ['member'],
      },
    ],
    has_more: false,
    ...overrides,
  };
}

test('workspace team loads only after tenant authorization and returns detached data', async () => {
  const source = snapshot();
  const repository = new FakeWorkspaceTeamRepository(source);

  const result = await loadWorkspaceTeam(
    { principal, membership, organizationId: ' org_456 ' },
    repository,
  );

  assert.equal(repository.calls, 1);
  assert.deepEqual(result, source);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.members), true);
  assert.equal(Object.isFrozen(result.members[0]), true);
  assert.equal(Object.isFrozen(result.members[0]?.roles), true);
  assert.notEqual(result, source);
  assert.notEqual(result.members, source.members);
  assert.notEqual(result.members[0]?.roles, source.members[0]?.roles);
});

test('missing team.read permission fails before repository access', async () => {
  const repository = new FakeWorkspaceTeamRepository(snapshot());
  const underprivilegedMembership: OrganizationMembership = {
    ...membership,
    permissions: ['conversation.read'],
  };

  await assert.rejects(
    () =>
      loadWorkspaceTeam(
        { principal, membership: underprivilegedMembership, organizationId: 'org_456' },
        repository,
      ),
    /required permission is missing/,
  );
  assert.equal(repository.calls, 0);
});

test('cross-tenant membership fails before repository access', async () => {
  const repository = new FakeWorkspaceTeamRepository(snapshot());

  await assert.rejects(
    () =>
      loadWorkspaceTeam(
        {
          principal,
          membership: { ...membership, organizationId: 'org_other' },
          organizationId: 'org_456',
        },
        repository,
      ),
    /resource belongs to another organization/,
  );
  assert.equal(repository.calls, 0);
});

test('repository tenant mismatch and oversized snapshots fail closed', async () => {
  const wrongTenant = new FakeWorkspaceTeamRepository(
    snapshot({ organization_id: 'org_other' }),
  );
  await assert.rejects(
    () => loadWorkspaceTeam({ principal, membership, organizationId: 'org_456' }, wrongTenant),
    WorkspaceTeamDataIntegrityError,
  );

  const oversizedMembers = Array.from({ length: MAX_WORKSPACE_TEAM_MEMBERS + 1 }, (_, index) => ({
    schema_version: 1 as const,
    membership_id: `membership_${index}`,
    display_name: index % 2 === 0 ? null : `Member ${index}`,
    status: 'active' as const,
    roles: ['member'],
  }));
  const oversized = new FakeWorkspaceTeamRepository(
    snapshot({ members: oversizedMembers }),
  );
  await assert.rejects(
    () => loadWorkspaceTeam({ principal, membership, organizationId: 'org_456' }, oversized),
    WorkspaceTeamDataIntegrityError,
  );
});

test('malformed projected display name fails closed at the domain boundary', async () => {
  const malformed = snapshot({
    members: [
      {
        schema_version: 1,
        membership_id: 'membership_123',
        display_name: ' bad',
        status: 'active',
        roles: ['member'],
      },
    ],
  });
  const repository = new FakeWorkspaceTeamRepository(malformed);

  await assert.rejects(
    () =>
      loadWorkspaceTeam(
        { principal, membership, organizationId: 'org_456' },
        repository,
      ),
    WorkspaceTeamDataIntegrityError,
  );
});

test('blank organization id is rejected before repository access', async () => {
  const repository = new FakeWorkspaceTeamRepository(snapshot());
  await assert.rejects(
    () => loadWorkspaceTeam({ principal, membership, organizationId: '   ' }, repository),
    TypeError,
  );
  assert.equal(repository.calls, 0);
});

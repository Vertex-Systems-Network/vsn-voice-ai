import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { TrustedPrincipalResolver } from '../src/identity/trusted-principal-resolver.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import type { OrganizationMembershipResolver } from '../src/organizations/organization-membership-resolver.js';
import {
  type ManagedWorkspaceTeamMemberStatus,
  type WorkspaceTeamMemberStatusRepository,
  type WorkspaceTeamMemberStatusResponse,
  WorkspaceTeamMemberStatusPersistenceUnavailableError,
} from '../src/workspace/workspace-team-member-status-repository.js';
import { WorkspaceTeamMemberStatusController } from '../src/workspace/workspace-team-member-status.controller.js';

const opaqueRequest = Object.freeze({ marker: 'opaque' }) as unknown as FastifyRequest;
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

class StaticPrincipalResolver implements TrustedPrincipalResolver {
  public lastRequest: FastifyRequest | null = null;

  public constructor(
    private readonly value: AuthenticatedPrincipal | null,
    private readonly failure?: Error,
  ) {}

  public async resolve(request: FastifyRequest): Promise<AuthenticatedPrincipal | null> {
    this.lastRequest = request;
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }
}

class StaticMembershipResolver implements OrganizationMembershipResolver {
  public calls = 0;

  public constructor(
    private readonly value: OrganizationMembership | null,
    private readonly failure?: Error,
  ) {}

  public async resolve(
    _principal: AuthenticatedPrincipal,
    _organizationId: string,
  ): Promise<OrganizationMembership | null> {
    this.calls += 1;
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }
}

class StaticStatusRepository implements WorkspaceTeamMemberStatusRepository {
  public calls = 0;

  public constructor(
    private readonly value: WorkspaceTeamMemberStatusResponse | null = {
      schema_version: 1,
      organization_id: 'org_456',
      membership_id: 'membership_target',
      status: 'suspended',
    },
    private readonly failure?: Error,
  ) {}

  public async changeOrdinaryMemberStatus(
    _actorSubjectId: string,
    _organizationId: string,
    _membershipId: string,
    _status: ManagedWorkspaceTeamMemberStatus,
  ): Promise<WorkspaceTeamMemberStatusResponse | null> {
    this.calls += 1;
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }
}

function setup(
  principalValue: AuthenticatedPrincipal | null = principal,
  membershipValue: OrganizationMembership | null = membership,
  repository = new StaticStatusRepository(),
) {
  const principalResolver = new StaticPrincipalResolver(principalValue);
  const membershipResolver = new StaticMembershipResolver(membershipValue);
  return {
    controller: new WorkspaceTeamMemberStatusController(
      principalResolver,
      membershipResolver,
      repository,
    ),
    principalResolver,
    membershipResolver,
    repository,
  };
}

test('authorized status update returns only browser-safe membership status', async () => {
  const { controller, repository } = setup();

  const response = await controller.putStatus(
    'org_456',
    'membership_target',
    { status: 'suspended' },
    opaqueRequest,
  );

  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    membership_id: 'membership_target',
    status: 'suspended',
  });
  assert.equal(repository.calls, 1);
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('manager_123'), false);
  assert.equal(serialized.includes('session_internal'), false);
  assert.equal(serialized.includes('permissions'), false);
  assert.equal(serialized.includes('roles'), false);
});

test('closed malformed body fails before trust or persistence access', async () => {
  const { controller, principalResolver, repository } = setup();

  for (const body of [
    null,
    {},
    { status: 'invited' },
    { status: 'active', roles: ['admin'] },
    { status: 'suspended', subject_id: 'target_subject' },
  ]) {
    await assert.rejects(
      controller.putStatus(
        'org_456',
        'membership_target',
        body,
        opaqueRequest,
      ),
      BadRequestException,
    );
  }
  assert.equal(principalResolver.lastRequest, null);
  assert.equal(repository.calls, 0);
});

test('authentication, membership and team.manage failures stay fail closed', async () => {
  const missing = setup(null);
  await assert.rejects(
    missing.controller.putStatus(
      'org_456',
      'membership_target',
      { status: 'suspended' },
      opaqueRequest,
    ),
    UnauthorizedException,
  );

  const noMembership = setup(principal, null);
  await assert.rejects(
    noMembership.controller.putStatus(
      'org_456',
      'membership_target',
      { status: 'suspended' },
      opaqueRequest,
    ),
    ForbiddenException,
  );

  const noPermission = setup(principal, { ...membership, permissions: [] });
  await assert.rejects(
    noPermission.controller.putStatus(
      'org_456',
      'membership_target',
      { status: 'suspended' },
      opaqueRequest,
    ),
    ForbiddenException,
  );
  assert.equal(noPermission.repository.calls, 0);
});

test('ineligible target collapses to generic forbidden', async () => {
  const { controller } = setup(
    principal,
    membership,
    new StaticStatusRepository(null),
  );

  await assert.rejects(
    controller.putStatus(
      'org_456',
      'membership_target',
      { status: 'active' },
      opaqueRequest,
    ),
    ForbiddenException,
  );
});

test('membership and persistence failures map to generic service unavailable', async () => {
  const membershipFailure = new WorkspaceTeamMemberStatusController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(membership, new Error('raw database detail')),
    new StaticStatusRepository(),
  );
  await assert.rejects(
    membershipFailure.putStatus(
      'org_456',
      'membership_target',
      { status: 'suspended' },
      opaqueRequest,
    ),
    ServiceUnavailableException,
  );

  const repositoryFailure = setup(
    principal,
    membership,
    new StaticStatusRepository(
      undefined,
      new WorkspaceTeamMemberStatusPersistenceUnavailableError(),
    ),
  );
  await assert.rejects(
    repositoryFailure.controller.putStatus(
      'org_456',
      'membership_target',
      { status: 'suspended' },
      opaqueRequest,
    ),
    ServiceUnavailableException,
  );
});

test('invalid route identifiers fail before trust resolution', async () => {
  const { controller, principalResolver } = setup();
  for (const [organizationId, membershipId] of [
    [' org_456', 'membership_target'],
    ['org_456', ' membership_target'],
    ['x'.repeat(129), 'membership_target'],
  ]) {
    await assert.rejects(
      controller.putStatus(
        organizationId,
        membershipId,
        { status: 'suspended' },
        opaqueRequest,
      ),
      BadRequestException,
    );
  }
  assert.equal(principalResolver.lastRequest, null);
});

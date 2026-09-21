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
  type WorkspaceTeamRepository,
  type WorkspaceTeamSnapshot,
  WorkspaceTeamPersistenceUnavailableError,
} from '../src/workspace/workspace-team-repository.js';
import { WorkspaceTeamController } from '../src/workspace/workspace-team.controller.js';

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

const teamSnapshot: WorkspaceTeamSnapshot = {
  schema_version: 1,
  organization_id: 'org_456',
  members: [
    {
      schema_version: 1,
      membership_id: 'membership_123',
      subject_id: 'user_123',
      status: 'active',
      roles: ['member'],
    },
  ],
  has_more: false,
};

const opaqueRequest = Object.freeze({ marker: 'opaque-request' }) as unknown as FastifyRequest;

class StaticPrincipalResolver implements TrustedPrincipalResolver {
  public lastRequest: FastifyRequest | null = null;

  public constructor(private readonly value: AuthenticatedPrincipal | null) {}

  public async resolve(request: FastifyRequest): Promise<AuthenticatedPrincipal | null> {
    this.lastRequest = request;
    return this.value;
  }
}

class StaticMembershipResolver implements OrganizationMembershipResolver {
  public lastPrincipal: AuthenticatedPrincipal | null = null;
  public lastOrganizationId: string | null = null;

  public constructor(private readonly value: OrganizationMembership | null) {}

  public async resolve(
    resolvedPrincipal: AuthenticatedPrincipal,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    this.lastPrincipal = resolvedPrincipal;
    this.lastOrganizationId = organizationId;
    return this.value;
  }
}

class StaticTeamRepository implements WorkspaceTeamRepository {
  public lastOrganizationId: string | null = null;

  public constructor(
    private readonly value: WorkspaceTeamSnapshot,
    private readonly failure?: Error,
  ) {}

  public async listByOrganization(organizationId: string): Promise<WorkspaceTeamSnapshot> {
    this.lastOrganizationId = organizationId;
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.value;
  }
}

test('trusted principal and membership can load the bounded team snapshot', async () => {
  const principalResolver = new StaticPrincipalResolver(principal);
  const membershipResolver = new StaticMembershipResolver(membership);
  const repository = new StaticTeamRepository(teamSnapshot);
  const controller = new WorkspaceTeamController(
    principalResolver,
    membershipResolver,
    repository,
  );

  const result = await controller.getTeam(' org_456 ', opaqueRequest);

  assert.equal(principalResolver.lastRequest, opaqueRequest);
  assert.equal(membershipResolver.lastPrincipal, principal);
  assert.equal(membershipResolver.lastOrganizationId, 'org_456');
  assert.equal(repository.lastOrganizationId, 'org_456');
  assert.deepEqual(result, teamSnapshot);
  assert.equal('session_id' in result, false);
});

test('missing principal fails before membership and repository access', async () => {
  const membershipResolver = new StaticMembershipResolver(membership);
  const repository = new StaticTeamRepository(teamSnapshot);
  const controller = new WorkspaceTeamController(
    new StaticPrincipalResolver(null),
    membershipResolver,
    repository,
  );

  await assert.rejects(
    controller.getTeam('org_456', opaqueRequest),
    UnauthorizedException,
  );
  assert.equal(membershipResolver.lastPrincipal, null);
  assert.equal(repository.lastOrganizationId, null);
});

test('missing membership and missing team.read permission are forbidden', async () => {
  const missingMembershipController = new WorkspaceTeamController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(null),
    new StaticTeamRepository(teamSnapshot),
  );
  await assert.rejects(
    missingMembershipController.getTeam('org_456', opaqueRequest),
    ForbiddenException,
  );

  const underprivilegedController = new WorkspaceTeamController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver({ ...membership, permissions: ['conversation.read'] }),
    new StaticTeamRepository(teamSnapshot),
  );
  await assert.rejects(
    underprivilegedController.getTeam('org_456', opaqueRequest),
    ForbiddenException,
  );
});

test('blank organization id fails before trust resolvers execute', async () => {
  const principalResolver = new StaticPrincipalResolver(principal);
  const membershipResolver = new StaticMembershipResolver(membership);
  const repository = new StaticTeamRepository(teamSnapshot);
  const controller = new WorkspaceTeamController(
    principalResolver,
    membershipResolver,
    repository,
  );

  await assert.rejects(
    controller.getTeam('   ', opaqueRequest),
    BadRequestException,
  );
  assert.equal(principalResolver.lastRequest, null);
  assert.equal(membershipResolver.lastPrincipal, null);
  assert.equal(repository.lastOrganizationId, null);
});

test('persistence unavailability maps to a generic service-unavailable response', async () => {
  const repository = new StaticTeamRepository(
    teamSnapshot,
    new WorkspaceTeamPersistenceUnavailableError(),
  );
  const controller = new WorkspaceTeamController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(membership),
    repository,
  );

  await assert.rejects(
    controller.getTeam('org_456', opaqueRequest),
    ServiceUnavailableException,
  );
});

test('malformed trusted principal fails closed before team membership access', async () => {
  const membershipResolver = new StaticMembershipResolver(membership);
  const repository = new StaticTeamRepository(teamSnapshot);
  const malformed = {
    subjectId: 'user_123',
    sessionId: ' session_internal ',
  } as AuthenticatedPrincipal;
  const controller = new WorkspaceTeamController(
    new StaticPrincipalResolver(malformed),
    membershipResolver,
    repository,
  );

  await assert.rejects(
    controller.getTeam('org_456', opaqueRequest),
    ServiceUnavailableException,
  );
  assert.equal(membershipResolver.lastPrincipal, null);
  assert.equal(repository.lastOrganizationId, null);
});

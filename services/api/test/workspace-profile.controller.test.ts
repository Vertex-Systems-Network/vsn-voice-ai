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
  type WorkspaceProfileRepository,
  type WorkspaceProfileValues,
  WorkspaceProfilePersistenceUnavailableError,
} from '../src/workspace/workspace-profile-repository.js';
import { WorkspaceProfileController } from '../src/workspace/workspace-profile.controller.js';

const opaqueRequest = Object.freeze({ marker: 'opaque' }) as unknown as FastifyRequest;
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
const stored = {
  display_name: 'Ada Lovelace',
  job_title: 'Research Engineer',
} as const;

class StaticPrincipalResolver implements TrustedPrincipalResolver {
  public lastRequest: FastifyRequest | null = null;

  public constructor(
    private readonly value: AuthenticatedPrincipal | null,
    private readonly failure?: Error,
  ) {}

  public async resolve(
    request: FastifyRequest,
  ): Promise<AuthenticatedPrincipal | null> {
    this.lastRequest = request;
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }
}

class StaticMembershipResolver implements OrganizationMembershipResolver {
  public lastPrincipal: AuthenticatedPrincipal | null = null;

  public constructor(
    private readonly value: OrganizationMembership | null,
    private readonly failure?: Error,
  ) {}

  public async resolve(
    resolvedPrincipal: AuthenticatedPrincipal,
    _organizationId: string,
  ): Promise<OrganizationMembership | null> {
    this.lastPrincipal = resolvedPrincipal;
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }
}

class StaticProfileRepository implements WorkspaceProfileRepository {
  public getCalls: Array<readonly [string, string]> = [];
  public putCalls: Array<readonly [string, string, WorkspaceProfileValues]> = [];

  public constructor(
    private readonly value: WorkspaceProfileValues | null = stored,
    private readonly failure?: Error,
  ) {}

  public async getProfile(
    subjectId: string,
    organizationId: string,
  ): Promise<WorkspaceProfileValues | null> {
    this.getCalls.push([subjectId, organizationId]);
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }

  public async putProfile(
    subjectId: string,
    organizationId: string,
    profile: WorkspaceProfileValues,
  ): Promise<WorkspaceProfileValues> {
    this.putCalls.push([subjectId, organizationId, profile]);
    if (this.failure !== undefined) throw this.failure;
    return Object.freeze({ ...profile });
  }
}

function createController(
  principalValue: AuthenticatedPrincipal | null = principal,
  membershipValue: OrganizationMembership | null = membership,
  repository: StaticProfileRepository = new StaticProfileRepository(),
) {
  const principalResolver = new StaticPrincipalResolver(principalValue);
  const membershipResolver = new StaticMembershipResolver(membershipValue);
  return {
    controller: new WorkspaceProfileController(
      principalResolver,
      membershipResolver,
      repository,
    ),
    principalResolver,
    membershipResolver,
    repository,
  };
}

test('authorized GET returns browser-safe subject-scoped profile', async () => {
  const { controller, membershipResolver, repository } = createController();

  const response = await controller.getProfile('org_456', opaqueRequest);

  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    ...stored,
  });
  assert.deepEqual(membershipResolver.lastPrincipal, principal);
  assert.notEqual(membershipResolver.lastPrincipal, principal);
  assert.equal(Object.isFrozen(membershipResolver.lastPrincipal), true);
  assert.deepEqual(repository.getCalls, [['user_123', 'org_456']]);
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('user_123'), false);
  assert.equal(serialized.includes('session_internal'), false);
});

test('PUT writes only closed bounded profile values', async () => {
  const { controller, repository } = createController();
  const update = {
    display_name: 'Grace Hopper',
    job_title: 'Engineer',
  };

  const response = await controller.putProfile(
    'org_456',
    update,
    opaqueRequest,
  );

  assert.deepEqual(repository.putCalls, [['user_123', 'org_456', update]]);
  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    ...update,
  });
});

test('malformed profile body is rejected before trust or persistence access', async () => {
  const { controller, principalResolver, repository } = createController();

  for (const body of [
    null,
    {},
    { display_name: 'Ada', job_title: '', subject_id: 'user_other' },
    { display_name: ' Ada', job_title: '' },
    { display_name: 'Ada', job_title: 'bad\nvalue' },
    { display_name: 'x'.repeat(81), job_title: '' },
  ]) {
    await assert.rejects(
      controller.putProfile('org_456', body, opaqueRequest),
      BadRequestException,
    );
  }
  assert.equal(principalResolver.lastRequest, null);
  assert.equal(repository.putCalls.length, 0);
});

test('missing or malformed trusted identity fails before membership access', async () => {
  const missingMembership = new StaticMembershipResolver(membership);
  const missing = new WorkspaceProfileController(
    new StaticPrincipalResolver(null),
    missingMembership,
    new StaticProfileRepository(),
  );
  await assert.rejects(
    missing.getProfile('org_456', opaqueRequest),
    UnauthorizedException,
  );
  assert.equal(missingMembership.lastPrincipal, null);

  const malformedMembership = new StaticMembershipResolver(membership);
  const malformed = new WorkspaceProfileController(
    new StaticPrincipalResolver({ subjectId: ' user_123' }),
    malformedMembership,
    new StaticProfileRepository(),
  );
  await assert.rejects(
    malformed.getProfile('org_456', opaqueRequest),
    ServiceUnavailableException,
  );
  assert.equal(malformedMembership.lastPrincipal, null);
});

test('missing membership and missing permission remain forbidden', async () => {
  const missing = createController(principal, null);
  await assert.rejects(
    missing.controller.getProfile('org_456', opaqueRequest),
    ForbiddenException,
  );

  const denied = createController(principal, {
    ...membership,
    permissions: ['team.read'],
  });
  await assert.rejects(
    denied.controller.getProfile('org_456', opaqueRequest),
    ForbiddenException,
  );
  assert.equal(denied.repository.getCalls.length, 0);
});

test('membership and profile persistence failures map to generic service unavailable', async () => {
  const membershipFailure = new WorkspaceProfileController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(membership, new Error('db secret detail')),
    new StaticProfileRepository(),
  );
  await assert.rejects(
    membershipFailure.getProfile('org_456', opaqueRequest),
    ServiceUnavailableException,
  );

  const repositoryFailure = createController(
    principal,
    membership,
    new StaticProfileRepository(
      stored,
      new WorkspaceProfilePersistenceUnavailableError(),
    ),
  );
  await assert.rejects(
    repositoryFailure.controller.getProfile('org_456', opaqueRequest),
    ServiceUnavailableException,
  );
});

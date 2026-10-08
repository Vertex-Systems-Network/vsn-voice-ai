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
  type WorkspaceOrganizationProfileRepository,
  type WorkspaceOrganizationProfileValues,
  WorkspaceOrganizationProfilePersistenceUnavailableError,
} from '../src/workspace/workspace-organization-profile-repository.js';
import { WorkspaceOrganizationProfileController } from '../src/workspace/workspace-organization-profile.controller.js';

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
  roles: ['manager'],
  permissions: ['conversation.read', 'team.manage'],
};

class StaticPrincipalResolver implements TrustedPrincipalResolver {
  public lastRequest: FastifyRequest | null = null;

  public constructor(private readonly value: AuthenticatedPrincipal | null) {}

  public async resolve(
    request: FastifyRequest,
  ): Promise<AuthenticatedPrincipal | null> {
    this.lastRequest = request;
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

class StaticRepository implements WorkspaceOrganizationProfileRepository {
  public getCalls: string[] = [];
  public putCalls: Array<readonly [string, WorkspaceOrganizationProfileValues]> = [];

  public constructor(
    private readonly value: WorkspaceOrganizationProfileValues | null = {
      display_name: 'Vertex Systems',
    },
    private readonly failure?: Error,
  ) {}

  public async getOrganizationProfile(
    organizationId: string,
  ): Promise<WorkspaceOrganizationProfileValues | null> {
    this.getCalls.push(organizationId);
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }

  public async putOrganizationProfile(
    organizationId: string,
    profile: WorkspaceOrganizationProfileValues,
  ): Promise<WorkspaceOrganizationProfileValues> {
    this.putCalls.push([organizationId, profile]);
    if (this.failure !== undefined) throw this.failure;
    return Object.freeze({ ...profile });
  }
}

function setup(
  membershipValue: OrganizationMembership | null = membership,
  repository = new StaticRepository(),
) {
  const principalResolver = new StaticPrincipalResolver(principal);
  const membershipResolver = new StaticMembershipResolver(membershipValue);
  return {
    controller: new WorkspaceOrganizationProfileController(
      principalResolver,
      membershipResolver,
      repository,
    ),
    principalResolver,
    membershipResolver,
    repository,
  };
}

test('authorized GET returns only browser-safe organization display profile', async () => {
  const { controller, repository } = setup({
    ...membership,
    permissions: ['conversation.read'],
  });

  const response = await controller.getProfile('org_456', opaqueRequest);

  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    display_name: 'Vertex Systems',
  });
  assert.deepEqual(repository.getCalls, ['org_456']);
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('user_123'), false);
  assert.equal(serialized.includes('session_internal'), false);
  assert.equal(serialized.includes('permissions'), false);
  assert.equal(serialized.includes('roles'), false);
});

test('authorized PUT writes only closed display_name value', async () => {
  const { controller, repository } = setup();

  const response = await controller.putProfile(
    'org_456',
    { display_name: 'Vertex Systems Network' },
    opaqueRequest,
  );

  assert.deepEqual(repository.putCalls, [[
    'org_456',
    { display_name: 'Vertex Systems Network' },
  ]]);
  assert.equal(response.display_name, 'Vertex Systems Network');
});

test('malformed PUT body is rejected before trust or persistence access', async () => {
  const { controller, principalResolver, repository } = setup();

  for (const body of [
    null,
    {},
    { display_name: 'Vertex', subject_id: 'user_other' },
    { display_name: ' Vertex' },
    { display_name: 'bad\nname' },
    { display_name: 'x'.repeat(101) },
  ]) {
    await assert.rejects(
      controller.putProfile('org_456', body, opaqueRequest),
      BadRequestException,
    );
  }
  assert.equal(principalResolver.lastRequest, null);
  assert.equal(repository.putCalls.length, 0);
});

test('missing identity and membership fail closed', async () => {
  const membershipResolver = new StaticMembershipResolver(membership);
  const missingIdentity = new WorkspaceOrganizationProfileController(
    new StaticPrincipalResolver(null),
    membershipResolver,
    new StaticRepository(),
  );
  await assert.rejects(
    missingIdentity.getProfile('org_456', opaqueRequest),
    UnauthorizedException,
  );
  assert.equal(membershipResolver.calls, 0);

  const missingMembership = setup(null);
  await assert.rejects(
    missingMembership.controller.getProfile('org_456', opaqueRequest),
    ForbiddenException,
  );
});

test('GET and PUT enforce separate read/manage permissions', async () => {
  const noRead = setup({
    ...membership,
    permissions: ['team.manage'],
  });
  await assert.rejects(
    noRead.controller.getProfile('org_456', opaqueRequest),
    ForbiddenException,
  );
  assert.equal(noRead.repository.getCalls.length, 0);

  const noManage = setup({
    ...membership,
    permissions: ['conversation.read'],
  });
  await assert.rejects(
    noManage.controller.putProfile(
      'org_456',
      { display_name: 'Blocked' },
      opaqueRequest,
    ),
    ForbiddenException,
  );
  assert.equal(noManage.repository.putCalls.length, 0);
});

test('membership and persistence failures map to generic service unavailable', async () => {
  const membershipFailure = new WorkspaceOrganizationProfileController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(membership, new Error('raw database detail')),
    new StaticRepository(),
  );
  await assert.rejects(
    membershipFailure.getProfile('org_456', opaqueRequest),
    ServiceUnavailableException,
  );

  const repositoryFailure = setup(
    membership,
    new StaticRepository(
      { display_name: 'Vertex Systems' },
      new WorkspaceOrganizationProfilePersistenceUnavailableError(),
    ),
  );
  await assert.rejects(
    repositoryFailure.controller.getProfile('org_456', opaqueRequest),
    ServiceUnavailableException,
  );
});

test('invalid organization id fails before trust resolution', async () => {
  const { controller, principalResolver } = setup();

  await assert.rejects(
    controller.getProfile(' org_456', opaqueRequest),
    BadRequestException,
  );
  assert.equal(principalResolver.lastRequest, null);
});

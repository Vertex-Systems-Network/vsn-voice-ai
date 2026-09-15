import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { TrustedPrincipalResolver } from '../src/identity/trusted-principal-resolver.js';
import {
  type OrganizationMembershipDirectory,
  OrganizationMembershipDirectoryUnavailableError,
  type OrganizationMembershipDirectorySnapshot,
} from '../src/organizations/organization-membership-directory.js';
import { WorkspaceDirectoryController } from '../src/workspace/workspace-directory.controller.js';

const principal: AuthenticatedPrincipal = {
  subjectId: 'user_123',
  sessionId: 'session_internal',
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

class StaticDirectory implements OrganizationMembershipDirectory {
  public lastPrincipal: AuthenticatedPrincipal | null = null;

  public constructor(
    private readonly snapshot: OrganizationMembershipDirectorySnapshot,
    private readonly failure?: Error,
  ) {}

  public async listForPrincipal(
    resolvedPrincipal: AuthenticatedPrincipal,
  ): Promise<OrganizationMembershipDirectorySnapshot> {
    this.lastPrincipal = resolvedPrincipal;
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.snapshot;
  }
}

function snapshot(): OrganizationMembershipDirectorySnapshot {
  return {
    memberships: [
      {
        membershipId: 'membership_001',
        subjectId: 'user_123',
        organizationId: 'org_001',
        status: 'active',
        roles: ['member'],
        permissions: ['conversation.read', 'team.read'],
      },
      {
        membershipId: 'membership_002',
        subjectId: 'user_123',
        organizationId: 'org_002',
        status: 'invited',
        roles: ['admin'],
        permissions: ['team.read'],
      },
    ],
    hasMore: true,
  };
}

test('authenticated principal receives only browser-safe workspace membership summaries', async () => {
  const principalResolver = new StaticPrincipalResolver(principal);
  const directory = new StaticDirectory(snapshot());
  const controller = new WorkspaceDirectoryController(
    principalResolver,
    directory,
  );

  const response = await controller.listWorkspaces(opaqueRequest);

  assert.equal(principalResolver.lastRequest, opaqueRequest);
  assert.equal(directory.lastPrincipal, principal);
  assert.deepEqual(response, {
    schema_version: 1,
    workspaces: [
      {
        schema_version: 1,
        membership_id: 'membership_001',
        organization_id: 'org_001',
        status: 'active',
        roles: ['member'],
      },
      {
        schema_version: 1,
        membership_id: 'membership_002',
        organization_id: 'org_002',
        status: 'invited',
        roles: ['admin'],
      },
    ],
    has_more: true,
  });
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('user_123'), false);
  assert.equal(serialized.includes('session_internal'), false);
  assert.equal(serialized.includes('permissions'), false);
});

test('missing trusted principal fails before directory access', async () => {
  const directory = new StaticDirectory(snapshot());
  const controller = new WorkspaceDirectoryController(
    new StaticPrincipalResolver(null),
    directory,
  );

  await assert.rejects(
    controller.listWorkspaces(opaqueRequest),
    UnauthorizedException,
  );
  assert.equal(directory.lastPrincipal, null);
});

test('directory availability failure maps to generic service unavailable', async () => {
  const directory = new StaticDirectory(
    snapshot(),
    new OrganizationMembershipDirectoryUnavailableError(),
  );
  const controller = new WorkspaceDirectoryController(
    new StaticPrincipalResolver(principal),
    directory,
  );

  await assert.rejects(
    controller.listWorkspaces(opaqueRequest),
    ServiceUnavailableException,
  );
});

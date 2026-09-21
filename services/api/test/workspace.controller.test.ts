import 'reflect-metadata';

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
import { WorkspaceController } from '../src/workspace/workspace.controller.js';

const principal: AuthenticatedPrincipal = {
  subjectId: 'user_123',
  sessionId: 'session_abc',
};

const membership: OrganizationMembership = {
  membershipId: 'membership_789',
  subjectId: 'user_123',
  organizationId: 'org_456',
  status: 'active',
  roles: ['member'],
  permissions: ['conversation.read'],
};

const opaqueRequest = Object.freeze({ marker: 'opaque-request' }) as unknown as FastifyRequest;

class StaticPrincipalResolver implements TrustedPrincipalResolver {
  public constructor(private readonly value: AuthenticatedPrincipal | null) {}

  public lastRequest: FastifyRequest | null = null;

  public async resolve(request: FastifyRequest): Promise<AuthenticatedPrincipal | null> {
    this.lastRequest = request;
    return this.value;
  }
}

class StaticMembershipResolver implements OrganizationMembershipResolver {
  public constructor(private readonly value: OrganizationMembership | null) {}

  public lastPrincipal: AuthenticatedPrincipal | null = null;
  public lastOrganizationId: string | null = null;

  public async resolve(
    resolvedPrincipal: AuthenticatedPrincipal,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    this.lastPrincipal = resolvedPrincipal;
    this.lastOrganizationId = organizationId;
    return this.value;
  }
}

test('trusted resolvers produce tenant-authorized workspace bootstrap', async () => {
  const principalResolver = new StaticPrincipalResolver(principal);
  const membershipResolver = new StaticMembershipResolver(membership);
  const controller = new WorkspaceController(principalResolver, membershipResolver);

  const response = await controller.getBootstrap('org_456', opaqueRequest);

  assert.equal(principalResolver.lastRequest, opaqueRequest);
  assert.deepEqual(membershipResolver.lastPrincipal, principal);
  assert.notEqual(membershipResolver.lastPrincipal, principal);
  assert.equal(Object.isFrozen(membershipResolver.lastPrincipal), true);
  assert.equal(membershipResolver.lastOrganizationId, 'org_456');
  assert.equal(response.authorization.organization_id, 'org_456');
  assert.equal(response.authorization.subject_id, 'user_123');
  assert.deepEqual(response.meetings, { status: 'unloaded', items: [] });
  assert.deepEqual(response.devices, { status: 'unloaded', items: [] });
});

test('missing trusted principal fails closed before membership lookup', async () => {
  const principalResolver = new StaticPrincipalResolver(null);
  const membershipResolver = new StaticMembershipResolver(membership);
  const controller = new WorkspaceController(principalResolver, membershipResolver);

  await assert.rejects(
    controller.getBootstrap('org_456', opaqueRequest),
    UnauthorizedException,
  );
  assert.equal(membershipResolver.lastPrincipal, null);
  assert.equal(membershipResolver.lastOrganizationId, null);
});

test('missing membership fails closed', async () => {
  const controller = new WorkspaceController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(null),
  );

  await assert.rejects(
    controller.getBootstrap('org_456', opaqueRequest),
    ForbiddenException,
  );
});

test('cross-tenant membership remains forbidden at domain boundary', async () => {
  const controller = new WorkspaceController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver({ ...membership, organizationId: 'org_other' }),
  );

  await assert.rejects(
    controller.getBootstrap('org_456', opaqueRequest),
    ForbiddenException,
  );
});

test('blank organization id fails before either trust resolver executes', async () => {
  const principalResolver = new StaticPrincipalResolver(principal);
  const membershipResolver = new StaticMembershipResolver(membership);
  const controller = new WorkspaceController(principalResolver, membershipResolver);

  await assert.rejects(
    controller.getBootstrap('   ', opaqueRequest),
    BadRequestException,
  );
  assert.equal(principalResolver.lastRequest, null);
  assert.equal(membershipResolver.lastPrincipal, null);
});


test('workspace bootstrap route forbids intermediary/browser caching', () => {
  const headers = Reflect.getMetadata(
    '__headers__',
    WorkspaceController.prototype.getBootstrap,
  ) as readonly { readonly name: string; readonly value: string }[] | undefined;

  assert.ok(headers);
  assert.equal(
    headers.find((header) => header.name.toLowerCase() === 'cache-control')?.value,
    'no-store',
  );
  assert.equal(
    headers.find((header) => header.name.toLowerCase() === 'pragma')?.value,
    'no-cache',
  );
});

test('malformed trusted principal fails closed before membership lookup', async () => {
  const membershipResolver = new StaticMembershipResolver(membership);
  const malformed = { subjectId: 'x'.repeat(129) } as AuthenticatedPrincipal;
  const controller = new WorkspaceController(
    new StaticPrincipalResolver(malformed),
    membershipResolver,
  );

  await assert.rejects(
    controller.getBootstrap('org_456', opaqueRequest),
    ServiceUnavailableException,
  );
  assert.equal(membershipResolver.lastPrincipal, null);
  assert.equal(membershipResolver.lastOrganizationId, null);
});

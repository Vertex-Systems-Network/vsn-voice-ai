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
  type WorkspaceNotificationPreferenceValues,
  type WorkspaceNotificationPreferencesRepository,
  WorkspaceNotificationPreferencesPersistenceUnavailableError,
} from '../src/workspace/workspace-notification-preferences-repository.js';
import { WorkspaceNotificationPreferencesController } from '../src/workspace/workspace-notification-preferences.controller.js';

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
  meeting_reminders: false,
  transcript_ready: true,
  action_items: false,
  desktop_link_events: true,
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
  public lastOrganizationId: string | null = null;

  public constructor(
    private readonly value: OrganizationMembership | null,
    private readonly failure?: Error,
  ) {}

  public async resolve(
    resolvedPrincipal: AuthenticatedPrincipal,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    this.lastPrincipal = resolvedPrincipal;
    this.lastOrganizationId = organizationId;
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }
}

class StaticPreferencesRepository
  implements WorkspaceNotificationPreferencesRepository
{
  public getCalls: Array<readonly [string, string]> = [];
  public putCalls: Array<
    readonly [string, string, WorkspaceNotificationPreferenceValues]
  > = [];

  public constructor(
    private readonly value: WorkspaceNotificationPreferenceValues | null = stored,
    private readonly failure?: Error,
  ) {}

  public async get(
    subjectId: string,
    organizationId: string,
  ): Promise<WorkspaceNotificationPreferenceValues | null> {
    this.getCalls.push([subjectId, organizationId]);
    if (this.failure !== undefined) throw this.failure;
    return this.value;
  }

  public async put(
    subjectId: string,
    organizationId: string,
    preferences: WorkspaceNotificationPreferenceValues,
  ): Promise<WorkspaceNotificationPreferenceValues> {
    this.putCalls.push([subjectId, organizationId, preferences]);
    if (this.failure !== undefined) throw this.failure;
    return Object.freeze({ ...preferences });
  }
}

function createController(
  principalValue: AuthenticatedPrincipal | null = principal,
  membershipValue: OrganizationMembership | null = membership,
  repository: StaticPreferencesRepository = new StaticPreferencesRepository(),
) {
  const principalResolver = new StaticPrincipalResolver(principalValue);
  const membershipResolver = new StaticMembershipResolver(membershipValue);
  return {
    controller: new WorkspaceNotificationPreferencesController(
      principalResolver,
      membershipResolver,
      repository,
    ),
    principalResolver,
    membershipResolver,
    repository,
  };
}

test('authorized GET returns browser-safe subject-scoped preferences', async () => {
  const { controller, membershipResolver, repository } = createController();

  const response = await controller.getPreferences('org_456', opaqueRequest);

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

test('PUT writes the authenticated subject with a closed boolean body', async () => {
  const { controller, repository } = createController();
  const update = {
    meeting_reminders: true,
    transcript_ready: false,
    action_items: true,
    desktop_link_events: false,
  };

  const response = await controller.putPreferences(
    'org_456',
    update,
    opaqueRequest,
  );

  assert.deepEqual(repository.putCalls, [
    ['user_123', 'org_456', update],
  ]);
  assert.deepEqual(response, {
    schema_version: 1,
    organization_id: 'org_456',
    ...update,
  });
});

test('malformed update body is rejected before trust or persistence access', async () => {
  const { controller, principalResolver, repository } = createController();

  for (const body of [
    null,
    {},
    {
      meeting_reminders: true,
      transcript_ready: true,
      action_items: true,
      desktop_link_events: true,
      subject_id: 'user_other',
    },
    {
      meeting_reminders: 'yes',
      transcript_ready: true,
      action_items: true,
      desktop_link_events: true,
    },
  ]) {
    await assert.rejects(
      controller.putPreferences('org_456', body, opaqueRequest),
      BadRequestException,
    );
  }
  assert.equal(principalResolver.lastRequest, null);
  assert.equal(repository.putCalls.length, 0);
});

test('missing or malformed trusted identity fails before membership access', async () => {
  const missingMembership = new StaticMembershipResolver(membership);
  const missing = new WorkspaceNotificationPreferencesController(
    new StaticPrincipalResolver(null),
    missingMembership,
    new StaticPreferencesRepository(),
  );
  await assert.rejects(
    missing.getPreferences('org_456', opaqueRequest),
    UnauthorizedException,
  );
  assert.equal(missingMembership.lastPrincipal, null);

  const malformedMembership = new StaticMembershipResolver(membership);
  const malformed = new WorkspaceNotificationPreferencesController(
    new StaticPrincipalResolver({ subjectId: ' user_123' }),
    malformedMembership,
    new StaticPreferencesRepository(),
  );
  await assert.rejects(
    malformed.getPreferences('org_456', opaqueRequest),
    ServiceUnavailableException,
  );
  assert.equal(malformedMembership.lastPrincipal, null);
});

test('missing membership and missing permission remain forbidden', async () => {
  const missing = createController(principal, null);
  await assert.rejects(
    missing.controller.getPreferences('org_456', opaqueRequest),
    ForbiddenException,
  );

  const denied = createController(principal, {
    ...membership,
    permissions: ['team.read'],
  });
  await assert.rejects(
    denied.controller.getPreferences('org_456', opaqueRequest),
    ForbiddenException,
  );
  assert.equal(denied.repository.getCalls.length, 0);
});

test('membership and preference persistence failures map to generic service unavailable', async () => {
  const membershipFailure = new WorkspaceNotificationPreferencesController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(membership, new Error('db secret detail')),
    new StaticPreferencesRepository(),
  );
  await assert.rejects(
    membershipFailure.getPreferences('org_456', opaqueRequest),
    ServiceUnavailableException,
  );

  const repositoryFailure = createController(
    principal,
    membership,
    new StaticPreferencesRepository(
      stored,
      new WorkspaceNotificationPreferencesPersistenceUnavailableError(),
    ),
  );
  await assert.rejects(
    repositoryFailure.controller.getPreferences('org_456', opaqueRequest),
    ServiceUnavailableException,
  );
});

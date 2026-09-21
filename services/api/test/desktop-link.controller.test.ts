import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { DesktopLinkController } from '../src/device-link/desktop-link.controller.js';
import {
  type DesktopLinkRecord,
  type DesktopLinkRecordStore,
  InMemoryDesktopLinkRecordStore,
} from '../src/device-link/desktop-link-record.js';
import { DesktopLinkService } from '../src/device-link/desktop-link.service.js';
import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { TrustedPrincipalResolver } from '../src/identity/trusted-principal-resolver.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import type { OrganizationMembershipResolver } from '../src/organizations/organization-membership-resolver.js';
import { DesktopLinkPersistenceUnavailableError } from '../src/device-link/runtime-desktop-link-record-store.js';

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
  permissions: ['conversation.read', 'device.link'],
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

function createController(
  principalValue: AuthenticatedPrincipal | null = principal,
  membershipValue: OrganizationMembership | null = membership,
): {
  controller: DesktopLinkController;
  principalResolver: StaticPrincipalResolver;
  membershipResolver: StaticMembershipResolver;
} {
  const principalResolver = new StaticPrincipalResolver(principalValue);
  const membershipResolver = new StaticMembershipResolver(membershipValue);
  const service = new DesktopLinkService(new InMemoryDesktopLinkRecordStore());
  return {
    controller: new DesktopLinkController(
      principalResolver,
      membershipResolver,
      service,
    ),
    principalResolver,
    membershipResolver,
  };
}

test('authorized issue returns only the one-time exchange contract', async () => {
  const { controller, principalResolver, membershipResolver } = createController();

  const response = await controller.issue(
    'org_456',
    { device_id: 'desktop_001' },
    opaqueRequest,
  );

  assert.equal(principalResolver.lastRequest, opaqueRequest);
  assert.equal(membershipResolver.lastPrincipal, principal);
  assert.equal(membershipResolver.lastOrganizationId, 'org_456');
  assert.equal(response.schema_version, 1);
  assert.match(response.record_id, /^[0-9a-f-]{36}$/i);
  assert.match(response.exchange_token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(response.expires_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(response).sort(), [
    'exchange_token',
    'expires_at',
    'record_id',
    'schema_version',
  ]);
});

test('closed issue body rejects unknown fields before trust resolution', async () => {
  const { controller, principalResolver, membershipResolver } = createController();

  await assert.rejects(
    controller.issue(
      'org_456',
      { device_id: 'desktop_001', session_secret: 'must-not-cross' },
      opaqueRequest,
    ),
    BadRequestException,
  );
  assert.equal(principalResolver.lastRequest, null);
  assert.equal(membershipResolver.lastPrincipal, null);
});

test('missing principal fails closed before membership resolution', async () => {
  const { controller, membershipResolver } = createController(null, membership);

  await assert.rejects(
    controller.issue('org_456', { device_id: 'desktop_001' }, opaqueRequest),
    UnauthorizedException,
  );
  assert.equal(membershipResolver.lastPrincipal, null);
});

test('device linking requires current active tenant permission', async () => {
  const { controller } = createController(principal, {
    ...membership,
    permissions: ['conversation.read'],
  });

  await assert.rejects(
    controller.issue('org_456', { device_id: 'desktop_001' }, opaqueRequest),
    ForbiddenException,
  );
});

test('consume is single-use and browser response omits subject/session identifiers', async () => {
  const { controller } = createController();
  const issued = await controller.issue(
    'org_456',
    { device_id: 'desktop_001' },
    opaqueRequest,
  );

  const consumed = await controller.consume(
    'org_456',
    issued.record_id,
    {
      device_id: 'desktop_001',
      exchange_token: issued.exchange_token,
    },
    opaqueRequest,
  );

  assert.equal(consumed.schema_version, 1);
  assert.equal(consumed.linked, true);
  assert.equal(consumed.organization_id, 'org_456');
  assert.equal(consumed.device_id, 'desktop_001');
  assert.deepEqual(Object.keys(consumed).sort(), [
    'consumed_at',
    'device_id',
    'linked',
    'organization_id',
    'record_id',
    'schema_version',
  ]);

  await assert.rejects(
    controller.consume(
      'org_456',
      issued.record_id,
      {
        device_id: 'desktop_001',
        exchange_token: issued.exchange_token,
      },
      opaqueRequest,
    ),
    ForbiddenException,
  );
});

test('cross-tenant membership is rejected before exchange consumption', async () => {
  const { controller } = createController(principal, {
    ...membership,
    organizationId: 'org_other',
  });

  await assert.rejects(
    controller.consume(
      'org_456',
      '00000000-0000-4000-8000-000000000000',
      {
        device_id: 'desktop_001',
        exchange_token: 'A'.repeat(43),
      },
      opaqueRequest,
    ),
    ForbiddenException,
  );
});

test('malformed consume secrets are rejected before resolver execution', async () => {
  const { controller, principalResolver } = createController();

  await assert.rejects(
    controller.consume(
      'org_456',
      'not-a-record-id',
      { device_id: 'desktop_001', exchange_token: 'short' },
      opaqueRequest,
    ),
    BadRequestException,
  );
  assert.equal(principalResolver.lastRequest, null);
});


class UnavailableDesktopLinkRecordStore implements DesktopLinkRecordStore {
  public async put(_record: DesktopLinkRecord): Promise<void> {
    throw new DesktopLinkPersistenceUnavailableError();
  }

  public async get(_recordId: string): Promise<DesktopLinkRecord | undefined> {
    throw new DesktopLinkPersistenceUnavailableError();
  }

  public async consumeIfIssued(
    _recordId: string,
    _expectedDigest: string,
    _consumedAt: string,
  ): Promise<DesktopLinkRecord | undefined> {
    throw new DesktopLinkPersistenceUnavailableError();
  }

  public async revokeIfIssued(
    _recordId: string,
    _subjectId: string,
    _organizationId: string,
    _revokedAt: string,
  ): Promise<DesktopLinkRecord | undefined> {
    throw new DesktopLinkPersistenceUnavailableError();
  }
}

test('persistence outage maps to generic service unavailable for issue, status, revoke and consume', async () => {
  const controller = new DesktopLinkController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(membership),
    new DesktopLinkService(new UnavailableDesktopLinkRecordStore()),
  );

  await assert.rejects(
    controller.issue('org_456', { device_id: 'desktop_001' }, opaqueRequest),
    ServiceUnavailableException,
  );

  await assert.rejects(
    controller.revoke(
      'org_456',
      '00000000-0000-4000-8000-000000000000',
      opaqueRequest,
    ),
    ServiceUnavailableException,
  );

  await assert.rejects(
    controller.consume(
      'org_456',
      '00000000-0000-4000-8000-000000000000',
      { device_id: 'desktop_001', exchange_token: 'A'.repeat(43) },
      opaqueRequest,
    ),
    ServiceUnavailableException,
  );
});

test('authorized status reports issue then consumption without secret fields', async () => {
  const { controller } = createController();
  const issued = await controller.issue(
    'org_456',
    { device_id: 'desktop_001' },
    opaqueRequest,
  );

  const before = await controller.status(
    'org_456',
    issued.record_id,
    opaqueRequest,
  );
  assert.equal(before.status, 'issued');
  assert.equal(before.organization_id, 'org_456');
  assert.equal(before.device_id, 'desktop_001');
  assert.equal(before.consumed_at, null);
  assert.deepEqual(Object.keys(before).sort(), [
    'consumed_at',
    'device_id',
    'expires_at',
    'organization_id',
    'record_id',
    'schema_version',
    'status',
  ]);
  assert.equal(JSON.stringify(before).includes(issued.exchange_token), false);
  assert.equal(JSON.stringify(before).includes('session_abc'), false);
  assert.equal(JSON.stringify(before).includes('user_123'), false);

  await controller.consume(
    'org_456',
    issued.record_id,
    {
      device_id: 'desktop_001',
      exchange_token: issued.exchange_token,
    },
    opaqueRequest,
  );

  const after = await controller.status(
    'org_456',
    issued.record_id,
    opaqueRequest,
  );
  assert.equal(after.status, 'consumed');
  assert.match(after.consumed_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('status hides unknown or cross-subject desktop-link records', async () => {
  const sharedStore = new InMemoryDesktopLinkRecordStore();
  const issuer = new DesktopLinkController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(membership),
    new DesktopLinkService(sharedStore),
  );
  const issued = await issuer.issue(
    'org_456',
    { device_id: 'desktop_001' },
    opaqueRequest,
  );

  const otherSubject = new DesktopLinkController(
    new StaticPrincipalResolver({ subjectId: 'user_other' }),
    new StaticMembershipResolver({
      ...membership,
      subjectId: 'user_other',
      membershipId: 'membership_other',
    }),
    new DesktopLinkService(sharedStore),
  );

  await assert.rejects(
    otherSubject.status('org_456', issued.record_id, opaqueRequest),
    NotFoundException,
  );
  await assert.rejects(
    issuer.status(
      'org_456',
      '00000000-0000-4000-8000-000000000000',
      opaqueRequest,
    ),
    NotFoundException,
  );
});

test('authorized revoke cancels a pending exchange without exposing secrets', async () => {
  const { controller } = createController();
  const issued = await controller.issue(
    'org_456',
    { device_id: 'desktop_001' },
    opaqueRequest,
  );

  const revoked = await controller.revoke(
    'org_456',
    issued.record_id,
    opaqueRequest,
  );
  assert.deepEqual(revoked, {
    schema_version: 1,
    record_id: issued.record_id,
    organization_id: 'org_456',
    device_id: 'desktop_001',
    status: 'revoked',
    expires_at: issued.expires_at,
    consumed_at: null,
  });
  assert.equal(JSON.stringify(revoked).includes(issued.exchange_token), false);
  assert.equal(JSON.stringify(revoked).includes('session_abc'), false);
  assert.equal(JSON.stringify(revoked).includes('user_123'), false);

  await assert.rejects(
    controller.consume(
      'org_456',
      issued.record_id,
      {
        device_id: 'desktop_001',
        exchange_token: issued.exchange_token,
      },
      opaqueRequest,
    ),
    ForbiddenException,
  );
});

test('revoke hides cross-subject records and refuses consumed exchanges', async () => {
  const sharedStore = new InMemoryDesktopLinkRecordStore();
  const issuer = new DesktopLinkController(
    new StaticPrincipalResolver(principal),
    new StaticMembershipResolver(membership),
    new DesktopLinkService(sharedStore),
  );
  const issued = await issuer.issue(
    'org_456',
    { device_id: 'desktop_001' },
    opaqueRequest,
  );

  const otherSubject = new DesktopLinkController(
    new StaticPrincipalResolver({ subjectId: 'user_other' }),
    new StaticMembershipResolver({
      ...membership,
      subjectId: 'user_other',
      membershipId: 'membership_other',
    }),
    new DesktopLinkService(sharedStore),
  );
  await assert.rejects(
    otherSubject.revoke('org_456', issued.record_id, opaqueRequest),
    NotFoundException,
  );

  await issuer.consume(
    'org_456',
    issued.record_id,
    {
      device_id: 'desktop_001',
      exchange_token: issued.exchange_token,
    },
    opaqueRequest,
  );
  await assert.rejects(
    issuer.revoke('org_456', issued.record_id, opaqueRequest),
    NotFoundException,
  );
});

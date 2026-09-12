import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import {
  DesktopLinkDeniedError,
  DesktopLinkService,
  type DesktopLinkClock,
} from '../src/device-link/desktop-link.service.js';
import { InMemoryDesktopLinkRecordStore } from '../src/device-link/desktop-link-record.js';
import type { AuthorizationContext } from '../src/organizations/tenant-authorization.js';

class FakeClock implements DesktopLinkClock {
  public constructor(private current: Date) {}

  public now(): Date {
    return new Date(this.current);
  }

  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

const authorization: AuthorizationContext = {
  schema_version: 1,
  subject_id: 'user_123',
  organization_id: 'org_456',
  membership_id: 'membership_789',
  roles: ['member'],
  permissions: ['device.link'],
  session_id: 'browser_session_never_exported',
};

const principal: AuthenticatedPrincipal = {
  subjectId: 'user_123',
};

function setup() {
  const store = new InMemoryDesktopLinkRecordStore();
  const clock = new FakeClock(new Date('2026-09-13T00:00:00.000Z'));
  const service = new DesktopLinkService(store, clock);
  return { store, clock, service };
}

function expectDenied(run: () => unknown): void {
  assert.throws(run, DesktopLinkDeniedError);
}

test('issued exchange is opaque, short-lived and persisted as digest only', () => {
  const { store, service } = setup();
  const issued = service.issue(authorization, 'device_abc');
  const record = store.get(issued.recordId);

  assert.equal(typeof issued.exchangeToken, 'string');
  assert.ok(issued.exchangeToken.length >= 40);
  assert.ok(record);
  assert.notEqual(record.token_digest, issued.exchangeToken);
  assert.equal(record.token_digest.length, 64);
  assert.equal(record.subject_id, 'user_123');
  assert.equal(record.organization_id, 'org_456');
  assert.equal(record.device_id, 'device_abc');
  assert.equal(record.status, 'issued');
  assert.equal(
    Date.parse(record.expires_at) - Date.parse(record.issued_at),
    5 * 60 * 1_000,
  );
});

test('valid exchange consumes once and returns no browser session secret', () => {
  const { store, service } = setup();
  const issued = service.issue(authorization, 'device_abc');

  const binding = service.consume(
    principal,
    'org_456',
    'device_abc',
    issued.recordId,
    issued.exchangeToken,
  );

  assert.deepEqual(Object.keys(binding).sort(), [
    'consumedAt',
    'deviceId',
    'linked',
    'organizationId',
    'recordId',
    'subjectId',
  ]);
  assert.equal(binding.linked, true);
  assert.equal(store.get(issued.recordId)?.status, 'consumed');
  assert.equal(JSON.stringify(binding).includes('browser_session_never_exported'), false);
});

test('replay of a consumed exchange fails closed', () => {
  const { service } = setup();
  const issued = service.issue(authorization, 'device_abc');

  service.consume(principal, 'org_456', 'device_abc', issued.recordId, issued.exchangeToken);
  expectDenied(() =>
    service.consume(principal, 'org_456', 'device_abc', issued.recordId, issued.exchangeToken),
  );
});

test('expired exchange fails closed', () => {
  const { clock, service } = setup();
  const issued = service.issue(authorization, 'device_abc', 30_000);
  clock.advance(30_000);

  expectDenied(() =>
    service.consume(principal, 'org_456', 'device_abc', issued.recordId, issued.exchangeToken),
  );
});

test('wrong tenant, subject, device or token fail closed without consuming', () => {
  const variants: Array<{
    principal: AuthenticatedPrincipal;
    organizationId: string;
    deviceId: string;
    token: (issued: string) => string;
  }> = [
    { principal, organizationId: 'org_other', deviceId: 'device_abc', token: (value) => value },
    { principal: { subjectId: 'user_other' }, organizationId: 'org_456', deviceId: 'device_abc', token: (value) => value },
    { principal, organizationId: 'org_456', deviceId: 'device_other', token: (value) => value },
    { principal, organizationId: 'org_456', deviceId: 'device_abc', token: () => 'not-the-issued-token' },
  ];

  for (const variant of variants) {
    const { store, service } = setup();
    const issued = service.issue(authorization, 'device_abc');
    expectDenied(() =>
      service.consume(
        variant.principal,
        variant.organizationId,
        variant.deviceId,
        issued.recordId,
        variant.token(issued.exchangeToken),
      ),
    );
    assert.equal(store.get(issued.recordId)?.status, 'issued');
  }
});

test('issuing requires device.link permission and bounded ttl', () => {
  const { service } = setup();
  expectDenied(() =>
    service.issue({ ...authorization, permissions: ['conversation.read'] }, 'device_abc'),
  );
  expectDenied(() => service.issue(authorization, 'device_abc', 29_999));
  expectDenied(() => service.issue(authorization, 'device_abc', 600_001));
});

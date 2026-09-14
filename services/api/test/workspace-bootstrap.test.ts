import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import { AuthorizationDeniedError } from '../src/organizations/tenant-authorization.js';
import { createWorkspaceBootstrap } from '../src/workspace/workspace-bootstrap.js';

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

test('authorized workspace bootstrap exposes only browser-safe tenant context', () => {
  const bootstrap = createWorkspaceBootstrap({
    principal,
    membership,
    organizationId: 'org_456',
  });

  assert.deepEqual(bootstrap.authorization, {
    schema_version: 1,
    subject_id: 'user_123',
    organization_id: 'org_456',
    membership_id: 'membership_789',
    roles: ['member'],
    permissions: ['conversation.read', 'device.link'],
  });
  assert.equal(Object.hasOwn(bootstrap.authorization, 'session_id'), false);
  assert.equal(JSON.stringify(bootstrap).includes('session_abc'), false);
  assert.deepEqual(bootstrap.meetings, { status: 'unloaded', items: [] });
  assert.deepEqual(bootstrap.devices, { status: 'unloaded', items: [] });
  assert.deepEqual(bootstrap.team, { status: 'unloaded', items: [] });
  assert.deepEqual(bootstrap.settings, { status: 'unloaded', items: [] });
  assert.equal(Object.isFrozen(bootstrap), true);
  assert.equal(Object.isFrozen(bootstrap.authorization), true);
  assert.equal(Object.isFrozen(bootstrap.authorization.roles), true);
  assert.equal(Object.isFrozen(bootstrap.authorization.permissions), true);
});

test('workspace bootstrap fails closed for cross-tenant membership', () => {
  assert.throws(
    () =>
      createWorkspaceBootstrap({
        principal,
        membership,
        organizationId: 'org_other',
      }),
    AuthorizationDeniedError,
  );
});

test('workspace bootstrap fails closed without read permission', () => {
  assert.throws(
    () =>
      createWorkspaceBootstrap({
        principal,
        membership: { ...membership, permissions: ['device.link'] },
        organizationId: 'org_456',
      }),
    AuthorizationDeniedError,
  );
});

test('workspace bootstrap rejects blank organization ids before authorization', () => {
  assert.throws(
    () =>
      createWorkspaceBootstrap({
        principal,
        membership,
        organizationId: '   ',
      }),
    TypeError,
  );
});

test('workspace bootstrap field surface cannot carry fabricated workspace records', () => {
  const bootstrap = createWorkspaceBootstrap({
    principal,
    membership,
    organizationId: 'org_456',
  });

  assert.deepEqual(Object.keys(bootstrap).sort(), [
    'authorization',
    'devices',
    'meetings',
    'schema_version',
    'settings',
    'team',
  ]);
  for (const area of [bootstrap.meetings, bootstrap.devices, bootstrap.team, bootstrap.settings]) {
    assert.equal(area.status, 'unloaded');
    assert.equal(area.items.length, 0);
    assert.equal(Object.isFrozen(area), true);
    assert.equal(Object.isFrozen(area.items), true);
  }
});

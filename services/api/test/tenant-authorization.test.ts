import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type { OrganizationMembership } from '../src/organizations/organization-membership.js';
import {
  AuthorizationDeniedError,
  authorizeTenantAccess,
} from '../src/organizations/tenant-authorization.js';

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

function expectDenied(run: () => unknown): void {
  assert.throws(run, AuthorizationDeniedError);
}

test('same-tenant active membership with permission is authorized', () => {
  const context = authorizeTenantAccess({
    principal,
    membership,
    resource: { organizationId: 'org_456' },
    requiredPermission: 'conversation.read',
  });

  assert.deepEqual(context, {
    schema_version: 1,
    subject_id: 'user_123',
    organization_id: 'org_456',
    membership_id: 'membership_789',
    roles: ['member'],
    permissions: ['conversation.read', 'device.link'],
    session_id: 'session_abc',
  });
  assert.equal(Object.isFrozen(context), true);
});

test('missing authenticated principal fails closed', () => {
  expectDenied(() =>
    authorizeTenantAccess({
      principal: null,
      membership,
      resource: { organizationId: 'org_456' },
      requiredPermission: 'conversation.read',
    }),
  );
});

test('missing organization membership fails closed', () => {
  expectDenied(() =>
    authorizeTenantAccess({
      principal,
      membership: null,
      resource: { organizationId: 'org_456' },
      requiredPermission: 'conversation.read',
    }),
  );
});

test('invited and suspended memberships cannot authorize', () => {
  for (const status of ['invited', 'suspended'] as const) {
    expectDenied(() =>
      authorizeTenantAccess({
        principal,
        membership: { ...membership, status },
        resource: { organizationId: 'org_456' },
        requiredPermission: 'conversation.read',
      }),
    );
  }
});

test('membership subject must match authenticated principal', () => {
  expectDenied(() =>
    authorizeTenantAccess({
      principal,
      membership: { ...membership, subjectId: 'user_other' },
      resource: { organizationId: 'org_456' },
      requiredPermission: 'conversation.read',
    }),
  );
});

test('cross-tenant resource access fails closed', () => {
  expectDenied(() =>
    authorizeTenantAccess({
      principal,
      membership,
      resource: { organizationId: 'org_other' },
      requiredPermission: 'conversation.read',
    }),
  );
});

test('missing required permission fails closed', () => {
  expectDenied(() =>
    authorizeTenantAccess({
      principal,
      membership,
      resource: { organizationId: 'org_456' },
      requiredPermission: 'organization.admin',
    }),
  );
});

test('authorization output contains no identity-vendor or credential secrets', () => {
  const context = authorizeTenantAccess({
    principal,
    membership,
    resource: { organizationId: 'org_456' },
    requiredPermission: 'device.link',
  });

  assert.deepEqual(Object.keys(context).sort(), [
    'membership_id',
    'organization_id',
    'permissions',
    'roles',
    'schema_version',
    'session_id',
    'subject_id',
  ]);
});


test('malformed trusted principal identifiers fail closed', () => {
  const malformedPrincipals = [
    { subjectId: ' user_123' },
    { subjectId: 'user_123 ' },
    { subjectId: 'x'.repeat(129) },
    { subjectId: 'user_123', sessionId: '' },
    { subjectId: 'user_123', sessionId: ' session_abc' },
    { subjectId: 'user_123', sessionId: 'x'.repeat(129) },
  ] as const;

  for (const malformedPrincipal of malformedPrincipals) {
    expectDenied(() =>
      authorizeTenantAccess({
        principal: malformedPrincipal,
        membership,
        resource: { organizationId: 'org_456' },
        requiredPermission: 'conversation.read',
      }),
    );
  }
});

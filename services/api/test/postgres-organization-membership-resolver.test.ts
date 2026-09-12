import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import {
  getOrganizationMembershipLookupSql,
  PostgresOrganizationMembershipResolver,
  type PostgresQueryClient,
  type PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';

class FakePostgresClient implements PostgresQueryClient {
  public readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];

  public constructor(
    private readonly rows: readonly unknown[],
    private readonly failure?: Error,
  ) {}

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return { rows: this.rows as readonly Row[] };
  }
}

const principal: AuthenticatedPrincipal = {
  subjectId: "user'o@example.com",
  sessionId: 'session_abc',
};

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    membership_id: 'membership_789',
    subject_id: "user'o@example.com",
    organization_id: 'org_456',
    status: 'active',
    roles: ['member'],
    permissions: ['conversation.read', 'device.link'],
    ...overrides,
  };
}

test('membership lookup is parameterized and bound to subject plus organization', async () => {
  const client = new FakePostgresClient([validRow()]);
  const resolver = new PostgresOrganizationMembershipResolver(client);

  const membership = await resolver.resolve(principal, ' org_456 ');

  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0]?.values, ["user'o@example.com", 'org_456']);
  assert.equal(client.calls[0]?.text, getOrganizationMembershipLookupSql());
  assert.match(client.calls[0]?.text ?? '', /subject_id = \$1/);
  assert.match(client.calls[0]?.text ?? '', /organization_id = \$2/);
  assert.match(client.calls[0]?.text ?? '', /LIMIT 2/);
  assert.equal(client.calls[0]?.text.includes("user'o@example.com"), false);
  assert.deepEqual(membership, {
    membershipId: 'membership_789',
    subjectId: "user'o@example.com",
    organizationId: 'org_456',
    status: 'active',
    roles: ['member'],
    permissions: ['conversation.read', 'device.link'],
  });
  assert.equal(Object.isFrozen(membership), true);
  assert.equal(Object.isFrozen(membership?.roles), true);
  assert.equal(Object.isFrozen(membership?.permissions), true);
});

test('missing or duplicate membership rows fail closed', async () => {
  for (const rows of [[], [validRow(), validRow({ membership_id: 'membership_duplicate' })]]) {
    const client = new FakePostgresClient(rows);
    const resolver = new PostgresOrganizationMembershipResolver(client);
    assert.equal(await resolver.resolve(principal, 'org_456'), null);
  }
});

test('mismatched tenant or subject from storage fails closed', async () => {
  for (const row of [
    validRow({ organization_id: 'org_other' }),
    validRow({ subject_id: 'user_other' }),
  ]) {
    const resolver = new PostgresOrganizationMembershipResolver(
      new FakePostgresClient([row]),
    );
    assert.equal(await resolver.resolve(principal, 'org_456'), null);
  }
});

test('corrupt status, roles or permissions fail closed', async () => {
  const corruptRows = [
    validRow({ status: 'deleted' }),
    validRow({ roles: [] }),
    validRow({ roles: ['member', 'member'] }),
    validRow({ roles: ['Member'] }),
    validRow({ permissions: ['conversation.read', 'conversation.read'] }),
    validRow({ permissions: ['Conversation.Read'] }),
  ];

  for (const row of corruptRows) {
    const resolver = new PostgresOrganizationMembershipResolver(
      new FakePostgresClient([row]),
    );
    assert.equal(await resolver.resolve(principal, 'org_456'), null);
  }
});

test('invalid lookup identifiers fail before database access', async () => {
  const client = new FakePostgresClient([validRow()]);
  const resolver = new PostgresOrganizationMembershipResolver(client);

  assert.equal(await resolver.resolve({ subjectId: '   ' }, 'org_456'), null);
  assert.equal(await resolver.resolve(principal, '   '), null);
  assert.equal(await resolver.resolve({ subjectId: 'x'.repeat(129) }, 'org_456'), null);
  assert.equal(await resolver.resolve(principal, 'x'.repeat(129)), null);
  assert.equal(client.calls.length, 0);
});

test('database availability failures propagate without fabricating authorization state', async () => {
  const failure = new Error('database unavailable');
  const resolver = new PostgresOrganizationMembershipResolver(
    new FakePostgresClient([], failure),
  );

  await assert.rejects(() => resolver.resolve(principal, 'org_456'), failure);
});

test('migration enforces tenant uniqueness and bounded membership state', async () => {
  const migration = await readFile(
    resolve(process.cwd(), 'migrations/0001_organization_memberships.sql'),
    'utf8',
  );

  assert.match(migration, /UNIQUE \(organization_id, subject_id\)/);
  assert.match(migration, /status IN \('active', 'invited', 'suspended'\)/);
  assert.match(migration, /cardinality\(roles\) BETWEEN 1 AND 32/);
  assert.match(migration, /cardinality\(permissions\) BETWEEN 0 AND 256/);
  assert.doesNotMatch(migration, /password|secret|token|credential/i);
});

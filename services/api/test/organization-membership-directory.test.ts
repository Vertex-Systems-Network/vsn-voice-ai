import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import {
  MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY,
  OrganizationMembershipDirectoryDataIntegrityError,
} from '../src/organizations/organization-membership-directory.js';
import type {
  PostgresQueryClient,
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  getOrganizationMembershipDirectorySql,
  PostgresOrganizationMembershipResolver,
} from '../src/organizations/postgres-organization-membership-resolver.js';

const principal: AuthenticatedPrincipal = {
  subjectId: 'user_123',
  sessionId: 'session_internal',
};

class FakePostgresClient implements PostgresQueryClient {
  public readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];

  public constructor(private readonly rows: readonly unknown[]) {}

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    return { rows: this.rows as readonly Row[] };
  }
}

function row(index = 1, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    membership_id: `membership_${index.toString().padStart(3, '0')}`,
    subject_id: 'user_123',
    organization_id: `org_${index.toString().padStart(3, '0')}`,
    display_name: index % 2 === 0 ? null : `Organization ${index}`,
    status: 'active',
    roles: ['member'],
    permissions: ['conversation.read'],
    ...overrides,
  };
}

test('directory query is subject-bound, deterministic and bounded', async () => {
  const client = new FakePostgresClient([
    row(1),
    row(2, { status: 'invited', roles: ['admin', 'member'] }),
  ]);
  const resolver = new PostgresOrganizationMembershipResolver(client);

  const result = await resolver.listForPrincipal(principal);

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]?.text, getOrganizationMembershipDirectorySql());
  assert.deepEqual(client.calls[0]?.values, [
    'user_123',
    MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY + 1,
  ]);
  assert.match(
    client.calls[0]?.text ?? '',
    /LEFT JOIN workspace_organizations AS o/,
  );
  assert.match(
    client.calls[0]?.text ?? '',
    /o\.organization_id = m\.organization_id/,
  );
  assert.match(client.calls[0]?.text ?? '', /WHERE m\.subject_id = \$1/);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY m\.organization_id ASC/);
  assert.equal(result.memberships.length, 2);
  assert.equal(result.memberships[0]?.organizationId, 'org_001');
  assert.equal(
    result.memberships[0]?.organizationDisplayName,
    'Organization 1',
  );
  assert.equal(result.memberships[1]?.organizationDisplayName, null);
  assert.equal(result.memberships[1]?.status, 'invited');
  assert.equal(result.hasMore, false);
});

test('101st membership sets hasMore and never crosses the directory bound', async () => {
  const rows = Array.from(
    { length: MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY + 1 },
    (_, index) => row(index + 1),
  );
  const resolver = new PostgresOrganizationMembershipResolver(
    new FakePostgresClient(rows),
  );

  const result = await resolver.listForPrincipal(principal);

  assert.equal(
    result.memberships.length,
    MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY,
  );
  assert.equal(result.hasMore, true);
  assert.equal(result.memberships.at(-1)?.organizationId, 'org_100');
});

test('cross-subject, malformed and duplicate directory rows fail closed', async () => {
  const cases = [
    [row(1, { subject_id: 'user_other' })],
    [row(1, { status: 'deleted' })],
    [row(1, { roles: [] })],
    [row(1, { display_name: ' bad' })],
    [row(1, { display_name: 'bad\nname' })],
    [row(1, { display_name: 'x'.repeat(101) })],
    [row(1), row(2, { membership_id: 'membership_001' })],
    [row(1), row(2, { organization_id: 'org_001' })],
  ];

  for (const rows of cases) {
    const resolver = new PostgresOrganizationMembershipResolver(
      new FakePostgresClient(rows),
    );
    await assert.rejects(
      () => resolver.listForPrincipal(principal),
      OrganizationMembershipDirectoryDataIntegrityError,
    );
  }
});

test('invalid authenticated subject fails before database access', async () => {
  const client = new FakePostgresClient([row()]);
  const resolver = new PostgresOrganizationMembershipResolver(client);

  await assert.rejects(
    () => resolver.listForPrincipal({ subjectId: '   ', sessionId: 'session_internal' }),
    OrganizationMembershipDirectoryDataIntegrityError,
  );
  assert.equal(client.calls.length, 0);
});

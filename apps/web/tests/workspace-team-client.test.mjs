import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-team-client.js');

function validPayload(organizationId = 'org_456') {
  return {
    schema_version: 1,
    organization_id: organizationId,
    members: [
      {
        schema_version: 1,
        membership_id: 'membership_123',
        display_name: 'Ada Lovelace',
        status: 'active',
        roles: ['member'],
      },
    ],
    has_more: false,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('valid team request is same-origin, credentialed and no-store', async () => {
  let seenInput;
  let seenInit;
  const result = await client.requestWorkspaceTeam(async (input, init) => {
    seenInput = input;
    seenInit = init;
    return jsonResponse(validPayload());
  }, ' org_456 ');

  assert.equal(result.status, 'ready');
  assert.equal(result.data.organization_id, 'org_456');
  assert.equal(seenInput, '/v1/workspaces/org_456/team');
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
  assert.equal(Object.hasOwn(seenInit.headers, 'authorization'), false);
});

test('team response rejects unreviewed member fields', async () => {
  for (const [field, value] of [
    ['subject_id', 'user_internal'],
    ['session_id', 'internal-only-value'],
    ['permissions', ['team.read']],
    ['email', 'person@example.com'],
    ['profile_note', 'unreviewed-data'],
  ]) {
    const payload = validPayload();
    payload.members[0][field] = value;
    const result = await client.requestWorkspaceTeam(
      async () => jsonResponse(payload),
      'org_456',
    );
    assert.deepEqual(result, { status: 'invalid_response' });
  }
});

test('tenant mismatch and widened top-level responses fail closed', async () => {
  const crossTenant = await client.requestWorkspaceTeam(
    async () => jsonResponse(validPayload('org_other')),
    'org_456',
  );
  const widenedPayload = validPayload();
  widenedPayload.extra_area = { state: 'unreviewed' };
  const widened = await client.requestWorkspaceTeam(
    async () => jsonResponse(widenedPayload),
    'org_456',
  );

  assert.deepEqual(crossTenant, { status: 'invalid_response' });
  assert.deepEqual(widened, { status: 'invalid_response' });
});

test('member count, status and roles remain contract bounded', async () => {
  const oversized = validPayload();
  oversized.members = Array.from({ length: 201 }, (_, index) => ({
    schema_version: 1,
    membership_id: `membership_${index}`,
    display_name: index % 2 === 0 ? null : `Member ${index}`,
    status: 'active',
    roles: ['member'],
  }));

  const invalidStatus = validPayload();
  invalidStatus.members[0].status = 'deleted';
  const invalidRoles = validPayload();
  invalidRoles.members[0].roles = ['member', 'member'];
  const invalidDisplayName = validPayload();
  invalidDisplayName.members[0].display_name = ' bad';

  for (const payload of [
    oversized,
    invalidStatus,
    invalidRoles,
    invalidDisplayName,
  ]) {
    const result = await client.requestWorkspaceTeam(
      async () => jsonResponse(payload),
      'org_456',
    );
    assert.deepEqual(result, { status: 'invalid_response' });
  }
});

test('401, 403, network and service failures map to explicit client states', async () => {
  assert.deepEqual(
    await client.requestWorkspaceTeam(
      async () => new Response(null, { status: 401 }),
      'org_456',
    ),
    { status: 'authentication_required' },
  );
  assert.deepEqual(
    await client.requestWorkspaceTeam(
      async () => new Response(null, { status: 403 }),
      'org_456',
    ),
    { status: 'forbidden' },
  );
  assert.deepEqual(
    await client.requestWorkspaceTeam(
      async () => new Response(null, { status: 503 }),
      'org_456',
    ),
    { status: 'unavailable' },
  );
  assert.deepEqual(
    await client.requestWorkspaceTeam(
      async () => {
        throw new Error('offline');
      },
      'org_456',
    ),
    { status: 'unavailable' },
  );
});

test('blank and oversized organization ids fail before network access', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(validPayload());
  };

  assert.deepEqual(
    await client.requestWorkspaceTeam(fetchImpl, '   '),
    { status: 'invalid_response' },
  );
  assert.deepEqual(
    await client.requestWorkspaceTeam(fetchImpl, 'x'.repeat(129)),
    { status: 'invalid_response' },
  );
  assert.equal(calls, 0);
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-team-member-status-client.js');

function payload(overrides = {}) {
  return {
    schema_version: 1,
    organization_id: 'org_456',
    membership_id: 'membership_target',
    status: 'suspended',
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('team status PUT is credentialed no-store and sends only status', async () => {
  let seenInput;
  let seenInit;
  const result = await client.updateWorkspaceTeamMemberStatus(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(payload());
    },
    'org_456',
    'membership_target',
    'suspended',
  );

  assert.equal(result.status, 'ready');
  assert.equal(
    seenInput,
    '/v1/workspaces/org_456/team/membership_target/status',
  );
  assert.equal(seenInit.method, 'PUT');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, {
    accept: 'application/json',
    'content-type': 'application/json',
  });
  assert.deepEqual(JSON.parse(seenInit.body), { status: 'suspended' });
});

test('team status response rejects secret, subject, privilege and cross-scope widening', async () => {
  for (const body of [
    payload({ subject_id: 'user_target' }),
    payload({ session_id: 'session_secret' }),
    payload({ roles: ['member'] }),
    payload({ permissions: ['team.manage'] }),
    payload({ organization_id: 'org_other' }),
    payload({ membership_id: 'membership_other' }),
    payload({ status: 'active' }),
  ]) {
    assert.deepEqual(
      await client.updateWorkspaceTeamMemberStatus(
        async () => jsonResponse(body),
        'org_456',
        'membership_target',
        'suspended',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('invalid identifiers and unsupported status fail before network access', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(payload());
  };

  for (const args of [
    [' org_456', 'membership_target', 'suspended'],
    ['org_456', ' membership_target', 'suspended'],
    ['x'.repeat(129), 'membership_target', 'suspended'],
    ['org_456', 'membership_target', 'invited'],
  ]) {
    assert.deepEqual(
      await client.updateWorkspaceTeamMemberStatus(
        fetchImpl,
        args[0],
        args[1],
        args[2],
      ),
      { status: 'invalid_response' },
    );
  }
  assert.equal(calls, 0);
});

test('auth, permission and service failures map to safe client states', async () => {
  for (const [status, expected] of [
    [401, 'authentication_required'],
    [403, 'forbidden'],
    [404, 'unavailable'],
    [503, 'unavailable'],
  ]) {
    assert.deepEqual(
      await client.updateWorkspaceTeamMemberStatus(
        async () => new Response(null, { status }),
        'org_456',
        'membership_target',
        'active',
      ),
      { status: expected },
    );
  }

  assert.deepEqual(
    await client.updateWorkspaceTeamMemberStatus(
      async () => {
        throw new Error('offline');
      },
      'org_456',
      'membership_target',
      'active',
    ),
    { status: 'unavailable' },
  );
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-organization-profile-client.js');

function payload(overrides = {}) {
  return {
    schema_version: 1,
    organization_id: 'org_456',
    display_name: 'Vertex Systems',
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('organization profile GET is credentialed no-store and tenant-bound', async () => {
  let seenInput;
  let seenInit;
  const result = await client.requestWorkspaceOrganizationProfile(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(payload());
    },
    ' org_456 ',
  );

  assert.equal(result.status, 'ready');
  assert.equal(
    seenInput,
    '/v1/workspaces/org_456/organization-profile',
  );
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
});

test('organization profile PUT sends only display_name', async () => {
  let seenInput;
  let seenInit;
  const result = await client.updateWorkspaceOrganizationProfile(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(payload({ display_name: 'Vertex Systems Network' }));
    },
    'org_456',
    { display_name: 'Vertex Systems Network' },
  );

  assert.equal(result.status, 'ready');
  assert.equal(
    seenInput,
    '/v1/workspaces/org_456/organization-profile',
  );
  assert.equal(seenInit.method, 'PUT');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(JSON.parse(seenInit.body), {
    display_name: 'Vertex Systems Network',
  });
  assert.equal(seenInit.body.includes('subject'), false);
  assert.equal(seenInit.body.includes('permissions'), false);
  assert.equal(seenInit.body.includes('roles'), false);
});

test('organization profile rejects widened identity, authority and cross-tenant responses', async () => {
  for (const body of [
    payload({ subject_id: 'user_internal' }),
    payload({ session_id: 'session_internal' }),
    payload({ roles: ['admin'] }),
    payload({ permissions: ['team.manage'] }),
    payload({ organization_id: 'org_other' }),
    payload({ display_name: ' bad' }),
    payload({ display_name: 'bad\nname' }),
  ]) {
    assert.deepEqual(
      await client.requestWorkspaceOrganizationProfile(
        async () => jsonResponse(body),
        'org_456',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('invalid identifiers and display names fail before network access', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(payload());
  };

  assert.deepEqual(
    await client.requestWorkspaceOrganizationProfile(fetchImpl, 'x'.repeat(129)),
    { status: 'invalid_response' },
  );
  for (const display_name of [
    ' bad',
    'bad\nname',
    'x'.repeat(101),
  ]) {
    assert.deepEqual(
      await client.updateWorkspaceOrganizationProfile(
        fetchImpl,
        'org_456',
        { display_name },
      ),
      { status: 'invalid_response' },
    );
  }
  assert.equal(calls, 0);
});

test('auth, permission and service failures map to safe states', async () => {
  for (const [status, expected] of [
    [401, 'authentication_required'],
    [403, 'forbidden'],
    [404, 'unavailable'],
    [503, 'unavailable'],
  ]) {
    assert.deepEqual(
      await client.requestWorkspaceOrganizationProfile(
        async () => new Response(null, { status }),
        'org_456',
      ),
      { status: expected },
    );
  }

  assert.deepEqual(
    await client.requestWorkspaceOrganizationProfile(
      async () => {
        throw new Error('offline');
      },
      'org_456',
    ),
    { status: 'unavailable' },
  );
});

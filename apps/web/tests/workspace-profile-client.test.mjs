import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-profile-client.js');

function payload(overrides = {}) {
  return {
    schema_version: 1,
    organization_id: 'org_456',
    display_name: 'Ada Lovelace',
    job_title: 'Research Engineer',
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('workspace profile GET is credentialed, no-store and tenant-bound', async () => {
  let seenInput;
  let seenInit;
  const result = await client.requestWorkspaceProfile(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(payload());
    },
    ' org_456 ',
  );

  assert.equal(result.status, 'ready');
  assert.equal(seenInput, '/v1/workspaces/org_456/profile');
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
});

test('workspace profile rejects widened, secret-bearing and cross-tenant responses', async () => {
  for (const body of [
    payload({ subject_id: 'user_123' }),
    payload({ session_id: 'session_secret' }),
    payload({ organization_id: 'org_other' }),
    payload({ display_name: ' bad' }),
    payload({ job_title: 'bad\nvalue' }),
  ]) {
    assert.deepEqual(
      await client.requestWorkspaceProfile(
        async () => jsonResponse(body),
        'org_456',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('workspace profile PUT sends only bounded profile fields', async () => {
  let seenInput;
  let seenInit;
  const update = {
    display_name: 'Grace Hopper',
    job_title: 'Engineer',
  };

  const result = await client.updateWorkspaceProfile(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(payload(update));
    },
    'org_456',
    update,
  );

  assert.equal(result.status, 'ready');
  assert.equal(seenInput, '/v1/workspaces/org_456/profile');
  assert.equal(seenInit.method, 'PUT');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, {
    accept: 'application/json',
    'content-type': 'application/json',
  });
  assert.deepEqual(JSON.parse(seenInit.body), update);
});

test('workspace profile blocks malformed updates before network access', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(payload());
  };

  for (const update of [
    { display_name: ' bad', job_title: '' },
    { display_name: 'x'.repeat(81), job_title: '' },
    { display_name: 'Ada', job_title: 'bad\nvalue' },
  ]) {
    assert.deepEqual(
      await client.updateWorkspaceProfile(fetchImpl, 'org_456', update),
      { status: 'invalid_response' },
    );
  }
  assert.equal(calls, 0);
});

test('workspace profile auth, permission and service failures map safely', async () => {
  for (const [status, expected] of [
    [401, 'authentication_required'],
    [403, 'forbidden'],
    [404, 'unavailable'],
    [503, 'unavailable'],
  ]) {
    assert.deepEqual(
      await client.requestWorkspaceProfile(
        async () => new Response(null, { status }),
        'org_456',
      ),
      { status: expected },
    );
  }

  assert.deepEqual(
    await client.requestWorkspaceProfile(
      async () => jsonResponse(payload()),
      'x'.repeat(129),
    ),
    { status: 'invalid_response' },
  );
});

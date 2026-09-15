import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-directory-client.js');

function workspace(index = 1, overrides = {}) {
  return {
    schema_version: 1,
    membership_id: `membership_${index}`,
    organization_id: `org_${index}`,
    status: 'active',
    roles: ['member'],
    ...overrides,
  };
}

function payload(workspaces = [workspace()]) {
  return {
    schema_version: 1,
    workspaces,
    has_more: false,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('workspace directory uses same-origin credentialed no-store request', async () => {
  let seenInput;
  let seenInit;
  const result = await client.requestWorkspaceDirectory(async (input, init) => {
    seenInput = input;
    seenInit = init;
    return jsonResponse(payload());
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.data.workspaces[0].organization_id, 'org_1');
  assert.equal(seenInput, '/v1/workspaces');
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
  assert.equal(Object.hasOwn(seenInit.headers, 'authorization'), false);
});

test('empty and truncated directory payloads remain valid explicit states', async () => {
  const empty = await client.requestWorkspaceDirectory(
    async () => jsonResponse(payload([])),
  );
  const truncatedPayload = payload([workspace(1)]);
  truncatedPayload.has_more = true;
  const truncated = await client.requestWorkspaceDirectory(
    async () => jsonResponse(truncatedPayload),
  );

  assert.equal(empty.status, 'ready');
  assert.equal(empty.data.workspaces.length, 0);
  assert.equal(empty.data.has_more, false);
  assert.equal(truncated.status, 'ready');
  assert.equal(truncated.data.has_more, true);
});

test('browser boundary rejects internal identity, session, permission and profile fields', async () => {
  const forbiddenFields = [
    ['subject_id', 'subject_internal'],
    ['session_id', 'session_internal'],
    ['permissions', ['team.read']],
    ['display_name', 'Workspace name'],
  ];

  for (const [field, value] of forbiddenFields) {
    const result = await client.requestWorkspaceDirectory(
      async () => jsonResponse(payload([workspace(1, { [field]: value })])),
    );
    assert.deepEqual(result, { status: 'invalid_response' });
  }
});

test('directory enforces workspace bound, exact fields and unique membership identities', async () => {
  const oversized = Array.from({ length: 101 }, (_, index) => workspace(index + 1));
  const duplicateMembership = payload([
    workspace(1),
    workspace(2, { membership_id: 'membership_1' }),
  ]);
  const duplicateOrganization = payload([
    workspace(1),
    workspace(2, { organization_id: 'org_1' }),
  ]);
  const widenedResponse = { ...payload(), billing: {} };

  for (const candidate of [
    payload(oversized),
    duplicateMembership,
    duplicateOrganization,
    widenedResponse,
  ]) {
    const result = await client.requestWorkspaceDirectory(
      async () => jsonResponse(candidate),
    );
    assert.deepEqual(result, { status: 'invalid_response' });
  }
});

test('malformed statuses, identifiers and roles fail closed', async () => {
  const cases = [
    workspace(1, { status: 'deleted' }),
    workspace(1, { organization_id: '   ' }),
    workspace(1, { roles: [] }),
    workspace(1, { roles: ['member', 'member'] }),
    workspace(1, { roles: ['Member'] }),
  ];

  for (const candidate of cases) {
    const result = await client.requestWorkspaceDirectory(
      async () => jsonResponse(payload([candidate])),
    );
    assert.deepEqual(result, { status: 'invalid_response' });
  }
});

test('401 maps to authentication required while transport and service failures stay unavailable', async () => {
  const unauthenticated = await client.requestWorkspaceDirectory(
    async () => new Response(null, { status: 401 }),
  );
  const serviceFailure = await client.requestWorkspaceDirectory(
    async () => new Response(null, { status: 503 }),
  );
  const transportFailure = await client.requestWorkspaceDirectory(async () => {
    throw new Error('offline');
  });

  assert.deepEqual(unauthenticated, { status: 'authentication_required' });
  assert.deepEqual(serviceFailure, { status: 'unavailable' });
  assert.deepEqual(transportFailure, { status: 'unavailable' });
});

test('invalid JSON response maps to invalid response', async () => {
  const result = await client.requestWorkspaceDirectory(
    async () => new Response('{', { status: 200 }),
  );
  assert.deepEqual(result, { status: 'invalid_response' });
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const typescriptModule = require('typescript');
const ts = typescriptModule.default ?? typescriptModule;

const sourceUrl = new URL('../lib/workspace-bootstrap-client.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'workspace-bootstrap-client.ts',
});
const client = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
);

function validPayload(organizationId = 'org_456') {
  const unloaded = { status: 'unloaded', items: [] };
  return {
    schema_version: 1,
    authorization: {
      schema_version: 1,
      subject_id: 'user_123',
      organization_id: organizationId,
      membership_id: 'membership_789',
      roles: ['member'],
      permissions: ['conversation.read'],
      session_id: 'session_abc',
    },
    meetings: { ...unloaded },
    devices: { ...unloaded },
    team: { ...unloaded },
    settings: { ...unloaded },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('valid bootstrap uses same-origin credentialed request and returns ready', async () => {
  let seenInput;
  let seenInit;
  const fetchImpl = async (input, init) => {
    seenInput = input;
    seenInit = init;
    return jsonResponse(validPayload());
  };

  const result = await client.requestWorkspaceBootstrap(fetchImpl, ' org_456 ');

  assert.equal(result.status, 'ready');
  assert.equal(result.data.authorization.organization_id, 'org_456');
  assert.equal(seenInput, '/v1/workspaces/org_456/bootstrap');
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
  assert.equal(Object.hasOwn(seenInit.headers, 'authorization'), false);
});

test('organization id is URL encoded and must match response tenant', async () => {
  const fetchImpl = async () => jsonResponse(validPayload('org/with space'));
  const result = await client.requestWorkspaceBootstrap(fetchImpl, 'org/with space');

  assert.equal(result.status, 'ready');

  let path;
  await client.requestWorkspaceBootstrap(async (input) => {
    path = input;
    return jsonResponse(validPayload('org/with space'));
  }, 'org/with space');
  assert.equal(path, '/v1/workspaces/org%2Fwith%20space/bootstrap');
});

test('401 and 403 map to explicit auth states', async () => {
  const unauthenticated = await client.requestWorkspaceBootstrap(
    async () => new Response(null, { status: 401 }),
    'org_456',
  );
  const forbidden = await client.requestWorkspaceBootstrap(
    async () => new Response(null, { status: 403 }),
    'org_456',
  );

  assert.deepEqual(unauthenticated, { status: 'authentication_required' });
  assert.deepEqual(forbidden, { status: 'forbidden' });
});

test('network and non-auth HTTP failures map to unavailable', async () => {
  const networkFailure = await client.requestWorkspaceBootstrap(
    async () => {
      throw new Error('offline');
    },
    'org_456',
  );
  const serviceFailure = await client.requestWorkspaceBootstrap(
    async () => new Response(null, { status: 503 }),
    'org_456',
  );

  assert.deepEqual(networkFailure, { status: 'unavailable' });
  assert.deepEqual(serviceFailure, { status: 'unavailable' });
});

test('invalid or cross-tenant payload fails closed', async () => {
  const widened = validPayload();
  widened.billing = { status: 'unloaded', items: [] };
  const widenedResult = await client.requestWorkspaceBootstrap(
    async () => jsonResponse(widened),
    'org_456',
  );

  const crossTenantResult = await client.requestWorkspaceBootstrap(
    async () => jsonResponse(validPayload('org_other')),
    'org_456',
  );

  const loadedArea = validPayload();
  loadedArea.meetings = { status: 'loaded', items: [] };
  const loadedResult = await client.requestWorkspaceBootstrap(
    async () => jsonResponse(loadedArea),
    'org_456',
  );

  assert.deepEqual(widenedResult, { status: 'invalid_response' });
  assert.deepEqual(crossTenantResult, { status: 'invalid_response' });
  assert.deepEqual(loadedResult, { status: 'invalid_response' });
});

test('blank organization id fails before network access', async () => {
  let calls = 0;
  const result = await client.requestWorkspaceBootstrap(async () => {
    calls += 1;
    return jsonResponse(validPayload());
  }, '   ');

  assert.deepEqual(result, { status: 'invalid_response' });
  assert.equal(calls, 0);
});

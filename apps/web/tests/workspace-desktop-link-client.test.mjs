import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-desktop-link-client.js');

function validPayload() {
  return {
    schema_version: 1,
    record_id: '550e8400-e29b-41d4-a716-446655440000',
    exchange_token: 'A'.repeat(43),
    expires_at: '2026-09-22T01:30:00.000Z',
  };
}

function jsonResponse(body, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('valid issue request is credentialed, same-origin and closed', async () => {
  let seenInput;
  let seenInit;
  const result = await client.issueWorkspaceDesktopLink(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(validPayload());
    },
    ' org_456 ',
    ' desktop_001 ',
  );

  assert.equal(result.status, 'ready');
  assert.equal(seenInput, '/v1/organizations/org_456/desktop-links');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, {
    accept: 'application/json',
    'content-type': 'application/json',
  });
  assert.deepEqual(JSON.parse(seenInit.body), { device_id: 'desktop_001' });
  assert.equal(Object.hasOwn(seenInit.headers, 'authorization'), false);
});

test('invalid identifiers fail before network access', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(validPayload());
  };

  assert.deepEqual(
    await client.issueWorkspaceDesktopLink(fetchImpl, '   ', 'desktop_001'),
    { status: 'invalid_input' },
  );
  assert.deepEqual(
    await client.issueWorkspaceDesktopLink(fetchImpl, 'org_456', '   '),
    { status: 'invalid_input' },
  );
  assert.deepEqual(
    await client.issueWorkspaceDesktopLink(fetchImpl, 'x'.repeat(129), 'desktop_001'),
    { status: 'invalid_input' },
  );
  assert.deepEqual(
    await client.issueWorkspaceDesktopLink(fetchImpl, 'org_456', 'x'.repeat(257)),
    { status: 'invalid_input' },
  );
  assert.equal(calls, 0);
});

test('response contract rejects widened or malformed one-time exchange data', async () => {
  const widened = validPayload();
  widened.session_id = 'must-not-cross';
  const malformedToken = validPayload();
  malformedToken.exchange_token = 'short';
  const malformedRecord = validPayload();
  malformedRecord.record_id = 'not-a-uuid';

  for (const payload of [widened, malformedToken, malformedRecord]) {
    assert.deepEqual(
      await client.issueWorkspaceDesktopLink(
        async () => jsonResponse(payload),
        'org_456',
        'desktop_001',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('auth, permission, request and service failures map to explicit states', async () => {
  const cases = [
    [401, 'authentication_required'],
    [403, 'forbidden'],
    [400, 'invalid_input'],
    [503, 'unavailable'],
  ];

  for (const [status, expected] of cases) {
    assert.deepEqual(
      await client.issueWorkspaceDesktopLink(
        async () => new Response(null, { status }),
        'org_456',
        'desktop_001',
      ),
      { status: expected },
    );
  }

  assert.deepEqual(
    await client.issueWorkspaceDesktopLink(
      async () => {
        throw new Error('offline');
      },
      'org_456',
      'desktop_001',
    ),
    { status: 'unavailable' },
  );
});

test('unexpected success status and malformed JSON fail closed', async () => {
  assert.deepEqual(
    await client.issueWorkspaceDesktopLink(
      async () => jsonResponse(validPayload(), 200),
      'org_456',
      'desktop_001',
    ),
    { status: 'unavailable' },
  );

  assert.deepEqual(
    await client.issueWorkspaceDesktopLink(
      async () => new Response('{', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
      'org_456',
      'desktop_001',
    ),
    { status: 'invalid_response' },
  );
});

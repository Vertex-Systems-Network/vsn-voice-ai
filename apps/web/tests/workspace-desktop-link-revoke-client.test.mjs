import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-desktop-link-revoke-client.js');

function revokedPayload() {
  return {
    schema_version: 1,
    record_id: '550e8400-e29b-41d4-a716-446655440000',
    organization_id: 'org_456',
    device_id: 'desktop_001',
    status: 'revoked',
    expires_at: '2026-09-22T02:30:00.000Z',
    consumed_at: null,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('revoke request is credentialed, same-origin and bodyless', async () => {
  let seenInput;
  let seenInit;
  const result = await client.revokeWorkspaceDesktopLink(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(revokedPayload());
    },
    ' org_456 ',
    '550e8400-e29b-41d4-a716-446655440000',
  );

  assert.equal(result.status, 'ready');
  assert.equal(
    seenInput,
    '/v1/organizations/org_456/desktop-links/550e8400-e29b-41d4-a716-446655440000/revoke',
  );
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
  assert.equal(seenInit.body, undefined);
});

test('revoke accepts only matching revoked lifecycle responses', async () => {
  const wrongTenant = revokedPayload();
  wrongTenant.organization_id = 'org_other';

  const consumed = revokedPayload();
  consumed.status = 'consumed';
  consumed.consumed_at = '2026-09-22T02:20:00.000Z';

  const widened = revokedPayload();
  widened.exchange_token = 'A'.repeat(43);

  for (const payload of [wrongTenant, consumed, widened]) {
    assert.deepEqual(
      await client.revokeWorkspaceDesktopLink(
        async () => jsonResponse(payload),
        'org_456',
        '550e8400-e29b-41d4-a716-446655440000',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('auth, not-found and service failures remain distinguishable', async () => {
  for (const [status, expected] of [
    [401, 'authentication_required'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [503, 'unavailable'],
  ]) {
    assert.deepEqual(
      await client.revokeWorkspaceDesktopLink(
        async () => new Response(null, { status }),
        'org_456',
        '550e8400-e29b-41d4-a716-446655440000',
      ),
      { status: expected },
    );
  }

  assert.deepEqual(
    await client.revokeWorkspaceDesktopLink(
      async () => {
        throw new Error('offline');
      },
      'org_456',
      '550e8400-e29b-41d4-a716-446655440000',
    ),
    { status: 'unavailable' },
  );
});

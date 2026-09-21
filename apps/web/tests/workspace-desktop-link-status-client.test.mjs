import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-desktop-link-status-client.js');

function validPayload(status = 'issued') {
  return {
    schema_version: 1,
    record_id: '550e8400-e29b-41d4-a716-446655440000',
    organization_id: 'org_456',
    device_id: 'desktop_001',
    status,
    expires_at: '2026-09-22T01:30:00.000Z',
    consumed_at: status === 'consumed' ? '2026-09-22T01:20:00.000Z' : null,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('status request is credentialed, same-origin and no-store', async () => {
  let seenInput;
  let seenInit;
  const result = await client.requestWorkspaceDesktopLinkStatus(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(validPayload());
    },
    ' org_456 ',
    '550e8400-e29b-41d4-a716-446655440000',
  );

  assert.equal(result.status, 'ready');
  assert.equal(
    seenInput,
    '/v1/organizations/org_456/desktop-links/550e8400-e29b-41d4-a716-446655440000/status',
  );
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
});

test('status response rejects tenant mismatch and secret-bearing fields', async () => {
  const wrongTenant = validPayload();
  wrongTenant.organization_id = 'org_other';

  const widened = validPayload();
  widened.exchange_token = 'A'.repeat(43);

  for (const payload of [wrongTenant, widened]) {
    assert.deepEqual(
      await client.requestWorkspaceDesktopLinkStatus(
        async () => jsonResponse(payload),
        'org_456',
        '550e8400-e29b-41d4-a716-446655440000',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('consumed status requires consumed_at and non-consumed states reject it', async () => {
  const missingConsumedAt = validPayload('consumed');
  missingConsumedAt.consumed_at = null;
  const invalidIssued = validPayload('issued');
  invalidIssued.consumed_at = '2026-09-22T01:20:00.000Z';

  for (const payload of [missingConsumedAt, invalidIssued]) {
    assert.deepEqual(
      await client.requestWorkspaceDesktopLinkStatus(
        async () => jsonResponse(payload),
        'org_456',
        '550e8400-e29b-41d4-a716-446655440000',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('auth, not-found and service failures map to explicit states', async () => {
  for (const [status, expected] of [
    [401, 'authentication_required'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [503, 'unavailable'],
  ]) {
    assert.deepEqual(
      await client.requestWorkspaceDesktopLinkStatus(
        async () => new Response(null, { status }),
        'org_456',
        '550e8400-e29b-41d4-a716-446655440000',
      ),
      { status: expected },
    );
  }
});

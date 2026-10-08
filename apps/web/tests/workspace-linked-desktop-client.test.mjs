import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-linked-desktop-client.js');

function payload() {
  return {
    schema_version: 1,
    organization_id: 'org_456',
    devices: [
      {
        schema_version: 1,
        record_id: '550e8400-e29b-41d4-a716-446655440000',
        device_id: 'desktop_001',
        linked_at: '2026-09-22T02:30:00.000Z',
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

test('linked desktop inventory request is credentialed and no-store', async () => {
  let seenInput;
  let seenInit;
  const result = await client.requestWorkspaceLinkedDesktops(
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
    '/v1/organizations/org_456/desktop-links/linked',
  );
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
});

test('inventory rejects widened, duplicate and cross-tenant payloads', async () => {
  const widened = payload();
  widened.subject_id = 'must-not-cross';

  const duplicate = payload();
  duplicate.devices = [duplicate.devices[0], { ...duplicate.devices[0] }];

  const wrongTenant = payload();
  wrongTenant.organization_id = 'org_other';

  for (const body of [widened, duplicate, wrongTenant]) {
    assert.deepEqual(
      await client.requestWorkspaceLinkedDesktops(
        async () => jsonResponse(body),
        'org_456',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('inventory rejects secret-bearing device entries and oversized collections', async () => {
  const secret = payload();
  secret.devices = [{ ...secret.devices[0], exchange_token: 'A'.repeat(43) }];

  const oversized = payload();
  oversized.devices = Array.from({ length: 51 }, (_, index) => ({
    schema_version: 1,
    record_id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`,
    device_id: `desktop_${index}`,
    linked_at: '2026-09-22T02:30:00.000Z',
  }));

  for (const body of [secret, oversized]) {
    assert.deepEqual(
      await client.requestWorkspaceLinkedDesktops(
        async () => jsonResponse(body),
        'org_456',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('auth and service failures map to explicit safe states', async () => {
  for (const [status, expected] of [
    [401, 'authentication_required'],
    [403, 'forbidden'],
    [404, 'unavailable'],
    [503, 'unavailable'],
  ]) {
    assert.deepEqual(
      await client.requestWorkspaceLinkedDesktops(
        async () => new Response(null, { status }),
        'org_456',
      ),
      { status: expected },
    );
  }
});

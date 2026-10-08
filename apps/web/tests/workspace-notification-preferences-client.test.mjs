import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const client = require('../.test-dist/workspace-notification-preferences-client.js');

function payload(overrides = {}) {
  return {
    schema_version: 1,
    organization_id: 'org_456',
    meeting_reminders: true,
    transcript_ready: false,
    action_items: true,
    desktop_link_events: false,
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('notification preferences GET is credentialed, no-store and tenant-bound', async () => {
  let seenInput;
  let seenInit;
  const result = await client.requestWorkspaceNotificationPreferences(
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
    '/v1/workspaces/org_456/notification-preferences',
  );
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, { accept: 'application/json' });
});

test('notification preferences rejects widened, secret-bearing and cross-tenant responses', async () => {
  for (const body of [
    payload({ subject_id: 'user_123' }),
    payload({ session_id: 'session_secret' }),
    payload({ organization_id: 'org_other' }),
    payload({ meeting_reminders: 'yes' }),
  ]) {
    assert.deepEqual(
      await client.requestWorkspaceNotificationPreferences(
        async () => jsonResponse(body),
        'org_456',
      ),
      { status: 'invalid_response' },
    );
  }
});

test('notification preferences PUT sends only the four boolean fields', async () => {
  let seenInput;
  let seenInit;
  const update = {
    meeting_reminders: false,
    transcript_ready: true,
    action_items: false,
    desktop_link_events: true,
  };

  const result = await client.updateWorkspaceNotificationPreferences(
    async (input, init) => {
      seenInput = input;
      seenInit = init;
      return jsonResponse(payload(update));
    },
    'org_456',
    update,
  );

  assert.equal(result.status, 'ready');
  assert.equal(
    seenInput,
    '/v1/workspaces/org_456/notification-preferences',
  );
  assert.equal(seenInit.method, 'PUT');
  assert.equal(seenInit.credentials, 'include');
  assert.equal(seenInit.cache, 'no-store');
  assert.deepEqual(seenInit.headers, {
    accept: 'application/json',
    'content-type': 'application/json',
  });
  assert.deepEqual(JSON.parse(seenInit.body), update);
});

test('auth, permission, malformed identifier and service failures map safely', async () => {
  for (const [status, expected] of [
    [401, 'authentication_required'],
    [403, 'forbidden'],
    [404, 'unavailable'],
    [503, 'unavailable'],
  ]) {
    assert.deepEqual(
      await client.requestWorkspaceNotificationPreferences(
        async () => new Response(null, { status }),
        'org_456',
      ),
      { status: expected },
    );
  }

  assert.deepEqual(
    await client.requestWorkspaceNotificationPreferences(
      async () => jsonResponse(payload()),
      'x'.repeat(129),
    ),
    { status: 'invalid_response' },
  );
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const session = require('../.test-dist/workspace-session-state.js');

test('directory results map to explicit authentication states', () => {
  assert.equal(
    session.workspaceSessionState({
      status: 'ready',
      data: {
        schema_version: 1,
        workspaces: [],
        has_more: false,
      },
    }),
    'authenticated',
  );
  assert.equal(
    session.workspaceSessionState({ status: 'authentication_required' }),
    'signed_out',
  );
  assert.equal(
    session.workspaceSessionState({ status: 'invalid_response' }),
    'unavailable',
  );
  assert.equal(
    session.workspaceSessionState({ status: 'unavailable' }),
    'unavailable',
  );
});

test('session views never invent provider or user identity', () => {
  const expected = {
    checking: ['Checking authentication', 'neutral'],
    authenticated: ['Authenticated workspace session', 'ready'],
    signed_out: ['Signed out', 'warning'],
    unavailable: ['Authentication state unavailable', 'warning'],
  };

  for (const [state, [label, tone]] of Object.entries(expected)) {
    const view = session.workspaceSessionView(state);
    assert.equal(view.label, label);
    assert.equal(view.tone, tone);
    assert.equal(Object.isFrozen(view), true);
    assert.equal(/user|subject|membership|provider/i.test(view.label), false);
  }
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const state = require('../.test-dist/workspace-directory-panel-state.js');

function entry(index = 1) {
  return {
    schema_version: 1,
    membership_id: `membership_${index}`,
    organization_id: `org_${index}`,
    status: 'active',
    roles: ['member'],
  };
}

test('loading state never exposes workspace data', () => {
  const view = state.loadingWorkspaceDirectoryPanelView();
  assert.equal(view.heading, 'Loading workspaces');
  assert.equal(view.badge, 'Loading');
  assert.deepEqual(view.workspaces, []);
  assert.equal(view.hasMore, false);
});

test('ready state exposes only validated workspace entries and bound signal', () => {
  const workspaces = [entry(1), entry(2)];
  const view = state.workspaceDirectoryPanelView({
    status: 'ready',
    data: {
      schema_version: 1,
      workspaces,
      has_more: true,
    },
  });

  assert.equal(view.heading, '2 workspaces available');
  assert.equal(view.badge, 'Authenticated directory');
  assert.equal(view.workspaces.length, 2);
  assert.equal(view.workspaces[0].organization_id, 'org_1');
  assert.equal(view.hasMore, true);
});

test('empty authenticated directory remains an explicit ready state', () => {
  const view = state.workspaceDirectoryPanelView({
    status: 'ready',
    data: { schema_version: 1, workspaces: [], has_more: false },
  });

  assert.equal(view.heading, 'No workspaces available');
  assert.equal(view.badge, 'Authenticated directory');
  assert.deepEqual(view.workspaces, []);
});

test('authentication and unsafe response states never select or expose a workspace', () => {
  const states = [
    { status: 'authentication_required' },
    { status: 'invalid_response' },
    { status: 'unavailable' },
  ];

  for (const result of states) {
    const view = state.workspaceDirectoryPanelView(result);
    assert.deepEqual(view.workspaces, []);
    assert.equal(view.hasMore, false);
    assert.equal(view.tone, 'warning');
  }
});

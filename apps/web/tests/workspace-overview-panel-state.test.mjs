import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const panelState = require('../.test-dist/workspace-overview-panel-state.js');

function readyResult() {
  const unloaded = { status: 'unloaded', items: [] };
  return {
    status: 'ready',
    data: {
      schema_version: 1,
      authorization: {
        schema_version: 1,
        subject_id: 'subject_internal',
        organization_id: 'org_456',
        membership_id: 'membership_internal',
        roles: ['member', 'operator'],
        permissions: ['conversation.read', 'team.read'],
      },
      meetings: { ...unloaded },
      devices: { ...unloaded },
      team: { ...unloaded },
      settings: { ...unloaded },
    },
  };
}

test('selection-required view exposes no tenant authorization state', () => {
  const view = panelState.workspaceOverviewSelectionRequiredView();
  assert.equal(view.organizationId, null);
  assert.deepEqual(view.roles, []);
  assert.deepEqual(view.permissions, []);
  assert.deepEqual(view.unloadedAreas, []);
});

test('ready overview exposes safe tenant authorization summary only', () => {
  const view = panelState.workspaceOverviewView(readyResult());

  assert.equal(view.heading, 'Workspace access verified');
  assert.equal(view.organizationId, 'org_456');
  assert.deepEqual(view.roles, ['member', 'operator']);
  assert.deepEqual(view.permissions, ['conversation.read', 'team.read']);
  assert.deepEqual(view.unloadedAreas, [
    'Meetings',
    'Devices bootstrap',
    'Team bootstrap',
    'Settings',
  ]);

  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes('subject_internal'), false);
  assert.equal(serialized.includes('membership_internal'), false);
});

test('auth and invalid bootstrap states expose no authorization details', () => {
  for (const status of [
    'authentication_required',
    'forbidden',
    'invalid_response',
    'unavailable',
  ]) {
    const view = panelState.workspaceOverviewView({ status });
    assert.equal(view.organizationId, null);
    assert.deepEqual(view.roles, []);
    assert.deepEqual(view.permissions, []);
  }
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const panelState = require('../.test-dist/workspace-team-panel-state.js');

function readyResult(memberCount = 1, hasMore = false) {
  return {
    status: 'ready',
    data: {
      schema_version: 1,
      organization_id: 'org_456',
      members: Array.from({ length: memberCount }, (_, index) => ({
        schema_version: 1,
        membership_id: `membership_${index}`,
        display_name: index === 0 ? 'Ada Lovelace' : null,
        status: 'active',
        roles: ['member'],
      })),
      has_more: hasMore,
    },
  };
}

test('loading view contains no membership data', () => {
  const view = panelState.loadingWorkspaceTeamPanelView();

  assert.equal(view.badge, 'Loading');
  assert.equal(view.members.length, 0);
  assert.equal(view.hasMore, false);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.members), true);
});

test('ready view projects only display-safe status and roles', () => {
  const result = readyResult(2, true);
  const view = panelState.workspaceTeamPanelView(result);

  assert.equal(view.heading, '2 team members');
  assert.equal(view.badge, 'Tenant data');
  assert.equal(view.tone, 'ready');
  assert.equal(view.members.length, 2);
  assert.equal(view.hasMore, true);
  assert.notEqual(view.members, result.data.members);
  assert.deepEqual(view.members[0], {
    displayName: 'Ada Lovelace',
    status: 'active',
    roles: ['member'],
  });
  assert.equal(Object.isFrozen(view.members), true);
  assert.equal(Object.isFrozen(view.members[0]), true);
  assert.equal(Object.isFrozen(view.members[0].roles), true);

  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes('membership_0'), false);
  assert.equal(serialized.includes('subject_id'), false);
  assert.equal(serialized.includes('Ada Lovelace'), true);
});

test('empty ready result remains explicit instead of inventing users', () => {
  const view = panelState.workspaceTeamPanelView(readyResult(0));

  assert.equal(view.heading, 'No team members to show');
  assert.equal(view.members.length, 0);
  assert.equal(view.badge, 'Tenant data');
});

test('auth and failure states never copy remote or internal error details', () => {
  const expected = new Map([
    ['authentication_required', 'Authentication required'],
    ['forbidden', 'Team access unavailable'],
    ['invalid_response', 'Team data unavailable'],
    ['unavailable', 'Team data unavailable'],
  ]);

  for (const [status, heading] of expected) {
    const view = panelState.workspaceTeamPanelView({ status });
    assert.equal(view.heading, heading);
    assert.equal(view.members.length, 0);
    assert.equal(view.hasMore, false);
    assert.equal(view.description.includes('database'), false);
    assert.equal(view.description.includes('session'), false);
  }
});

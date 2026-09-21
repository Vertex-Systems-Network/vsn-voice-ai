import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const selection = require('../.test-dist/workspace-directory-selection.js');

function workspace(status = 'active', organizationId = 'org_1') {
  return {
    schema_version: 1,
    membership_id: `membership_${organizationId}`,
    organization_id: organizationId,
    status,
    roles: ['member'],
  };
}

test('active membership is selectable until it becomes selected', () => {
  assert.deepEqual(
    selection.workspaceSelectionState(workspace(), null),
    {
      selectable: true,
      selected: false,
      actionLabel: 'Select',
      statusLabel: 'Active membership',
    },
  );

  assert.deepEqual(
    selection.workspaceSelectionState(workspace(), 'org_1'),
    {
      selectable: false,
      selected: true,
      actionLabel: 'Selected',
      statusLabel: 'Active · selected',
    },
  );
});

test('invited and suspended memberships never become tenant selections', () => {
  assert.deepEqual(
    selection.workspaceSelectionState(workspace('invited'), null),
    {
      selectable: false,
      selected: false,
      actionLabel: 'Invitation pending',
      statusLabel: 'Invited membership',
    },
  );
  assert.deepEqual(
    selection.workspaceSelectionState(workspace('suspended'), 'org_1'),
    {
      selectable: false,
      selected: false,
      actionLabel: 'Access suspended',
      statusLabel: 'Suspended membership',
    },
  );
});

test('selected tenant remains authorized only while its membership stays active', () => {
  assert.equal(
    selection.workspaceSelectionRemainsAuthorized(
      [workspace('active', 'org_1')],
      'org_1',
    ),
    true,
  );
  assert.equal(
    selection.workspaceSelectionRemainsAuthorized(
      [workspace('suspended', 'org_1')],
      'org_1',
    ),
    false,
  );
  assert.equal(
    selection.workspaceSelectionRemainsAuthorized(
      [workspace('invited', 'org_1')],
      'org_1',
    ),
    false,
  );
  assert.equal(
    selection.workspaceSelectionRemainsAuthorized(
      [workspace('active', 'org_other')],
      'org_1',
    ),
    false,
  );
  assert.equal(
    selection.workspaceSelectionRemainsAuthorized([], null),
    true,
  );
});

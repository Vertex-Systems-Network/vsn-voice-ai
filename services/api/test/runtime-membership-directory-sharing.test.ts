import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import {
  OrganizationMembershipDirectoryUnavailableError,
} from '../src/organizations/organization-membership-directory.js';
import type {
  ClosablePostgresQueryClient,
} from '../src/organizations/node-postgres-query-client.js';
import type {
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  createRuntimeOrganizationMembershipResolver,
} from '../src/organizations/runtime-organization-membership-resolver.js';
import {
  WorkspaceNotificationPreferencesPersistenceUnavailableError,
} from '../src/workspace/workspace-notification-preferences-repository.js';
import {
  WorkspaceOrganizationProfilePersistenceUnavailableError,
} from '../src/workspace/workspace-organization-profile-repository.js';
import {
  WorkspaceProfilePersistenceUnavailableError,
} from '../src/workspace/workspace-profile-repository.js';
import {
  WorkspaceTeamMemberStatusPersistenceUnavailableError,
} from '../src/workspace/workspace-team-member-status-repository.js';
import {
  WorkspaceTeamPersistenceUnavailableError,
} from '../src/workspace/workspace-team-repository.js';

const principal: AuthenticatedPrincipal = {
  subjectId: 'user_123',
  sessionId: 'session_internal',
};

const persistedMembership = {
  membership_id: 'membership_001',
  subject_id: 'user_123',
  organization_id: 'org_001',
  status: 'active',
  roles: ['member'],
  permissions: ['conversation.read', 'team.read'],
} as const;

class SharedFakePostgresClient implements ClosablePostgresQueryClient {
  public closeCalls = 0;
  public readonly queries: Array<{
    text: string;
    values: readonly unknown[];
  }> = [];

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values: [...values] });
    if (text.startsWith('UPDATE organization_memberships')) {
      return {
        rows: [
          {
            organization_id: 'org_001',
            membership_id: 'membership_target',
            status: values[3],
          } as unknown as Row,
        ],
      };
    }
    if (text.includes('LEFT JOIN workspace_profiles')) {
      return {
        rows: [
          {
            membership_id: 'membership_001',
            subject_id: 'user_123',
            organization_id: 'org_001',
            status: 'active',
            roles: ['member'],
            display_name: 'Ada Lovelace',
          } as unknown as Row,
        ],
      };
    }
    if (text.includes('workspace_organizations')) {
      return {
        rows: [
          {
            organization_id: 'org_001',
            display_name:
              values.length > 1 ? values[1] : 'Vertex Systems',
          } as unknown as Row,
        ],
      };
    }
    if (text.includes('workspace_profiles')) {
      return {
        rows: [
          {
            subject_id: 'user_123',
            organization_id: 'org_001',
            display_name: 'Ada Lovelace',
            job_title: 'Research Engineer',
          } as unknown as Row,
        ],
      };
    }
    if (text.includes('workspace_notification_preferences')) {
      return {
        rows: [
          {
            subject_id: 'user_123',
            organization_id: 'org_001',
            meeting_reminders: false,
            transcript_ready: true,
            action_items: false,
            desktop_link_events: true,
          } as unknown as Row,
        ],
      };
    }
    return { rows: [persistedMembership as unknown as Row] };
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

test('configured runtime shares one PostgreSQL client across membership, directory and team reads', async () => {
  const client = new SharedFakePostgresClient();
  let factoryCalls = 0;
  const runtime = createRuntimeOrganizationMembershipResolver(
    { VSN_POSTGRES_URL: 'postgresql://vsn@db.example.com/vsn' },
    () => {
      factoryCalls += 1;
      return client;
    },
  );

  const membership = await runtime.resolve(principal, 'org_001');
  const directory = await runtime.listForPrincipal(principal);
  const team = await runtime.listByOrganization('org_001');
  const preferences = await runtime.get('user_123', 'org_001');
  const savedPreferences = await runtime.put('user_123', 'org_001', {
    meeting_reminders: false,
    transcript_ready: true,
    action_items: false,
    desktop_link_events: true,
  });
  const profile = await runtime.getProfile('user_123', 'org_001');
  const savedProfile = await runtime.putProfile('user_123', 'org_001', {
    display_name: 'Ada Lovelace',
    job_title: 'Research Engineer',
  });
  const organizationProfile = await runtime.getOrganizationProfile('org_001');
  const savedOrganizationProfile = await runtime.putOrganizationProfile(
    'org_001',
    { display_name: 'Vertex Systems Network' },
  );
  const memberStatus = await runtime.changeOrdinaryMemberStatus(
    'manager_123',
    'org_001',
    'membership_target',
    'suspended',
  );

  assert.equal(factoryCalls, 1);
  assert.equal(membership?.organizationId, 'org_001');
  assert.equal(directory.memberships.length, 1);
  assert.equal(directory.memberships[0]?.organizationId, 'org_001');
  assert.equal(directory.hasMore, false);
  assert.equal(team.organization_id, 'org_001');
  assert.equal(team.members.length, 1);
  assert.equal(team.members[0]?.display_name, 'Ada Lovelace');
  assert.equal(JSON.stringify(team).includes('user_123'), false);
  assert.equal(team.has_more, false);
  assert.deepEqual(preferences, {
    meeting_reminders: false,
    transcript_ready: true,
    action_items: false,
    desktop_link_events: true,
  });
  assert.deepEqual(savedPreferences, preferences);
  assert.deepEqual(profile, {
    display_name: 'Ada Lovelace',
    job_title: 'Research Engineer',
  });
  assert.deepEqual(savedProfile, profile);
  assert.deepEqual(organizationProfile, {
    display_name: 'Vertex Systems',
  });
  assert.deepEqual(savedOrganizationProfile, {
    display_name: 'Vertex Systems Network',
  });
  assert.deepEqual(memberStatus, {
    schema_version: 1,
    organization_id: 'org_001',
    membership_id: 'membership_target',
    status: 'suspended',
  });
  assert.equal(client.queries.length, 10);
  assert.deepEqual(client.queries[0]?.values, ['user_123', 'org_001']);
  assert.deepEqual(client.queries[1]?.values, ['user_123', 101]);
  assert.deepEqual(client.queries[2]?.values, ['org_001', 201]);
  assert.deepEqual(client.queries[3]?.values, ['org_001', 'user_123']);
  assert.deepEqual(client.queries[4]?.values, [
    'org_001',
    'user_123',
    false,
    true,
    false,
    true,
  ]);
  assert.deepEqual(client.queries[5]?.values, ['org_001', 'user_123']);
  assert.deepEqual(client.queries[6]?.values, [
    'org_001',
    'user_123',
    'Ada Lovelace',
    'Research Engineer',
  ]);
  assert.deepEqual(client.queries[7]?.values, ['org_001']);
  assert.deepEqual(client.queries[8]?.values, [
    'org_001',
    'Vertex Systems Network',
  ]);
  assert.deepEqual(client.queries[9]?.values, [
    'org_001',
    'membership_target',
    'manager_123',
    'suspended',
    ['conversation.read', 'team.read', 'device.link'],
  ]);

  await Promise.all([
    runtime.onApplicationShutdown(),
    runtime.onApplicationShutdown(),
  ]);
  assert.equal(client.closeCalls, 1);
});

test('missing PostgreSQL configuration fails closed for all membership-backed access modes', async () => {
  let factoryCalls = 0;
  const runtime = createRuntimeOrganizationMembershipResolver({}, () => {
    factoryCalls += 1;
    return new SharedFakePostgresClient();
  });

  assert.equal(await runtime.resolve(principal, 'org_001'), null);
  await assert.rejects(
    () => runtime.listForPrincipal(principal),
    OrganizationMembershipDirectoryUnavailableError,
  );
  await assert.rejects(
    () => runtime.listByOrganization('org_001'),
    WorkspaceTeamPersistenceUnavailableError,
  );
  await assert.rejects(
    () => runtime.get('user_123', 'org_001'),
    WorkspaceNotificationPreferencesPersistenceUnavailableError,
  );
  await assert.rejects(
    () =>
      runtime.put('user_123', 'org_001', {
        meeting_reminders: true,
        transcript_ready: true,
        action_items: true,
        desktop_link_events: true,
      }),
    WorkspaceNotificationPreferencesPersistenceUnavailableError,
  );
  await assert.rejects(
    () => runtime.getProfile('user_123', 'org_001'),
    WorkspaceProfilePersistenceUnavailableError,
  );
  await assert.rejects(
    () =>
      runtime.putProfile('user_123', 'org_001', {
        display_name: '',
        job_title: '',
      }),
    WorkspaceProfilePersistenceUnavailableError,
  );
  await assert.rejects(
    () => runtime.getOrganizationProfile('org_001'),
    WorkspaceOrganizationProfilePersistenceUnavailableError,
  );
  await assert.rejects(
    () =>
      runtime.putOrganizationProfile('org_001', {
        display_name: 'Vertex Systems',
      }),
    WorkspaceOrganizationProfilePersistenceUnavailableError,
  );
  await assert.rejects(
    () =>
      runtime.changeOrdinaryMemberStatus(
        'manager_123',
        'org_001',
        'membership_target',
        'suspended',
      ),
    WorkspaceTeamMemberStatusPersistenceUnavailableError,
  );
  assert.equal(factoryCalls, 0);
  await runtime.onApplicationShutdown();
});

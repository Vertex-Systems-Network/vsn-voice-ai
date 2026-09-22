import { expect, test } from '@playwright/test';

test('workspace renders explicit tenant-safe signed-out states', async ({ page }) => {
  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({ status: 401 });
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('without invented account state');
  await expect(page.locator('.session-state')).toHaveText('Signed out');
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expect(page.locator('.area-card')).toHaveCount(7);
  await expect(page.getByText('No meetings yet')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Select a workspace for access details' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select a workspace to link a desktop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Authentication required' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select a workspace first' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Select a workspace for your profile' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Select a workspace for notification settings',
    }),
  ).toBeVisible();
});

test('authenticated directory requires explicit selection before team data loads', async ({ page }) => {
  let teamRequestCount = 0;
  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    teamRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            subject_id: 'member_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });

  await page.goto('/');
  await expect(page.locator('.session-state')).toHaveText(
    'Authenticated workspace session',
  );
  await expect(page.getByRole('heading', { name: '1 workspace available' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select a workspace first' })).toBeVisible();
  expect(teamRequestCount).toBe(0);

  const selectButton = page.getByRole('button', { name: 'Select workspace org_1' });
  await expect(selectButton).toBeVisible();
  await selectButton.click();

  await expect(page.getByRole('heading', { name: '1 team member' })).toBeVisible();
  const teamRow = page.locator('.team-member-row');
  await expect(teamRow).toHaveCount(1);
  await expect(teamRow.getByText('Team membership', { exact: true })).toBeVisible();
  await expect(teamRow.getByText('member', { exact: true })).toBeVisible();
  await expect(page.getByText('member_1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('membership_1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Select a workspace first' })).toHaveCount(0);
  expect(teamRequestCount).toBe(1);
});

test('workspace sends baseline browser security headers', async ({ request }) => {
  const response = await request.get('/');

  expect(response.ok()).toBe(true);
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['permissions-policy']).toBe(
    'camera=(), geolocation=(), microphone=(self)',
  );
});

test('keyboard can reach and activate the skip link', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator('#main-content')).toBeVisible();
});

test('workspace avoids horizontal overflow at configured viewport', async ({ page }) => {
  await page.goto('/');
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test('primary navigation keeps minimum interactive height', async ({ page }) => {
  await page.goto('/');
  const firstNavigationLink = page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link').first();
  const box = await firstNavigationLink.boundingBox();

  expect(box).not.toBeNull();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('selected workspace can issue a transient one-time desktop link', async ({ page }) => {
  let issueRequestBody: unknown = null;

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/organizations/org_1/desktop-links', async (route) => {
    issueRequestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        record_id: '550e8400-e29b-41d4-a716-446655440000',
        exchange_token: 'A'.repeat(43),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Select a workspace to link a desktop' })).toBeVisible();

  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await expect(page.getByRole('heading', { name: 'Link a desktop' })).toBeVisible();

  await page.getByLabel('Desktop device ID').fill('desktop_001');
  await page.getByRole('button', { name: 'Create one-time link' }).click();

  await expect(page.getByRole('heading', { name: 'Desktop link ready' })).toBeVisible();
  await expect(page.getByText('550e8400-e29b-41d4-a716-446655440000')).toBeVisible();
  await expect(page.getByText('A'.repeat(43))).toBeVisible();
  expect(issueRequestBody).toEqual({ device_id: 'desktop_001' });

  await page.getByLabel('Desktop device ID').fill('desktop_002');
  await expect(page.getByText('550e8400-e29b-41d4-a716-446655440000')).toHaveCount(0);
  await expect(page.getByText('A'.repeat(43))).toHaveCount(0);
});

test('one-time desktop link clears automatically after expiry', async ({ page }) => {
  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/organizations/org_1/desktop-links', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        record_id: '550e8400-e29b-41d4-a716-446655440000',
        exchange_token: 'B'.repeat(43),
        expires_at: new Date(Date.now() + 1_500).toISOString(),
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await page.getByLabel('Desktop device ID').fill('desktop_001');
  await page.getByRole('button', { name: 'Create one-time link' }).click();

  await expect(page.getByText('550e8400-e29b-41d4-a716-446655440000')).toBeVisible();
  await expect(page.getByText('B'.repeat(43))).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Desktop link expired' }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('550e8400-e29b-41d4-a716-446655440000')).toHaveCount(0);
  await expect(page.getByText('B'.repeat(43))).toHaveCount(0);
});

test('desktop link reports completion after approved desktop consumes exchange', async ({ page }) => {
  let statusRequestCount = 0;

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/organizations/org_1/desktop-links', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        record_id: '550e8400-e29b-41d4-a716-446655440000',
        exchange_token: 'C'.repeat(43),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
  });
  await page.route(
    '**/v1/organizations/org_1/desktop-links/550e8400-e29b-41d4-a716-446655440000/status',
    async (route) => {
      statusRequestCount += 1;
      const consumed = statusRequestCount >= 2;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          record_id: '550e8400-e29b-41d4-a716-446655440000',
          organization_id: 'org_1',
          device_id: 'desktop_001',
          status: consumed ? 'consumed' : 'issued',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          consumed_at: consumed ? new Date().toISOString() : null,
        }),
      });
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await page.getByLabel('Desktop device ID').fill('desktop_001');
  await page.getByRole('button', { name: 'Create one-time link' }).click();

  await expect(page.getByText('C'.repeat(43))).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Desktop linked' }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('C'.repeat(43))).toHaveCount(0);
  await expect(
    page.getByText('550e8400-e29b-41d4-a716-446655440000'),
  ).toHaveCount(0);
  expect(statusRequestCount).toBeGreaterThanOrEqual(2);
});

test('pending desktop link can be cancelled from the browser', async ({ page }) => {
  let revokeRequestCount = 0;

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/organizations/org_1/desktop-links', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        record_id: '550e8400-e29b-41d4-a716-446655440000',
        exchange_token: 'D'.repeat(43),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
  });
  await page.route(
    '**/v1/organizations/org_1/desktop-links/550e8400-e29b-41d4-a716-446655440000/status',
    async (route) => {
      await route.fulfill({ status: 404 });
    },
  );
  await page.route(
    '**/v1/organizations/org_1/desktop-links/550e8400-e29b-41d4-a716-446655440000/revoke',
    async (route) => {
      revokeRequestCount += 1;
      expect(route.request().method()).toBe('POST');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          record_id: '550e8400-e29b-41d4-a716-446655440000',
          organization_id: 'org_1',
          device_id: 'desktop_001',
          status: 'revoked',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          consumed_at: null,
        }),
      });
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await page.getByLabel('Desktop device ID').fill('desktop_001');
  await page.getByRole('button', { name: 'Create one-time link' }).click();

  await expect(page.getByText('D'.repeat(43))).toBeVisible();
  await page.getByRole('button', { name: 'Cancel desktop link' }).click();

  await expect(
    page.getByRole('heading', { name: 'Desktop link cancelled' }),
  ).toBeVisible();
  await expect(page.getByText('D'.repeat(43))).toHaveCount(0);
  await expect(
    page.getByText('550e8400-e29b-41d4-a716-446655440000'),
  ).toHaveCount(0);
  expect(revokeRequestCount).toBe(1);
});

test('selected workspace renders persisted linked desktop inventory', async ({ page }) => {
  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route(
    '**/v1/organizations/org_1/desktop-links/linked',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_1',
          devices: [
            {
              schema_version: 1,
              record_id: '550e8400-e29b-41d4-a716-446655440000',
              device_id: 'desktop_persisted',
              linked_at: '2026-09-22T02:30:00.000Z',
            },
          ],
          has_more: false,
        }),
      });
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();

  await expect(page.getByRole('heading', { name: 'Linked desktops' })).toBeVisible();
  await expect(page.getByText('desktop_persisted')).toBeVisible();
  await expect(page.getByText('2026-09-22T02:30:00.000Z')).toBeVisible();
});

test('invited and suspended memberships cannot become selected workspaces', async ({ page }) => {
  let tenantBoundRequestCount = 0;

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_active',
            organization_id: 'org_active',
            status: 'active',
            roles: ['member'],
          },
          {
            schema_version: 1,
            membership_id: 'membership_invited',
            organization_id: 'org_invited',
            status: 'invited',
            roles: ['member'],
          },
          {
            schema_version: 1,
            membership_id: 'membership_suspended',
            organization_id: 'org_suspended',
            status: 'suspended',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });

  await page.route('**/v1/workspaces/*/team', async (route) => {
    tenantBoundRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_active',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/organizations/*/desktop-links/linked', async (route) => {
    tenantBoundRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_active',
        devices: [],
        has_more: false,
      }),
    });
  });

  await page.goto('/');

  await expect(
    page.getByRole('button', { name: 'Invitation pending: org_invited' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Access suspended: org_suspended' }),
  ).toBeDisabled();
  expect(tenantBoundRequestCount).toBe(0);

  await page.getByRole('button', { name: 'Select workspace org_active' }).click();

  await expect(
    page.getByRole('button', { name: 'Selected: org_active' }),
  ).toBeDisabled();
  await expect(page.getByText('Active · selected')).toBeVisible();
  expect(tenantBoundRequestCount).toBeGreaterThanOrEqual(2);
});

test('selected workspace renders tenant-authorized access overview', async ({ page }) => {
  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_directory',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        authorization: {
          schema_version: 1,
          subject_id: 'subject_must_not_render',
          organization_id: 'org_1',
          membership_id: 'membership_must_not_render',
          roles: ['member', 'operator'],
          permissions: ['conversation.read', 'team.read', 'device.link'],
        },
        meetings: { status: 'unloaded', items: [] },
        devices: { status: 'unloaded', items: [] },
        team: { status: 'unloaded', items: [] },
        settings: { status: 'unloaded', items: [] },
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route(
    '**/v1/organizations/org_1/desktop-links/linked',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_1',
          devices: [],
          has_more: false,
        }),
      });
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();

  await expect(
    page.getByRole('heading', { name: 'Workspace access verified' }),
  ).toBeVisible();
  await expect(page.getByText('member, operator')).toBeVisible();
  await expect(
    page.getByText('conversation.read, team.read, device.link'),
  ).toBeVisible();
  await expect(page.getByText('subject_must_not_render')).toHaveCount(0);
  await expect(page.getByText('membership_must_not_render')).toHaveCount(0);
});

test('workspace refresh clears selected tenant after session expires', async ({ page }) => {
  let authenticated = true;

  await page.route('**/v1/workspaces', async (route) => {
    if (!authenticated) {
      await route.fulfill({ status: 401 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        authorization: {
          schema_version: 1,
          subject_id: 'subject_internal',
          organization_id: 'org_1',
          membership_id: 'membership_internal',
          roles: ['member'],
          permissions: ['team.read', 'device.link'],
        },
        meetings: { status: 'unloaded', items: [] },
        devices: { status: 'unloaded', items: [] },
        team: { status: 'unloaded', items: [] },
        settings: { status: 'unloaded', items: [] },
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route(
    '**/v1/organizations/org_1/desktop-links/linked',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_1',
          devices: [],
          has_more: false,
        }),
      });
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();

  await expect(
    page.getByRole('heading', { name: 'Workspace access verified' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Selected: org_1' }),
  ).toBeDisabled();

  authenticated = false;
  await page.getByRole('button', { name: 'Refresh workspaces' }).click();

  await expect(page.locator('.session-state')).toHaveText('Signed out');
  await expect(
    page.getByRole('heading', { name: 'Select a workspace for access details' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Select a workspace to link a desktop' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Select a workspace first' }),
  ).toBeVisible();
});

test('workspace refresh clears selected tenant after membership is suspended', async ({ page }) => {
  let membershipStatus = 'active';

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: membershipStatus,
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        authorization: {
          schema_version: 1,
          subject_id: 'subject_internal',
          organization_id: 'org_1',
          membership_id: 'membership_internal',
          roles: ['member'],
          permissions: ['team.read', 'device.link'],
        },
        meetings: { status: 'unloaded', items: [] },
        devices: { status: 'unloaded', items: [] },
        team: { status: 'unloaded', items: [] },
        settings: { status: 'unloaded', items: [] },
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route(
    '**/v1/organizations/org_1/desktop-links/linked',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_1',
          devices: [],
          has_more: false,
        }),
      });
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();

  await expect(
    page.getByRole('heading', { name: 'Workspace access verified' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Selected: org_1' }),
  ).toBeDisabled();

  membershipStatus = 'suspended';
  await page.getByRole('button', { name: 'Refresh workspaces' }).click();

  await expect(page.locator('.session-state')).toHaveText(
    'Authenticated workspace session',
  );
  await expect(
    page.getByRole('button', { name: 'Access suspended: org_1' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: 'Select a workspace for access details' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Select a workspace to link a desktop' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Select a workspace first' }),
  ).toBeVisible();
});


test('notification settings stay unloaded until selection then save exact tenant-bound preferences', async ({ page }) => {
  let preferenceRequestCount = 0;
  let savedBody: unknown = null;

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route(
    '**/v1/workspaces/org_1/notification-preferences',
    async (route) => {
      preferenceRequestCount += 1;
      if (route.request().method() === 'PUT') {
        savedBody = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            schema_version: 1,
            organization_id: 'org_1',
            ...(savedBody as Record<string, boolean>),
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_1',
          meeting_reminders: true,
          transcript_ready: false,
          action_items: true,
          desktop_link_events: false,
        }),
      });
    },
  );

  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      name: 'Select a workspace for notification settings',
    }),
  ).toBeVisible();
  expect(preferenceRequestCount).toBe(0);

  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await expect(
    page.getByRole('heading', { name: 'Notification settings' }),
  ).toBeVisible();
  expect(preferenceRequestCount).toBe(1);

  const reminders = page.getByLabel('Meeting reminders');
  const transcript = page.getByLabel('Transcript ready');
  await expect(reminders).toBeChecked();
  await expect(transcript).not.toBeChecked();

  await reminders.uncheck();
  await transcript.check();
  await page.getByRole('button', { name: 'Save notification settings' }).click();

  await expect(page.getByText('Notification settings saved')).toBeVisible();
  expect(savedBody).toEqual({
    meeting_reminders: false,
    transcript_ready: true,
    action_items: true,
    desktop_link_events: false,
  });
  expect(preferenceRequestCount).toBe(2);
});

test('switching workspace reloads notification preferences without retaining prior tenant values', async ({ page }) => {
  const preferenceRequests: string[] = [];

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
          {
            schema_version: 1,
            membership_id: 'membership_2',
            organization_id: 'org_2',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/*/team', async (route) => {
    const organizationId = route.request().url().includes('/org_2/')
      ? 'org_2'
      : 'org_1';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: organizationId,
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route(
    '**/v1/workspaces/*/notification-preferences',
    async (route) => {
      const organizationId = route.request().url().includes('/org_2/')
        ? 'org_2'
        : 'org_1';
      preferenceRequests.push(organizationId);
      const enabled = organizationId === 'org_1';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: organizationId,
          meeting_reminders: enabled,
          transcript_ready: enabled,
          action_items: enabled,
          desktop_link_events: enabled,
        }),
      });
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await expect(page.getByLabel('Meeting reminders')).toBeChecked();

  await page.getByRole('button', { name: 'Select workspace org_2' }).click();
  await expect(page.getByLabel('Meeting reminders')).not.toBeChecked();
  await expect(page.getByLabel('Transcript ready')).not.toBeChecked();
  expect(preferenceRequests).toEqual(['org_1', 'org_2']);
});


test('late save response cannot overwrite notification settings after tenant switch', async ({ page }) => {
  let releaseOrgOneSave: () => void = () => undefined;
  const orgOneSaveStarted = new Promise<void>((resolve) => {
    releaseOrgOneSave = resolve;
  });
  let finishOrgOneSave: () => void = () => undefined;
  const orgOneSaveCanFinish = new Promise<void>((resolve) => {
    finishOrgOneSave = resolve;
  });

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
          {
            schema_version: 1,
            membership_id: 'membership_2',
            organization_id: 'org_2',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/*/team', async (route) => {
    const organizationId = route.request().url().includes('/org_2/')
      ? 'org_2'
      : 'org_1';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: organizationId,
        members: [],
        has_more: false,
      }),
    });
  });
  await page.route(
    '**/v1/workspaces/org_1/notification-preferences',
    async (route) => {
      if (route.request().method() === 'PUT') {
        releaseOrgOneSave();
        await orgOneSaveCanFinish;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            schema_version: 1,
            organization_id: 'org_1',
            meeting_reminders: false,
            transcript_ready: false,
            action_items: false,
            desktop_link_events: false,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_1',
          meeting_reminders: true,
          transcript_ready: true,
          action_items: true,
          desktop_link_events: true,
        }),
      });
    },
  );
  await page.route(
    '**/v1/workspaces/org_2/notification-preferences',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_2',
          meeting_reminders: true,
          transcript_ready: false,
          action_items: true,
          desktop_link_events: false,
        }),
      });
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible();

  await page.getByLabel('Meeting reminders').uncheck();
  await page.getByRole('button', { name: 'Save notification settings' }).click();
  await orgOneSaveStarted;

  await page.getByRole('button', { name: 'Select workspace org_2' }).click();
  await expect(page.getByLabel('Meeting reminders')).toBeChecked();
  await expect(page.getByLabel('Transcript ready')).not.toBeChecked();

  finishOrgOneSave();
  await page.waitForTimeout(100);
  await expect(page.getByLabel('Meeting reminders')).toBeChecked();
  await expect(page.getByLabel('Transcript ready')).not.toBeChecked();
});


test('workspace profile stays unloaded until selection then saves exact tenant-bound fields', async ({ page }) => {
  let profileRequestCount = 0;
  let savedBody: unknown = null;

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/profile', async (route) => {
    profileRequestCount += 1;
    if (route.request().method() === 'PUT') {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_1',
          ...(savedBody as Record<string, unknown>),
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        display_name: 'Ada Lovelace',
        job_title: 'Research Engineer',
      }),
    });
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Select a workspace for your profile' }),
  ).toBeVisible();
  expect(profileRequestCount).toBe(0);

  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada Lovelace');
  await expect(page.getByLabel('Job title')).toHaveValue('Research Engineer');

  await page.getByLabel('Display name').fill('Grace Hopper');
  await page.getByLabel('Job title').fill('Engineer');
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page.getByText('Workspace profile saved')).toBeVisible();
  expect(savedBody).toEqual({
    display_name: 'Grace Hopper',
    job_title: 'Engineer',
  });
  expect(profileRequestCount).toBe(2);
});

test('late workspace profile save cannot overwrite a newly selected tenant', async ({ page }) => {
  let releaseOrgOneSave: () => void = () => undefined;
  const orgOneSaveStarted = new Promise<void>((resolve) => {
    releaseOrgOneSave = resolve;
  });
  let finishOrgOneSave: () => void = () => undefined;
  const orgOneSaveCanFinish = new Promise<void>((resolve) => {
    finishOrgOneSave = resolve;
  });

  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        workspaces: [
          {
            schema_version: 1,
            membership_id: 'membership_1',
            organization_id: 'org_1',
            status: 'active',
            roles: ['member'],
          },
          {
            schema_version: 1,
            membership_id: 'membership_2',
            organization_id: 'org_2',
            status: 'active',
            roles: ['member'],
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route('**/v1/workspaces/org_1/profile', async (route) => {
    if (route.request().method() === 'PUT') {
      releaseOrgOneSave();
      await orgOneSaveCanFinish;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 1,
          organization_id: 'org_1',
          display_name: 'Old tenant response',
          job_title: 'Old tenant title',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_1',
        display_name: 'Ada Lovelace',
        job_title: 'Research Engineer',
      }),
    });
  });
  await page.route('**/v1/workspaces/org_2/profile', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        organization_id: 'org_2',
        display_name: 'Grace Hopper',
        job_title: 'Engineer',
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Select workspace org_1' }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada Lovelace');

  await page.getByLabel('Display name').fill('Pending org one');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await orgOneSaveStarted;

  await page.getByRole('button', { name: 'Select workspace org_2' }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Grace Hopper');
  await expect(page.getByLabel('Job title')).toHaveValue('Engineer');

  finishOrgOneSave();
  await page.waitForTimeout(100);
  await expect(page.getByLabel('Display name')).toHaveValue('Grace Hopper');
  await expect(page.getByLabel('Job title')).toHaveValue('Engineer');
});

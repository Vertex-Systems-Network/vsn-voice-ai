import { expect, test } from '@playwright/test';

test('workspace renders explicit tenant-safe signed-out states', async ({ page }) => {
  await page.route('**/v1/workspaces', async (route) => {
    await route.fulfill({ status: 401 });
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('without invented account state');
  await expect(page.locator('.session-state')).toHaveText('Authentication not connected');
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expect(page.locator('.area-card')).toHaveCount(5);
  await expect(page.getByText('No meetings yet')).toBeVisible();
  await expect(page.getByText('No linked desktop shown')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Authentication required' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select a workspace first' })).toBeVisible();
  await expect(page.getByText('Settings are not connected yet')).toBeVisible();
});

test('authenticated directory requires explicit selection before team data loads', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: '1 workspace available' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select a workspace first' })).toBeVisible();

  const selectButton = page.getByRole('button', { name: 'Select workspace org_1' });
  await expect(selectButton).toBeVisible();
  await selectButton.click();

  await expect(page.getByRole('heading', { name: '1 team member' })).toBeVisible();
  await expect(page.getByText('member_1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select a workspace first' })).toHaveCount(0);
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

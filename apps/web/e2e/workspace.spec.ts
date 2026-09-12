import { expect, test } from '@playwright/test';

test('workspace renders explicit tenant-safe empty states', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('without invented account state');
  await expect(page.getByRole('status')).toHaveText('Authentication not connected');
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expect(page.locator('.area-card')).toHaveCount(4);
  await expect(page.getByText('No meetings yet')).toBeVisible();
  await expect(page.getByText('No linked desktop shown')).toBeVisible();
  await expect(page.getByText('Team data not loaded')).toBeVisible();
  await expect(page.getByText('Settings are not connected yet')).toBeVisible();
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

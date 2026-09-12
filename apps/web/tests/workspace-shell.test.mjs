import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

test('workspace shell keeps account and tenant data explicitly empty', () => {
  assert.match(pageSource, /Authentication not connected/);
  assert.match(pageSource, /No meetings yet/);
  assert.match(pageSource, /No linked desktop shown/);
  assert.match(pageSource, /Team data not loaded/);
  assert.match(pageSource, /No production credential, identity provider, tenant record or meeting artifact/);
});

test('workspace shell exposes baseline keyboard and semantic accessibility affordances', () => {
  assert.match(layoutSource, /Skip to main content/);
  assert.match(layoutSource, /href="#main-content"/);
  assert.match(pageSource, /<main id="main-content"/);
  assert.match(pageSource, /<nav aria-label="Workspace navigation">/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(cssSource, /:focus-visible/);
  assert.match(cssSource, /prefers-reduced-motion: reduce/);
});

test('workspace shell has explicit responsive breakpoints', () => {
  assert.match(cssSource, /@media \(max-width: 820px\)/);
  assert.match(cssSource, /@media \(max-width: 620px\)/);
});

test('web framework dependencies are exact pinned versions', () => {
  assert.equal(packageJson.dependencies.next, '16.3.4');
  assert.equal(packageJson.dependencies.react, '19.3.0');
  assert.equal(packageJson.dependencies['react-dom'], '19.3.0');
  for (const version of Object.values(packageJson.dependencies)) {
    assert.doesNotMatch(version, /^[~^><=*]/);
  }
});

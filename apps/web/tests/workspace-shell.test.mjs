import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
const workspaceFlowSource = await readFile(
  new URL('../components/workspace-team-workspace.tsx', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

test('workspace shell keeps unverified account and tenant state explicit', () => {
  assert.match(pageSource, /workspaceSessionView/);
  assert.match(pageSource, /onSessionStateChange=\{setSessionState\}/);
  assert.doesNotMatch(pageSource, /Authentication not connected/);
  assert.match(pageSource, /No meetings yet/);
  assert.match(workspaceFlowSource, /WorkspaceOverviewPanel/);
  assert.match(workspaceFlowSource, /WorkspaceDesktopLinkPanel/);
  assert.match(pageSource, /Settings are not connected yet/);
  assert.match(pageSource, /WorkspaceTeamWorkspace/);
  assert.match(workspaceFlowSource, /Select a workspace first/);
  assert.match(workspaceFlowSource, /Team data stays unloaded until you explicitly choose/);
  assert.match(pageSource, /No production credential, identity provider, tenant record or meeting artifact/);
});

test('root team flow requires explicit authenticated organization selection', () => {
  assert.match(workspaceFlowSource, /useState<string \| null>\(null\)/);
  assert.match(workspaceFlowSource, /onSelectWorkspace=\{setOrganizationId\}/);
  assert.match(workspaceFlowSource, /onInvalidateWorkspaceSelection=\{handleWorkspaceSelectionInvalidated\}/);
  assert.match(workspaceFlowSource, /handleSessionStateChange/);
  assert.match(
    workspaceFlowSource,
    /state === 'signed_out' \|\| state === 'unavailable'/,
  );
  assert.doesNotMatch(workspaceFlowSource, /state !== 'authenticated'/);
  assert.match(workspaceFlowSource, /organizationId === null/);
  assert.match(workspaceFlowSource, /<WorkspaceDesktopLinkPanel organizationId=\{organizationId\}/);
  assert.match(workspaceFlowSource, /<WorkspaceTeamPanel organizationId=\{organizationId\}/);
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

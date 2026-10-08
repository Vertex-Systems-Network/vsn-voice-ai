import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const panelState = require('../.test-dist/workspace-desktop-link-panel-state.js');

const exchange = {
  schema_version: 1,
  record_id: '550e8400-e29b-41d4-a716-446655440000',
  exchange_token: 'A'.repeat(43),
  expires_at: '2026-09-22T01:30:00.000Z',
};

test('selection-required and idle views expose no exchange token', () => {
  for (const view of [
    panelState.workspaceDesktopLinkSelectionRequiredView(),
    panelState.workspaceDesktopLinkIdleView(),
  ]) {
    assert.equal(view.exchange, null);
    assert.equal(Object.isFrozen(view), true);
  }
});

test('ready view carries only validated transient exchange data', () => {
  const view = panelState.workspaceDesktopLinkPanelView({
    status: 'ready',
    data: exchange,
  });

  assert.equal(view.heading, 'Desktop link ready');
  assert.equal(view.badge, 'One-time exchange');
  assert.equal(view.tone, 'ready');
  assert.equal(view.exchange, exchange);
});

test('auth and failure states never echo backend or token details', () => {
  for (const status of [
    'invalid_input',
    'authentication_required',
    'forbidden',
    'invalid_response',
    'unavailable',
  ]) {
    const view = panelState.workspaceDesktopLinkPanelView({ status });
    assert.equal(view.exchange, null);
    assert.equal(view.description.includes(exchange.exchange_token), false);
    assert.equal(view.description.includes('database'), false);
  }
});

test('expired view clears the exchange contract', () => {
  const view = panelState.workspaceDesktopLinkExpiredView();

  assert.equal(view.heading, 'Desktop link expired');
  assert.equal(view.badge, 'Expired');
  assert.equal(view.tone, 'warning');
  assert.equal(view.exchange, null);
  assert.equal(Object.isFrozen(view), true);
});

test('linked and unavailable views clear the exchange contract', () => {
  const linked = panelState.workspaceDesktopLinkLinkedView();
  const unavailable = panelState.workspaceDesktopLinkUnavailableView();

  assert.equal(linked.heading, 'Desktop linked');
  assert.equal(linked.badge, 'Linked');
  assert.equal(linked.exchange, null);
  assert.equal(unavailable.heading, 'Desktop link unavailable');
  assert.equal(unavailable.exchange, null);
});

test('cancelled view clears while unconfirmed cancellation preserves the exchange', () => {
  const cancelled = panelState.workspaceDesktopLinkCancelledView();
  const unconfirmed =
    panelState.workspaceDesktopLinkCancelUnavailableView(exchange);

  assert.equal(cancelled.heading, 'Desktop link cancelled');
  assert.equal(cancelled.badge, 'Cancelled');
  assert.equal(cancelled.exchange, null);

  assert.equal(unconfirmed.heading, 'Cancellation not confirmed');
  assert.equal(unconfirmed.badge, 'Cancel not confirmed');
  assert.equal(unconfirmed.exchange, exchange);
});

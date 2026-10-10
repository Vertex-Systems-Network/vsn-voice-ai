import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const proxy = require('../.test-dist/api-proxy.js');

const configured = { status: 'configured', config: { apiOrigin: 'https://api.example.test', timeoutMs: 1000 } };

function recordingFetch(response = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return typeof response === 'function' ? response(url, init) : response;
  };
  return { calls, fetchImpl };
}

function deps(fetchImpl, token = null) {
  return { fetchImpl, accessToken: async () => token };
}

function browserRequest(path, init = {}) {
  return new Request(`https://app.example.test${path}`, init);
}

test('config is fail-closed when unset and rejects unsafe origins and timeouts', () => {
  assert.deepEqual(proxy.loadApiProxyConfig({}), { status: 'not_configured' });
  assert.deepEqual(proxy.loadApiProxyConfig({ VSN_API_ORIGIN: 'https://api.example.test' }), {
    status: 'configured',
    config: { apiOrigin: 'https://api.example.test', timeoutMs: 10000 },
  });
  assert.equal(
    proxy.loadApiProxyConfig({ VSN_API_ORIGIN: 'http://127.0.0.1:4100', VSN_API_PROXY_TIMEOUT_MS: '2500' }).config.timeoutMs,
    2500,
  );
  for (const env of [
    { VSN_API_ORIGIN: 'http://api.example.test' },
    { VSN_API_ORIGIN: 'https://user:pass@api.example.test' },
    { VSN_API_ORIGIN: 'https://api.example.test/base' },
    { VSN_API_ORIGIN: 'https://api.example.test/?x=1' },
    { VSN_API_ORIGIN: 'not a url' },
    { VSN_API_ORIGIN: 'https://api.example.test', VSN_API_PROXY_TIMEOUT_MS: '0' },
    { VSN_API_ORIGIN: 'https://api.example.test', VSN_API_PROXY_TIMEOUT_MS: '30001' },
    { VSN_API_ORIGIN: 'https://api.example.test', VSN_API_PROXY_TIMEOUT_MS: '1e3' },
  ]) {
    assert.deepEqual(proxy.loadApiProxyConfig(env), { status: 'invalid' }, JSON.stringify(env));
  }
});

test('unconfigured or invalid proxy answers 503 without calling upstream', async () => {
  const { calls, fetchImpl } = recordingFetch();
  for (const config of [{ status: 'not_configured' }, { status: 'invalid' }]) {
    const response = await proxy.proxyApiRequest(browserRequest('/v1/workspaces'), ['workspaces'], config, deps(fetchImpl));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls.length, 0);
});

test('path segments are allowlisted and re-encoded', () => {
  assert.equal(proxy.buildUpstreamPath(['workspaces', 'org_1', 'team']), '/v1/workspaces/org_1/team');
  for (const segments of [[], ['..'], ['.'], ['a/b'], ['a b'], ['%2e%2e'], ['x'.repeat(257)], Array(9).fill('a'), ['.hidden']]) {
    assert.equal(proxy.buildUpstreamPath(segments), null, JSON.stringify(segments));
  }
});

test('GET forwards only safe headers, query, and no browser credentials', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const response = await proxy.proxyApiRequest(
    browserRequest('/v1/workspaces?cursor=abc', {
      headers: { cookie: 'session=secret', authorization: 'Bearer browser-token', 'x-forwarded-for': '1.2.3.4' },
    }),
    ['workspaces'],
    configured,
    deps(fetchImpl),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/v1/workspaces?cursor=abc');
  assert.equal(calls[0].init.redirect, 'manual');
  const sent = [...calls[0].init.headers.keys()].sort();
  assert.deepEqual(sent, ['accept']);
});

test('server access token is attached as bearer and malformed tokens fail closed', async () => {
  const { calls, fetchImpl } = recordingFetch();
  await proxy.proxyApiRequest(browserRequest('/v1/workspaces'), ['workspaces'], configured, deps(fetchImpl, 'a.b.c'));
  assert.equal(calls[0].init.headers.get('authorization'), 'Bearer a.b.c');

  for (const token of ['', 'bad token', 'x'.repeat(8193)]) {
    const response = await proxy.proxyApiRequest(browserRequest('/v1/workspaces'), ['workspaces'], configured, deps(fetchImpl, token));
    assert.equal(response.status, 503);
  }
  const throwing = { fetchImpl, accessToken: async () => { throw new Error('session store down'); } };
  assert.equal((await proxy.proxyApiRequest(browserRequest('/v1/workspaces'), ['workspaces'], configured, throwing)).status, 503);
  assert.equal(calls.length, 1);
});

test('PUT forwards bounded JSON bodies and rejects other media types and oversize bodies', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const ok = await proxy.proxyApiRequest(
    browserRequest('/v1/workspaces/org_1/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"display_name":"Ada"}' }),
    ['workspaces', 'org_1', 'profile'],
    configured,
    deps(fetchImpl),
  );
  assert.equal(ok.status, 200);
  assert.equal(new TextDecoder().decode(calls[0].init.body), '{"display_name":"Ada"}');
  assert.equal(calls[0].init.headers.get('content-type'), 'application/json');

  const textBody = await proxy.proxyApiRequest(
    browserRequest('/v1/x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' }),
    ['x'], configured, deps(fetchImpl),
  );
  assert.equal(textBody.status, 415);
  const huge = await proxy.proxyApiRequest(
    browserRequest('/v1/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'a'.repeat(proxy.MAX_PROXY_REQUEST_BODY_BYTES + 1) }),
    ['x'], configured, deps(fetchImpl),
  );
  assert.equal(huge.status, 413);
  const empty = await proxy.proxyApiRequest(browserRequest('/v1/x', { method: 'POST' }), ['x'], configured, deps(fetchImpl));
  assert.equal(empty.status, 200);
  assert.equal(calls[1].init.body, undefined);
  assert.equal(calls.length, 2);
});

test('disallowed methods, long queries and bad paths never reach upstream', async () => {
  const { calls, fetchImpl } = recordingFetch();
  assert.equal((await proxy.proxyApiRequest(browserRequest('/v1/x', { method: 'DELETE' }), ['x'], configured, deps(fetchImpl))).status, 405);
  assert.equal((await proxy.proxyApiRequest(browserRequest(`/v1/x?q=${'a'.repeat(2100)}`), ['x'], configured, deps(fetchImpl))).status, 414);
  assert.equal((await proxy.proxyApiRequest(browserRequest('/v1/x'), ['..'], configured, deps(fetchImpl))).status, 404);
  assert.equal(calls.length, 0);
});

test('upstream redirects, oversize bodies and failures map to safe gateway errors', async () => {
  const redirect = recordingFetch(new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
  assert.equal((await proxy.proxyApiRequest(browserRequest('/v1/x'), ['x'], configured, deps(redirect.fetchImpl))).status, 502);

  const big = recordingFetch(new Response('a'.repeat(proxy.MAX_PROXY_RESPONSE_BODY_BYTES + 1), { status: 200 }));
  assert.equal((await proxy.proxyApiRequest(browserRequest('/v1/x'), ['x'], configured, deps(big.fetchImpl))).status, 502);

  const failing = { fetchImpl: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1'); }, accessToken: async () => null };
  const down = await proxy.proxyApiRequest(browserRequest('/v1/x'), ['x'], configured, failing);
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { error: 'api_unavailable' });
});

test('upstream status passes through while set-cookie and other headers are stripped', async () => {
  const upstream = recordingFetch(new Response('{"error":"unauthorized"}', {
    status: 401,
    headers: { 'content-type': 'application/json', 'set-cookie': 'a=b', 'x-internal': 'secret' },
  }));
  const response = await proxy.proxyApiRequest(browserRequest('/v1/x'), ['x'], configured, deps(upstream.fetchImpl));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-internal'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/json');

  const noContent = recordingFetch(new Response(null, { status: 204 }));
  const empty = await proxy.proxyApiRequest(browserRequest('/v1/x', { method: 'PUT' }), ['x'], configured, deps(noContent.fetchImpl));
  assert.equal(empty.status, 204);
});

test('upstream timeouts abort and fail closed', async () => {
  const slow = {
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
    accessToken: async () => null,
  };
  const quick = { status: 'configured', config: { apiOrigin: 'https://api.example.test', timeoutMs: 20 } };
  assert.equal((await proxy.proxyApiRequest(browserRequest('/v1/x'), ['x'], quick, slow)).status, 503);
});

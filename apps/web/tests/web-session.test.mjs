import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const web = require('../.test-dist/web-session.js');

const SECRET = randomBytes(32).toString('base64url');
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const baseEnv = {
  VSN_WEB_OIDC_AUTHORIZATION_ENDPOINT: 'https://login.example.test/authorize?tenant=vsn',
  VSN_WEB_OIDC_TOKEN_ENDPOINT: 'https://login.example.test/token',
  VSN_WEB_OIDC_CLIENT_ID: 'vsn-web',
  VSN_WEB_OIDC_REDIRECT_URI: 'https://app.example.test/auth/callback',
  VSN_WEB_SESSION_SECRET: SECRET,
};

function config(env = baseEnv) {
  const result = web.loadWebSessionConfig(env);
  assert.equal(result.status, 'configured');
  return result.config;
}

function setCookies(response) {
  return response.headers.getSetCookie();
}

function cookieValue(response, name) {
  const header = setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
  return header === undefined ? undefined : header.slice(name.length + 1).split(';')[0];
}

function tokenFetch(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

async function startLogin(cfg = config()) {
  const response = web.beginLogin(cfg, NOW);
  const location = new URL(response.headers.get('location'));
  return { response, location, tx: cookieValue(response, web.LOGIN_TRANSACTION_COOKIE) };
}

function callback(query, tx) {
  return new Request(`https://app.example.test/auth/callback?${query}`, {
    headers: tx === undefined ? {} : { cookie: `other=1; ${web.LOGIN_TRANSACTION_COOKIE}=${tx}` },
  });
}

test('config is fail-closed when unset and strict when set', () => {
  assert.deepEqual(web.loadWebSessionConfig({}), { status: 'not_configured' });
  const cfg = config();
  assert.equal(cfg.publicOrigin, 'https://app.example.test');
  assert.equal(cfg.scope, 'openid');
  assert.equal(cfg.clientSecret, null);
  assert.equal(config({ ...baseEnv, VSN_WEB_OIDC_CLIENT_SECRET: 's3cret' }).clientSecret, 's3cret');
  assert.equal(
    config({ ...baseEnv, VSN_WEB_OIDC_REDIRECT_URI: 'http://localhost:3000/auth/callback', VSN_WEB_OIDC_TOKEN_ENDPOINT: 'http://127.0.0.1:8080/token' }).publicOrigin,
    'http://localhost:3000',
  );
  for (const env of [
    { VSN_WEB_OIDC_CLIENT_SECRET: 'orphan' },
    { ...baseEnv, VSN_WEB_SESSION_SECRET: undefined },
    { ...baseEnv, VSN_WEB_SESSION_SECRET: randomBytes(16).toString('base64url') },
    { ...baseEnv, VSN_WEB_SESSION_SECRET: 'not base64url!' },
    { ...baseEnv, VSN_WEB_OIDC_TOKEN_ENDPOINT: 'http://login.example.test/token' },
    { ...baseEnv, VSN_WEB_OIDC_TOKEN_ENDPOINT: 'https://login.example.test/token?x=1' },
    { ...baseEnv, VSN_WEB_OIDC_AUTHORIZATION_ENDPOINT: 'https://u:p@login.example.test/authorize' },
    { ...baseEnv, VSN_WEB_OIDC_REDIRECT_URI: 'https://app.example.test/other' },
    { ...baseEnv, VSN_WEB_OIDC_CLIENT_ID: ' vsn-web' },
    { ...baseEnv, VSN_WEB_OIDC_SCOPE: 'profile email' },
    { ...baseEnv, VSN_WEB_OIDC_SCOPE: 'openid  email' },
  ]) {
    assert.deepEqual(web.loadWebSessionConfig(env), { status: 'invalid' }, JSON.stringify(env).slice(0, 120));
  }
});

test('sealed values round-trip and reject tampering, wrong keys and junk', () => {
  const key = Buffer.from(SECRET, 'base64url');
  const sealed = web.sealValue(key, { a: 1 });
  assert.deepEqual(web.unsealValue(key, sealed), { a: 1 });
  assert.notEqual(web.sealValue(key, { a: 1 }), sealed);
  const flipped = Buffer.from(sealed, 'base64url');
  flipped[flipped.length - 1] ^= 1;
  assert.equal(web.unsealValue(key, flipped.toString('base64url')), undefined);
  assert.equal(web.unsealValue(randomBytes(32), sealed), undefined);
  for (const junk of ['', 'abc', 'has space', 'x'.repeat(web.MAX_COOKIE_VALUE_LENGTH + 1)]) {
    assert.equal(web.unsealValue(key, junk), undefined);
  }
});

test('login redirect carries PKCE S256, state and a hardened transaction cookie', async () => {
  const { response, location, tx } = await startLogin();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(location.origin + location.pathname, 'https://login.example.test/authorize');
  assert.equal(location.searchParams.get('tenant'), 'vsn');
  assert.equal(location.searchParams.get('response_type'), 'code');
  assert.equal(location.searchParams.get('client_id'), 'vsn-web');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://app.example.test/auth/callback');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(location.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
  const cookie = setCookies(response)[0];
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) {
    assert.ok(cookie.includes(attribute), attribute);
  }
  const transaction = web.unsealValue(config().sessionKey, tx);
  assert.equal(web.pkceChallenge(transaction.verifier), location.searchParams.get('code_challenge'));
  assert.equal(transaction.state, location.searchParams.get('state'));
});

test('callback exchanges the code with the verifier and sets an encrypted session cookie', async () => {
  const cfg = config();
  const { location, tx } = await startLogin(cfg);
  const state = location.searchParams.get('state');
  const { calls, fetchImpl } = tokenFetch({ access_token: 'aaa.bbb.ccc', token_type: 'Bearer', expires_in: 3600, refresh_token: 'never-stored' });
  const response = await web.completeLogin(callback(`code=abc&state=${state}`, tx), cfg, fetchImpl, NOW + 1000);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://app.example.test/');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(calls[0].url, 'https://login.example.test/token');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'abc');
  assert.equal(form.get('client_id'), 'vsn-web');
  assert.equal(web.pkceChallenge(form.get('code_verifier')), new URL(location).searchParams.get('code_challenge'));

  const sessionCookie = setCookies(response).find((c) => c.startsWith(`${web.SESSION_COOKIE}=`));
  assert.ok(sessionCookie.includes('Max-Age=3600'));
  assert.ok(sessionCookie.includes('HttpOnly'));
  assert.equal(sessionCookie.includes('aaa.bbb.ccc'), false);
  assert.equal(sessionCookie.includes('never-stored'), false);
  assert.equal(cookieValue(response, web.LOGIN_TRANSACTION_COOKIE), '');

  const sealed = cookieValue(response, web.SESSION_COOKIE);
  const apiRequest = new Request('https://app.example.test/v1/workspaces', { headers: { cookie: `${web.SESSION_COOKIE}=${sealed}` } });
  assert.equal(web.sessionAccessToken(apiRequest, cfg, NOW + 2000), 'aaa.bbb.ccc');
  assert.equal(web.sessionAccessToken(apiRequest, cfg, NOW + 1000 + 3600 * 1000), null);
});

test('confidential clients authenticate with HTTP Basic and session lifetime is capped', async () => {
  const cfg = config({ ...baseEnv, VSN_WEB_OIDC_CLIENT_SECRET: 's3cret' });
  const { location, tx } = await startLogin(cfg);
  const { calls, fetchImpl } = tokenFetch({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 999999 });
  const response = await web.completeLogin(callback(`code=abc&state=${location.searchParams.get('state')}`, tx), cfg, fetchImpl, NOW);
  assert.equal(calls[0].init.headers.get('authorization'), `Basic ${Buffer.from('vsn-web:s3cret').toString('base64')}`);
  assert.equal(new URLSearchParams(calls[0].init.body).get('client_id'), null);
  assert.ok(setCookies(response).some((c) => c.startsWith(web.SESSION_COOKIE) && c.includes(`Max-Age=${web.MAX_SESSION_TTL_SECONDS}`)));
});

test('callback fails closed on state, transaction and token-response problems', async () => {
  const cfg = config();
  const { location, tx } = await startLogin(cfg);
  const state = location.searchParams.get('state');
  const good = { access_token: 'a.b.c', token_type: 'Bearer', expires_in: 60 };
  const cases = [
    [callback(`code=abc&state=wrong`, tx), good, NOW],
    [callback(`code=abc&state=${state}`, undefined), good, NOW],
    [callback(`code=abc&state=${state}`, 'tampered'), good, NOW],
    [callback(`state=${state}`, tx), good, NOW],
    [callback(`code=abc&state=${state}`, tx), good, NOW + 601 * 1000],
    [callback(`code=abc&state=${state}`, tx), { ...good, token_type: 'mac' }, NOW],
    [callback(`code=abc&state=${state}`, tx), { ...good, access_token: 'has space' }, NOW],
    [callback(`code=abc&state=${state}`, tx), { ...good, expires_in: 0 }, NOW],
    [callback(`code=abc&state=${state}`, tx), { token_type: 'Bearer', expires_in: 60 }, NOW],
    [callback(`code=abc&state=${state}`, tx), { ...good, access_token: 'a'.repeat(4000) }, NOW],
    [callback(`code=abc&state=${state}`, tx), 'not json', NOW],
  ];
  for (const [request, body, now] of cases) {
    const { fetchImpl } = tokenFetch(body);
    const response = await web.completeLogin(request, cfg, fetchImpl, now);
    assert.equal(response.headers.get('location'), 'https://app.example.test/?login=failed');
    assert.equal(cookieValue(response, web.SESSION_COOKIE), undefined);
  }
  const rejected = tokenFetch({ error: 'invalid_grant' }, 400);
  const response = await web.completeLogin(callback(`code=abc&state=${state}`, tx), cfg, rejected.fetchImpl, NOW);
  assert.equal(response.headers.get('location'), 'https://app.example.test/?login=failed');
  const throwing = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal((await web.completeLogin(callback(`code=abc&state=${state}`, tx), cfg, throwing, NOW)).headers.get('location'), 'https://app.example.test/?login=failed');
});

test('CSRF guard accepts only same-origin fetch metadata or exact origins', () => {
  const req = (headers) => new Request('https://app.example.test/v1/x', { method: 'PUT', headers });
  assert.equal(web.isSameOriginMutation(req({ 'sec-fetch-site': 'same-origin' }), null), true);
  assert.equal(web.isSameOriginMutation(req({ 'sec-fetch-site': 'cross-site', origin: 'https://app.example.test' }), null), false);
  assert.equal(web.isSameOriginMutation(req({ 'sec-fetch-site': 'same-site' }), null), false);
  assert.equal(web.isSameOriginMutation(req({ origin: 'https://app.example.test' }), null), true);
  assert.equal(web.isSameOriginMutation(req({ origin: 'https://public.example.test' }), 'https://public.example.test'), true);
  assert.equal(web.isSameOriginMutation(req({ origin: 'https://evil.example.test' }), 'https://public.example.test'), false);
  assert.equal(web.isSameOriginMutation(req({}), 'https://public.example.test'), false);
});

test('logout clears the session only for same-origin requests', () => {
  const cfg = config();
  const ok = web.logout(new Request('https://app.example.test/auth/logout', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }), cfg);
  assert.equal(ok.status, 303);
  assert.equal(cookieValue(ok, web.SESSION_COOKIE), '');
  assert.ok(setCookies(ok)[0].includes('Max-Age=0'));
  const forged = web.logout(new Request('https://app.example.test/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example.test' } }), cfg);
  assert.equal(forged.status, 403);
  assert.equal(setCookies(forged).length, 0);
});

test('cookie reader finds exact names only', () => {
  assert.equal(web.readCookie('a=1; b=2', 'b'), '2');
  assert.equal(web.readCookie('ab=1', 'a'), null);
  assert.equal(web.readCookie(null, 'a'), null);
});

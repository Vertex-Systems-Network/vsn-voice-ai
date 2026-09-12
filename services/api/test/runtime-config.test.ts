import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntimeConfig } from '../src/config/runtime-config.js';

test('runtime config defaults are safe for local development', () => {
  assert.deepEqual(loadRuntimeConfig({}), {
    host: '127.0.0.1',
    port: 4100,
    environment: 'development',
  });
});

test('runtime config accepts explicit reviewed values', () => {
  assert.deepEqual(
    loadRuntimeConfig({
      VSN_API_HOST: '0.0.0.0',
      PORT: '8080',
      VSN_ENV: 'test',
    }),
    {
      host: '0.0.0.0',
      port: 8080,
      environment: 'test',
    },
  );
});

test('runtime config rejects malformed and privileged-invalid ports', () => {
  assert.throws(() => loadRuntimeConfig({ PORT: '41oo' }), /decimal digits/);
  assert.throws(() => loadRuntimeConfig({ PORT: '0' }), /between 1 and 65535/);
  assert.throws(() => loadRuntimeConfig({ PORT: '65536' }), /between 1 and 65535/);
});

test('runtime config rejects unknown environment and unsafe host text', () => {
  assert.throws(() => loadRuntimeConfig({ VSN_ENV: 'preview' }), /development, test, production/);
  assert.throws(() => loadRuntimeConfig({ VSN_API_HOST: 'bad host' }), /without whitespace/);
});

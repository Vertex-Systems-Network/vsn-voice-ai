import assert from 'node:assert/strict';
import test from 'node:test';

import { HealthController } from '../src/health/health.controller.js';

test('health surface returns only non-sensitive operational metadata', () => {
  const controller = new HealthController({
    host: '127.0.0.1',
    port: 4100,
    environment: 'test',
  });

  assert.deepEqual(controller.getHealth(), {
    status: 'ok',
    service: 'vsn-api',
    environment: 'test',
  });
});

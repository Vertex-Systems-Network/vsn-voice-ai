import { Controller, Get } from '@nestjs/common';

import type { RuntimeConfig } from '../config/runtime-config.js';

export interface HealthResponse {
  readonly status: 'ok';
  readonly service: 'vsn-api';
  readonly environment: RuntimeConfig['environment'];
}

@Controller('health')
export class HealthController {
  public constructor(private readonly runtimeConfig: RuntimeConfig) {}

  @Get()
  public getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'vsn-api',
      environment: this.runtimeConfig.environment,
    };
  }
}

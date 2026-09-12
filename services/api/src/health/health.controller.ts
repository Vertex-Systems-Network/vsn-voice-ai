import { Controller, Get, Inject } from '@nestjs/common';

import { RUNTIME_CONFIG } from '../config/runtime-config.js';
import type { RuntimeConfig } from '../config/runtime-config.js';

export interface HealthResponse {
  readonly status: 'ok';
  readonly service: 'vsn-api';
  readonly environment: RuntimeConfig['environment'];
}

@Controller('health')
export class HealthController {
  public constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtimeConfig: RuntimeConfig,
  ) {}

  @Get()
  public getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'vsn-api',
      environment: this.runtimeConfig.environment,
    };
  }
}

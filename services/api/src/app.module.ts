import { Module } from '@nestjs/common';

import { loadRuntimeConfig, RUNTIME_CONFIG } from './config/runtime-config.js';
import { HealthController } from './health/health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: RUNTIME_CONFIG,
      useFactory: () => loadRuntimeConfig(process.env),
    },
  ],
})
export class AppModule {}

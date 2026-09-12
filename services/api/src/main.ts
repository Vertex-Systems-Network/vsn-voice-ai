import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { RUNTIME_CONFIG } from './config/runtime-config.js';
import type { RuntimeConfig } from './config/runtime-config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: false,
      logger: false,
    }),
    {
      abortOnError: true,
    },
  );

  app.enableShutdownHooks();

  const config = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  await app.listen(config.port, config.host);
}

void bootstrap();

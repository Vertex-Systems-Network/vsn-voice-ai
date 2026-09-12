import { Module } from '@nestjs/common';

import { loadRuntimeConfig, RUNTIME_CONFIG } from './config/runtime-config.js';
import { HealthController } from './health/health.controller.js';
import {
  RejectingTrustedPrincipalResolver,
  TRUSTED_PRINCIPAL_RESOLVER,
} from './identity/trusted-principal-resolver.js';
import { ORGANIZATION_MEMBERSHIP_RESOLVER } from './organizations/organization-membership-resolver.js';
import { createRuntimeOrganizationMembershipResolver } from './organizations/runtime-organization-membership-resolver.js';
import { WorkspaceController } from './workspace/workspace.controller.js';

@Module({
  controllers: [HealthController, WorkspaceController],
  providers: [
    {
      provide: RUNTIME_CONFIG,
      useFactory: () => loadRuntimeConfig(process.env),
    },
    {
      provide: TRUSTED_PRINCIPAL_RESOLVER,
      useClass: RejectingTrustedPrincipalResolver,
    },
    {
      provide: ORGANIZATION_MEMBERSHIP_RESOLVER,
      useFactory: () => createRuntimeOrganizationMembershipResolver(process.env),
    },
  ],
})
export class AppModule {}

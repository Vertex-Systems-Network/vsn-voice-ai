import { Module } from '@nestjs/common';

import { loadRuntimeConfig, RUNTIME_CONFIG } from './config/runtime-config.js';
import {
  DESKTOP_LINK_RECORD_STORE,
  type DesktopLinkRecordStore,
} from './device-link/desktop-link-record.js';
import { DesktopLinkController } from './device-link/desktop-link.controller.js';
import { DesktopLinkService } from './device-link/desktop-link.service.js';
import { createRuntimeDesktopLinkRecordStore } from './device-link/runtime-desktop-link-record-store.js';
import { HealthController } from './health/health.controller.js';
import {
  RejectingTrustedPrincipalResolver,
  TRUSTED_PRINCIPAL_RESOLVER,
} from './identity/trusted-principal-resolver.js';
import { ORGANIZATION_MEMBERSHIP_RESOLVER } from './organizations/organization-membership-resolver.js';
import { createRuntimeOrganizationMembershipResolver } from './organizations/runtime-organization-membership-resolver.js';
import { createRuntimeWorkspaceTeamRepository } from './workspace/runtime-workspace-team-repository.js';
import { WORKSPACE_TEAM_REPOSITORY } from './workspace/workspace-team-repository.js';
import { WorkspaceTeamController } from './workspace/workspace-team.controller.js';
import { WorkspaceController } from './workspace/workspace.controller.js';

@Module({
  controllers: [
    HealthController,
    WorkspaceController,
    WorkspaceTeamController,
    DesktopLinkController,
  ],
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
    {
      provide: WORKSPACE_TEAM_REPOSITORY,
      useFactory: () => createRuntimeWorkspaceTeamRepository(process.env),
    },
    {
      provide: DESKTOP_LINK_RECORD_STORE,
      useFactory: () => createRuntimeDesktopLinkRecordStore(process.env),
    },
    {
      provide: DesktopLinkService,
      inject: [DESKTOP_LINK_RECORD_STORE],
      useFactory: (store: DesktopLinkRecordStore) => new DesktopLinkService(store),
    },
  ],
})
export class AppModule {}

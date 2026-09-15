import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import {
  TRUSTED_PRINCIPAL_RESOLVER,
  type TrustedPrincipalResolver,
} from '../identity/trusted-principal-resolver.js';
import {
  ORGANIZATION_MEMBERSHIP_RESOLVER,
  type OrganizationMembershipResolver,
} from '../organizations/organization-membership-resolver.js';
import { AuthorizationDeniedError } from '../organizations/tenant-authorization.js';
import {
  loadWorkspaceTeam,
  WORKSPACE_TEAM_REPOSITORY,
  type WorkspaceTeamRepository,
  type WorkspaceTeamSnapshot,
  WorkspaceTeamDataIntegrityError,
  WorkspaceTeamPersistenceUnavailableError,
} from './workspace-team-repository.js';

@Controller('v1/workspaces')
export class WorkspaceTeamController {
  public constructor(
    @Inject(TRUSTED_PRINCIPAL_RESOLVER)
    private readonly principalResolver: TrustedPrincipalResolver,
    @Inject(ORGANIZATION_MEMBERSHIP_RESOLVER)
    private readonly membershipResolver: OrganizationMembershipResolver,
    @Inject(WORKSPACE_TEAM_REPOSITORY)
    private readonly teamRepository: WorkspaceTeamRepository,
  ) {}

  @Get(':organizationId/team')
  @Header('Cache-Control', 'no-store')
  public async getTeam(
    @Param('organizationId') organizationId: string,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceTeamSnapshot> {
    const normalizedOrganizationId = organizationId.trim();
    if (normalizedOrganizationId.length === 0) {
      throw new BadRequestException('organization id is required');
    }

    const principal = await this.principalResolver.resolve(request);
    if (principal === null) {
      throw new UnauthorizedException('authenticated principal is required');
    }

    const membership = await this.membershipResolver.resolve(
      principal,
      normalizedOrganizationId,
    );
    if (membership === null) {
      throw new ForbiddenException('organization membership is required');
    }

    try {
      return await loadWorkspaceTeam(
        {
          principal,
          membership,
          organizationId: normalizedOrganizationId,
        },
        this.teamRepository,
      );
    } catch (error: unknown) {
      if (error instanceof AuthorizationDeniedError) {
        throw new ForbiddenException('workspace team access denied');
      }
      if (
        error instanceof WorkspaceTeamPersistenceUnavailableError ||
        error instanceof WorkspaceTeamDataIntegrityError
      ) {
        throw new ServiceUnavailableException('workspace team unavailable');
      }
      throw error;
    }
  }
}

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Req,
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
  createWorkspaceBootstrap,
  type WorkspaceBootstrapResponse,
} from './workspace-bootstrap.js';

@Controller('v1/workspaces')
export class WorkspaceController {
  public constructor(
    @Inject(TRUSTED_PRINCIPAL_RESOLVER)
    private readonly principalResolver: TrustedPrincipalResolver,
    @Inject(ORGANIZATION_MEMBERSHIP_RESOLVER)
    private readonly membershipResolver: OrganizationMembershipResolver,
  ) {}

  @Get(':organizationId/bootstrap')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async getBootstrap(
    @Param('organizationId') organizationId: string,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceBootstrapResponse> {
    if (organizationId.trim().length === 0) {
      throw new BadRequestException('organization id is required');
    }

    const principal = await this.principalResolver.resolve(request);
    if (principal === null) {
      throw new UnauthorizedException('authenticated principal is required');
    }

    const membership = await this.membershipResolver.resolve(
      principal,
      organizationId,
    );
    if (membership === null) {
      throw new ForbiddenException('organization membership is required');
    }

    try {
      return createWorkspaceBootstrap({
        principal,
        membership,
        organizationId,
      });
    } catch (error: unknown) {
      if (error instanceof AuthorizationDeniedError) {
        throw new ForbiddenException('workspace access denied');
      }
      throw error;
    }
  }
}

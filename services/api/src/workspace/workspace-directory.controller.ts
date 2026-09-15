import {
  Controller,
  Get,
  Header,
  Inject,
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
  ORGANIZATION_MEMBERSHIP_DIRECTORY,
  type OrganizationMembershipDirectory,
  OrganizationMembershipDirectoryDataIntegrityError,
  OrganizationMembershipDirectoryUnavailableError,
} from '../organizations/organization-membership-directory.js';
import {
  buildWorkspaceDirectoryResponse,
  type WorkspaceDirectoryResponse,
  WorkspaceDirectoryDataIntegrityError,
} from './workspace-directory.js';

@Controller('v1/workspaces')
export class WorkspaceDirectoryController {
  public constructor(
    @Inject(TRUSTED_PRINCIPAL_RESOLVER)
    private readonly principalResolver: TrustedPrincipalResolver,
    @Inject(ORGANIZATION_MEMBERSHIP_DIRECTORY)
    private readonly membershipDirectory: OrganizationMembershipDirectory,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  public async listWorkspaces(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceDirectoryResponse> {
    const principal = await this.principalResolver.resolve(request);
    if (principal === null) {
      throw new UnauthorizedException('authenticated principal is required');
    }

    try {
      const snapshot = await this.membershipDirectory.listForPrincipal(principal);
      return buildWorkspaceDirectoryResponse(snapshot);
    } catch (error: unknown) {
      if (
        error instanceof OrganizationMembershipDirectoryUnavailableError ||
        error instanceof OrganizationMembershipDirectoryDataIntegrityError ||
        error instanceof WorkspaceDirectoryDataIntegrityError
      ) {
        throw new ServiceUnavailableException('workspace directory unavailable');
      }
      throw error;
    }
  }
}

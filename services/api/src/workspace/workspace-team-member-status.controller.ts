import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Inject,
  Param,
  Put,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import {
  resolveTrustedPrincipal,
  TRUSTED_PRINCIPAL_RESOLVER,
  type TrustedPrincipalResolver,
} from '../identity/trusted-principal-resolver.js';
import {
  ORGANIZATION_MEMBERSHIP_RESOLVER,
  type OrganizationMembershipResolver,
} from '../organizations/organization-membership-resolver.js';
import { AuthorizationDeniedError } from '../organizations/tenant-authorization.js';
import {
  changeWorkspaceTeamMemberStatus,
  type ManagedWorkspaceTeamMemberStatus,
  type WorkspaceTeamMemberStatusRepository,
  type WorkspaceTeamMemberStatusResponse,
  WORKSPACE_TEAM_MEMBER_STATUS_REPOSITORY,
  WorkspaceTeamMemberStatusDataIntegrityError,
  WorkspaceTeamMemberStatusMutationDeniedError,
  WorkspaceTeamMemberStatusPersistenceUnavailableError,
} from './workspace-team-member-status-repository.js';

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    normalized !== value
  ) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return normalized;
}

function parseStatus(body: unknown): ManagedWorkspaceTeamMemberStatus {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('team member status body must be an object');
  }
  const object = body as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length !== 1 || keys[0] !== 'status') {
    throw new BadRequestException('team member status body is invalid');
  }
  if (object.status !== 'active' && object.status !== 'suspended') {
    throw new BadRequestException('team member status is invalid');
  }
  return object.status;
}

@Controller('v1/workspaces/:organizationId/team')
export class WorkspaceTeamMemberStatusController {
  public constructor(
    @Inject(TRUSTED_PRINCIPAL_RESOLVER)
    private readonly principalResolver: TrustedPrincipalResolver,
    @Inject(ORGANIZATION_MEMBERSHIP_RESOLVER)
    private readonly membershipResolver: OrganizationMembershipResolver,
    @Inject(WORKSPACE_TEAM_MEMBER_STATUS_REPOSITORY)
    private readonly statusRepository: WorkspaceTeamMemberStatusRepository,
  ) {}

  @Put(':membershipId/status')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async putStatus(
    @Param('organizationId') rawOrganizationId: string,
    @Param('membershipId') rawMembershipId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceTeamMemberStatusResponse> {
    const organizationId = requireIdentifier(
      rawOrganizationId,
      'organization id',
    );
    const membershipId = requireIdentifier(rawMembershipId, 'membership id');
    const status = parseStatus(body);

    const identity = await resolveTrustedPrincipal(
      this.principalResolver,
      request,
    );
    if (identity.status === 'unauthenticated') {
      throw new UnauthorizedException('authenticated principal is required');
    }
    if (identity.status === 'unavailable') {
      throw new ServiceUnavailableException('authentication unavailable');
    }

    let membership;
    try {
      membership = await this.membershipResolver.resolve(
        identity.principal,
        organizationId,
      );
    } catch {
      throw new ServiceUnavailableException('workspace team unavailable');
    }
    if (membership === null) {
      throw new ForbiddenException('organization membership is required');
    }

    try {
      return await changeWorkspaceTeamMemberStatus(
        {
          principal: identity.principal,
          membership,
          organizationId,
          membershipId,
          status,
        },
        this.statusRepository,
      );
    } catch (error: unknown) {
      if (
        error instanceof AuthorizationDeniedError ||
        error instanceof WorkspaceTeamMemberStatusMutationDeniedError
      ) {
        throw new ForbiddenException('team member status update denied');
      }
      if (
        error instanceof WorkspaceTeamMemberStatusDataIntegrityError ||
        error instanceof WorkspaceTeamMemberStatusPersistenceUnavailableError
      ) {
        throw new ServiceUnavailableException('workspace team unavailable');
      }
      throw error;
    }
  }
}

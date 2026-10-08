import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
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
  loadWorkspaceOrganizationProfile,
  saveWorkspaceOrganizationProfile,
  type WorkspaceOrganizationProfileRepository,
  type WorkspaceOrganizationProfileResponse,
  type WorkspaceOrganizationProfileValues,
  WORKSPACE_ORGANIZATION_PROFILE_REPOSITORY,
  WorkspaceOrganizationProfileDataIntegrityError,
  WorkspaceOrganizationProfilePersistenceUnavailableError,
} from './workspace-organization-profile-repository.js';

function requireOrganizationId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    normalized !== value
  ) {
    throw new BadRequestException('organization id is invalid');
  }
  return normalized;
}

function parseProfile(body: unknown): WorkspaceOrganizationProfileValues {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(
      'workspace organization profile body must be an object',
    );
  }
  const object = body as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length !== 1 || keys[0] !== 'display_name') {
    throw new BadRequestException(
      'workspace organization profile body is invalid',
    );
  }
  if (
    typeof object.display_name !== 'string' ||
    object.display_name.length > 100 ||
    object.display_name.trim() !== object.display_name ||
    /[\u0000-\u001F\u007F]/u.test(object.display_name)
  ) {
    throw new BadRequestException('display_name is invalid');
  }
  return Object.freeze({ display_name: object.display_name });
}

@Controller('v1/workspaces/:organizationId/organization-profile')
export class WorkspaceOrganizationProfileController {
  public constructor(
    @Inject(TRUSTED_PRINCIPAL_RESOLVER)
    private readonly principalResolver: TrustedPrincipalResolver,
    @Inject(ORGANIZATION_MEMBERSHIP_RESOLVER)
    private readonly membershipResolver: OrganizationMembershipResolver,
    @Inject(WORKSPACE_ORGANIZATION_PROFILE_REPOSITORY)
    private readonly profileRepository: WorkspaceOrganizationProfileRepository,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async getProfile(
    @Param('organizationId') rawOrganizationId: string,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceOrganizationProfileResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const context = await this.resolveContext(request, organizationId);
    try {
      return await loadWorkspaceOrganizationProfile(
        context,
        this.profileRepository,
      );
    } catch (error: unknown) {
      this.rethrowDomainError(error);
    }
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async putProfile(
    @Param('organizationId') rawOrganizationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceOrganizationProfileResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const profile = parseProfile(body);
    const context = await this.resolveContext(request, organizationId);
    try {
      return await saveWorkspaceOrganizationProfile(
        context,
        profile,
        this.profileRepository,
      );
    } catch (error: unknown) {
      this.rethrowDomainError(error);
    }
  }

  private async resolveContext(
    request: FastifyRequest,
    organizationId: string,
  ) {
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
      throw new ServiceUnavailableException(
        'workspace organization profile unavailable',
      );
    }
    if (membership === null) {
      throw new ForbiddenException('organization membership is required');
    }

    return Object.freeze({
      principal: identity.principal,
      membership,
      organizationId,
    });
  }

  private rethrowDomainError(error: unknown): never {
    if (error instanceof AuthorizationDeniedError) {
      throw new ForbiddenException('workspace organization profile access denied');
    }
    if (
      error instanceof WorkspaceOrganizationProfilePersistenceUnavailableError ||
      error instanceof WorkspaceOrganizationProfileDataIntegrityError
    ) {
      throw new ServiceUnavailableException(
        'workspace organization profile unavailable',
      );
    }
    throw error;
  }
}

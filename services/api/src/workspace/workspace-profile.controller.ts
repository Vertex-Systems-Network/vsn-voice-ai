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
  loadWorkspaceProfile,
  saveWorkspaceProfile,
  type WorkspaceProfileRepository,
  type WorkspaceProfileResponse,
  type WorkspaceProfileValues,
  WORKSPACE_PROFILE_REPOSITORY,
  WorkspaceProfileDataIntegrityError,
  WorkspaceProfilePersistenceUnavailableError,
} from './workspace-profile-repository.js';

const MAX_IDENTIFIER_LENGTH = 128;
const profileKeys = ['display_name', 'job_title'] as const;

function requireOrganizationId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_IDENTIFIER_LENGTH ||
    normalized !== value
  ) {
    throw new BadRequestException('organization id is invalid');
  }
  return normalized;
}

function requireProfileText(
  value: unknown,
  maxLength: number,
  fieldName: string,
): string {
  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    value.trim() !== value ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw new BadRequestException(`${fieldName} is invalid`);
  }
  return value;
}

function parseProfile(body: unknown): WorkspaceProfileValues {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('workspace profile body must be an object');
  }
  const object = body as Record<string, unknown>;
  const keys = Object.keys(object);
  if (
    keys.length !== profileKeys.length ||
    keys.some((key) => !profileKeys.includes(key as (typeof profileKeys)[number]))
  ) {
    throw new BadRequestException('workspace profile body is invalid');
  }

  return Object.freeze({
    display_name: requireProfileText(object.display_name, 80, 'display_name'),
    job_title: requireProfileText(object.job_title, 120, 'job_title'),
  });
}

@Controller('v1/workspaces/:organizationId/profile')
export class WorkspaceProfileController {
  public constructor(
    @Inject(TRUSTED_PRINCIPAL_RESOLVER)
    private readonly principalResolver: TrustedPrincipalResolver,
    @Inject(ORGANIZATION_MEMBERSHIP_RESOLVER)
    private readonly membershipResolver: OrganizationMembershipResolver,
    @Inject(WORKSPACE_PROFILE_REPOSITORY)
    private readonly profileRepository: WorkspaceProfileRepository,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async getProfile(
    @Param('organizationId') rawOrganizationId: string,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceProfileResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const context = await this.resolveContext(request, organizationId);
    try {
      return await loadWorkspaceProfile(context, this.profileRepository);
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
  ): Promise<WorkspaceProfileResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const profile = parseProfile(body);
    const context = await this.resolveContext(request, organizationId);
    try {
      return await saveWorkspaceProfile(context, profile, this.profileRepository);
    } catch (error: unknown) {
      this.rethrowDomainError(error);
    }
  }

  private async resolveContext(
    request: FastifyRequest,
    organizationId: string,
  ) {
    const identity = await resolveTrustedPrincipal(this.principalResolver, request);
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
      throw new ServiceUnavailableException('workspace profile unavailable');
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
      throw new ForbiddenException('workspace profile access denied');
    }
    if (
      error instanceof WorkspaceProfilePersistenceUnavailableError ||
      error instanceof WorkspaceProfileDataIntegrityError
    ) {
      throw new ServiceUnavailableException('workspace profile unavailable');
    }
    throw error;
  }
}

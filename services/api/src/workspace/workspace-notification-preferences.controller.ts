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
  loadWorkspaceNotificationPreferences,
  saveWorkspaceNotificationPreferences,
  type WorkspaceNotificationPreferenceValues,
  WORKSPACE_NOTIFICATION_PREFERENCES_REPOSITORY,
  type WorkspaceNotificationPreferencesRepository,
  type WorkspaceNotificationPreferencesResponse,
  WorkspaceNotificationPreferencesDataIntegrityError,
  WorkspaceNotificationPreferencesPersistenceUnavailableError,
} from './workspace-notification-preferences-repository.js';

const MAX_IDENTIFIER_LENGTH = 128;
const preferenceKeys = [
  'meeting_reminders',
  'transcript_ready',
  'action_items',
  'desktop_link_events',
] as const;

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

function parsePreferences(body: unknown): WorkspaceNotificationPreferenceValues {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('notification preferences body must be an object');
  }
  const object = body as Record<string, unknown>;
  const keys = Object.keys(object);
  if (
    keys.length !== preferenceKeys.length ||
    keys.some((key) => !preferenceKeys.includes(key as (typeof preferenceKeys)[number]))
  ) {
    throw new BadRequestException('notification preferences body is invalid');
  }
  for (const key of preferenceKeys) {
    if (typeof object[key] !== 'boolean') {
      throw new BadRequestException('notification preference values must be boolean');
    }
  }
  return Object.freeze({
    meeting_reminders: object.meeting_reminders as boolean,
    transcript_ready: object.transcript_ready as boolean,
    action_items: object.action_items as boolean,
    desktop_link_events: object.desktop_link_events as boolean,
  });
}

@Controller('v1/workspaces/:organizationId/notification-preferences')
export class WorkspaceNotificationPreferencesController {
  public constructor(
    @Inject(TRUSTED_PRINCIPAL_RESOLVER)
    private readonly principalResolver: TrustedPrincipalResolver,
    @Inject(ORGANIZATION_MEMBERSHIP_RESOLVER)
    private readonly membershipResolver: OrganizationMembershipResolver,
    @Inject(WORKSPACE_NOTIFICATION_PREFERENCES_REPOSITORY)
    private readonly preferencesRepository: WorkspaceNotificationPreferencesRepository,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async getPreferences(
    @Param('organizationId') rawOrganizationId: string,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceNotificationPreferencesResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const context = await this.resolveContext(request, organizationId);
    try {
      return await loadWorkspaceNotificationPreferences(
        context,
        this.preferencesRepository,
      );
    } catch (error: unknown) {
      this.rethrowDomainError(error);
    }
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async putPreferences(
    @Param('organizationId') rawOrganizationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceNotificationPreferencesResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const preferences = parsePreferences(body);
    const context = await this.resolveContext(request, organizationId);
    try {
      return await saveWorkspaceNotificationPreferences(
        context,
        preferences,
        this.preferencesRepository,
      );
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
      throw new ServiceUnavailableException(
        'workspace notification preferences unavailable',
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
      throw new ForbiddenException('workspace notification preferences access denied');
    }
    if (
      error instanceof WorkspaceNotificationPreferencesPersistenceUnavailableError ||
      error instanceof WorkspaceNotificationPreferencesDataIntegrityError
    ) {
      throw new ServiceUnavailableException(
        'workspace notification preferences unavailable',
      );
    }
    throw error;
  }
}

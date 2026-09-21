import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
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
import {
  AuthorizationDeniedError,
  authorizeTenantAccess,
} from '../organizations/tenant-authorization.js';
import {
  DesktopLinkDeniedError,
  DesktopLinkService,
} from './desktop-link.service.js';
import { DesktopLinkPersistenceUnavailableError } from './runtime-desktop-link-record-store.js';

const DEVICE_LINK_PERMISSION = 'device.link';
const MAX_IDENTIFIER_LENGTH = 256;
const EXCHANGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RECORD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DesktopLinkIssueResponse {
  readonly schema_version: 1;
  readonly record_id: string;
  readonly exchange_token: string;
  readonly expires_at: string;
}

export interface DesktopLinkConsumeResponse {
  readonly schema_version: 1;
  readonly linked: true;
  readonly record_id: string;
  readonly organization_id: string;
  readonly device_id: string;
  readonly consumed_at: string;
}

export interface DesktopLinkStatusResponse {
  readonly schema_version: 1;
  readonly record_id: string;
  readonly organization_id: string;
  readonly device_id: string;
  readonly status: 'issued' | 'consumed' | 'revoked' | 'expired';
  readonly expires_at: string;
  readonly consumed_at: string | null;
}

export interface LinkedDesktopResponse {
  readonly schema_version: 1;
  readonly record_id: string;
  readonly device_id: string;
  readonly linked_at: string;
}

export interface LinkedDesktopInventoryResponse {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly devices: readonly LinkedDesktopResponse[];
  readonly has_more: boolean;
}

function requireClosedObject(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('request body must be an object');
  }
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!allowedKeys.includes(key)) {
      throw new BadRequestException('request body contains unsupported fields');
    }
  }
  return body;
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return normalized;
}

function parseIssueBody(body: unknown): { deviceId: string; ttlMs?: number } {
  const object = requireClosedObject(body, ['device_id', 'ttl_ms']);
  const deviceId = requireIdentifier(object.device_id, 'device id');
  if (object.ttl_ms === undefined) {
    return { deviceId };
  }
  if (!Number.isSafeInteger(object.ttl_ms)) {
    throw new BadRequestException('desktop link ttl is invalid');
  }
  return { deviceId, ttlMs: object.ttl_ms as number };
}

function parseConsumeBody(body: unknown): {
  deviceId: string;
  exchangeToken: string;
} {
  const object = requireClosedObject(body, ['device_id', 'exchange_token']);
  const deviceId = requireIdentifier(object.device_id, 'device id');
  if (
    typeof object.exchange_token !== 'string' ||
    !EXCHANGE_TOKEN_PATTERN.test(object.exchange_token)
  ) {
    throw new BadRequestException('desktop link exchange token is invalid');
  }
  return { deviceId, exchangeToken: object.exchange_token };
}

function requireOrganizationId(value: string): string {
  return requireIdentifier(value, 'organization id');
}

function requireRecordId(value: string): string {
  if (!RECORD_ID_PATTERN.test(value)) {
    throw new BadRequestException('desktop link record id is invalid');
  }
  return value;
}

@Controller('v1/organizations/:organizationId/desktop-links')
export class DesktopLinkController {
  public constructor(
    @Inject(TRUSTED_PRINCIPAL_RESOLVER)
    private readonly principalResolver: TrustedPrincipalResolver,
    @Inject(ORGANIZATION_MEMBERSHIP_RESOLVER)
    private readonly membershipResolver: OrganizationMembershipResolver,
    private readonly desktopLinkService: DesktopLinkService,
  ) {}

  @Get('linked')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async list(
    @Param('organizationId') rawOrganizationId: string,
    @Req() request: FastifyRequest,
  ): Promise<LinkedDesktopInventoryResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const { principal } = await this.resolveAuthorizedContext(
      request,
      organizationId,
    );

    try {
      const inventory = await this.desktopLinkService.listLinked(
        principal,
        organizationId,
      );
      return Object.freeze({
        schema_version: 1 as const,
        organization_id: organizationId,
        devices: Object.freeze(
          inventory.devices.map((device) =>
            Object.freeze({
              schema_version: 1 as const,
              record_id: device.recordId,
              device_id: device.deviceId,
              linked_at: device.linkedAt,
            }),
          ),
        ),
        has_more: inventory.hasMore,
      });
    } catch (error: unknown) {
      if (error instanceof DesktopLinkPersistenceUnavailableError) {
        throw new ServiceUnavailableException('desktop link persistence unavailable');
      }
      throw error;
    }
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async issue(
    @Param('organizationId') rawOrganizationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<DesktopLinkIssueResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const input = parseIssueBody(body);
    const { principal, authorization } = await this.resolveAuthorizedContext(
      request,
      organizationId,
    );
    void principal;

    try {
      const issued = await this.desktopLinkService.issue(
        authorization,
        input.deviceId,
        input.ttlMs,
      );
      return Object.freeze({
        schema_version: 1 as const,
        record_id: issued.recordId,
        exchange_token: issued.exchangeToken,
        expires_at: issued.expiresAt,
      });
    } catch (error: unknown) {
      if (error instanceof DesktopLinkPersistenceUnavailableError) {
        throw new ServiceUnavailableException('desktop link persistence unavailable');
      }
      if (error instanceof DesktopLinkDeniedError) {
        throw new BadRequestException('desktop link request is invalid');
      }
      throw error;
    }
  }

  @Get(':recordId/status')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async status(
    @Param('organizationId') rawOrganizationId: string,
    @Param('recordId') rawRecordId: string,
    @Req() request: FastifyRequest,
  ): Promise<DesktopLinkStatusResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const recordId = requireRecordId(rawRecordId);
    const { principal } = await this.resolveAuthorizedContext(
      request,
      organizationId,
    );

    try {
      const snapshot = await this.desktopLinkService.inspect(
        principal,
        organizationId,
        recordId,
      );
      return Object.freeze({
        schema_version: 1 as const,
        record_id: snapshot.recordId,
        organization_id: snapshot.organizationId,
        device_id: snapshot.deviceId,
        status: snapshot.status,
        expires_at: snapshot.expiresAt,
        consumed_at: snapshot.consumedAt,
      });
    } catch (error: unknown) {
      if (error instanceof DesktopLinkPersistenceUnavailableError) {
        throw new ServiceUnavailableException('desktop link persistence unavailable');
      }
      if (error instanceof DesktopLinkDeniedError) {
        throw new NotFoundException('desktop link unavailable');
      }
      throw error;
    }
  }

  @Post(':recordId/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async revoke(
    @Param('organizationId') rawOrganizationId: string,
    @Param('recordId') rawRecordId: string,
    @Req() request: FastifyRequest,
  ): Promise<DesktopLinkStatusResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const recordId = requireRecordId(rawRecordId);
    const { principal } = await this.resolveAuthorizedContext(
      request,
      organizationId,
    );

    try {
      const snapshot = await this.desktopLinkService.revoke(
        principal,
        organizationId,
        recordId,
      );
      return Object.freeze({
        schema_version: 1 as const,
        record_id: snapshot.recordId,
        organization_id: snapshot.organizationId,
        device_id: snapshot.deviceId,
        status: snapshot.status,
        expires_at: snapshot.expiresAt,
        consumed_at: snapshot.consumedAt,
      });
    } catch (error: unknown) {
      if (error instanceof DesktopLinkPersistenceUnavailableError) {
        throw new ServiceUnavailableException('desktop link persistence unavailable');
      }
      if (error instanceof DesktopLinkDeniedError) {
        throw new NotFoundException('desktop link unavailable');
      }
      throw error;
    }
  }

  @Post(':recordId/consume')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  public async consume(
    @Param('organizationId') rawOrganizationId: string,
    @Param('recordId') rawRecordId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<DesktopLinkConsumeResponse> {
    const organizationId = requireOrganizationId(rawOrganizationId);
    const recordId = requireRecordId(rawRecordId);
    const input = parseConsumeBody(body);
    const { principal } = await this.resolveAuthorizedContext(
      request,
      organizationId,
    );

    try {
      const binding = await this.desktopLinkService.consume(
        principal,
        organizationId,
        input.deviceId,
        recordId,
        input.exchangeToken,
      );
      return Object.freeze({
        schema_version: 1 as const,
        linked: true as const,
        record_id: binding.recordId,
        organization_id: binding.organizationId,
        device_id: binding.deviceId,
        consumed_at: binding.consumedAt,
      });
    } catch (error: unknown) {
      if (error instanceof DesktopLinkPersistenceUnavailableError) {
        throw new ServiceUnavailableException('desktop link persistence unavailable');
      }
      if (error instanceof DesktopLinkDeniedError) {
        throw new ForbiddenException('desktop link exchange denied');
      }
      throw error;
    }
  }

  private async resolveAuthorizedContext(
    request: FastifyRequest,
    organizationId: string,
  ) {
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
      const authorization = authorizeTenantAccess({
        principal,
        membership,
        resource: { organizationId },
        requiredPermission: DEVICE_LINK_PERMISSION,
      });
      return { principal, authorization };
    } catch (error: unknown) {
      if (error instanceof AuthorizationDeniedError) {
        throw new ForbiddenException('desktop link access denied');
      }
      throw error;
    }
  }
}

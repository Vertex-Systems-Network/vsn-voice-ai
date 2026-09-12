import {
  assertAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
} from '../identity/authenticated-principal.js';
import type {
  OrganizationMembership,
  TenantResource,
} from './organization-membership.js';

export interface AuthorizationContext {
  readonly schema_version: 1;
  readonly subject_id: string;
  readonly organization_id: string;
  readonly membership_id: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly session_id?: string;
}

export class AuthorizationDeniedError extends Error {
  public constructor(reason: string) {
    super(reason);
    this.name = 'AuthorizationDeniedError';
  }
}

export interface TenantAuthorizationRequest {
  readonly principal: AuthenticatedPrincipal | null | undefined;
  readonly membership: OrganizationMembership | null | undefined;
  readonly resource: TenantResource;
  readonly requiredPermission: string;
}

export function authorizeTenantAccess(
  request: TenantAuthorizationRequest,
): AuthorizationContext {
  try {
    assertAuthenticatedPrincipal(request.principal);
  } catch {
    throw new AuthorizationDeniedError('authenticated principal is required');
  }

  const membership = request.membership;
  if (membership === null || membership === undefined) {
    throw new AuthorizationDeniedError('organization membership is required');
  }
  if (membership.status !== 'active') {
    throw new AuthorizationDeniedError('organization membership is not active');
  }
  if (membership.subjectId !== request.principal.subjectId) {
    throw new AuthorizationDeniedError('membership subject does not match principal');
  }
  if (membership.organizationId !== request.resource.organizationId) {
    throw new AuthorizationDeniedError('resource belongs to another organization');
  }
  if (!membership.permissions.includes(request.requiredPermission)) {
    throw new AuthorizationDeniedError('required permission is missing');
  }

  const baseContext = {
    schema_version: 1 as const,
    subject_id: request.principal.subjectId,
    organization_id: membership.organizationId,
    membership_id: membership.membershipId,
    roles: Object.freeze([...membership.roles]),
    permissions: Object.freeze([...membership.permissions]),
  };

  return Object.freeze(
    request.principal.sessionId === undefined
      ? baseContext
      : {
          ...baseContext,
          session_id: request.principal.sessionId,
        },
  );
}

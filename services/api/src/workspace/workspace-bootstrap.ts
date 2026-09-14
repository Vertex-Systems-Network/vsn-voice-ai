import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type { OrganizationMembership } from '../organizations/organization-membership.js';
import {
  authorizeTenantAccess,
  type AuthorizationContext,
} from '../organizations/tenant-authorization.js';

export interface WorkspaceBootstrapRequest {
  readonly principal: AuthenticatedPrincipal | null | undefined;
  readonly membership: OrganizationMembership | null | undefined;
  readonly organizationId: string;
}

export interface WorkspaceAuthorizationSummary {
  readonly schema_version: 1;
  readonly subject_id: string;
  readonly organization_id: string;
  readonly membership_id: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface WorkspaceAreaState {
  readonly status: 'unloaded';
  readonly items: readonly never[];
}

export interface WorkspaceBootstrapResponse {
  readonly schema_version: 1;
  readonly authorization: WorkspaceAuthorizationSummary;
  readonly meetings: WorkspaceAreaState;
  readonly devices: WorkspaceAreaState;
  readonly team: WorkspaceAreaState;
  readonly settings: WorkspaceAreaState;
}

function unloadedArea(): WorkspaceAreaState {
  return Object.freeze({
    status: 'unloaded' as const,
    items: Object.freeze([]) as readonly never[],
  });
}

function toWorkspaceAuthorizationSummary(
  authorization: AuthorizationContext,
): WorkspaceAuthorizationSummary {
  return Object.freeze({
    schema_version: 1 as const,
    subject_id: authorization.subject_id,
    organization_id: authorization.organization_id,
    membership_id: authorization.membership_id,
    roles: Object.freeze([...authorization.roles]),
    permissions: Object.freeze([...authorization.permissions]),
  });
}

/**
 * Produces the minimum tenant-bound bootstrap payload needed by the current web
 * workspace. Internal authentication/session identifiers deliberately do not
 * cross this browser-facing boundary. Downstream resource stores must replace
 * individual unloaded areas only after their own authorization and persistence
 * contracts exist.
 */
export function createWorkspaceBootstrap(
  request: WorkspaceBootstrapRequest,
): WorkspaceBootstrapResponse {
  if (request.organizationId.trim().length === 0) {
    throw new TypeError('organizationId is required');
  }

  const authorization = authorizeTenantAccess({
    principal: request.principal,
    membership: request.membership,
    resource: { organizationId: request.organizationId },
    requiredPermission: 'conversation.read',
  });

  return Object.freeze({
    schema_version: 1 as const,
    authorization: toWorkspaceAuthorizationSummary(authorization),
    meetings: unloadedArea(),
    devices: unloadedArea(),
    team: unloadedArea(),
    settings: unloadedArea(),
  });
}

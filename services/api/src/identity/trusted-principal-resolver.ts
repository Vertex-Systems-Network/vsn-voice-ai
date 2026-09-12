import type { FastifyRequest } from 'fastify';

import type { AuthenticatedPrincipal } from './authenticated-principal.js';

export const TRUSTED_PRINCIPAL_RESOLVER = Symbol('TRUSTED_PRINCIPAL_RESOLVER');

/**
 * Transport boundary for identity-provider/session verification.
 *
 * Implementations must authenticate the request using a trusted server-side
 * mechanism before returning a principal. Domain controllers must not parse or
 * trust raw authorization/cookie headers directly.
 */
export interface TrustedPrincipalResolver {
  resolve(request: FastifyRequest): Promise<AuthenticatedPrincipal | null>;
}

/**
 * Safe default until an explicitly verified identity/session adapter is wired.
 */
export class RejectingTrustedPrincipalResolver implements TrustedPrincipalResolver {
  public async resolve(_request: FastifyRequest): Promise<null> {
    return null;
  }
}

import type { FastifyRequest } from 'fastify';

import {
  assertAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
} from './authenticated-principal.js';

export const TRUSTED_PRINCIPAL_RESOLVER = Symbol('TRUSTED_PRINCIPAL_RESOLVER');

export type TrustedPrincipalResolution =
  | { readonly status: 'authenticated'; readonly principal: AuthenticatedPrincipal }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'unavailable' };

export interface TrustedPrincipalResolver {
  resolve(request: FastifyRequest): Promise<AuthenticatedPrincipal | null>;
}

export async function resolveTrustedPrincipal(
  resolver: TrustedPrincipalResolver,
  request: FastifyRequest,
): Promise<TrustedPrincipalResolution> {
  try {
    const candidate: unknown = await resolver.resolve(request);
    if (candidate === null) {
      return Object.freeze({ status: 'unauthenticated' as const });
    }

    assertAuthenticatedPrincipal(candidate);
    const principal = Object.freeze(
      candidate.sessionId === undefined
        ? { subjectId: candidate.subjectId }
        : { subjectId: candidate.subjectId, sessionId: candidate.sessionId },
    );
    return Object.freeze({ status: 'authenticated' as const, principal });
  } catch {
    return Object.freeze({ status: 'unavailable' as const });
  }
}

export class RejectingTrustedPrincipalResolver implements TrustedPrincipalResolver {
  public async resolve(_request: FastifyRequest): Promise<null> {
    return null;
  }
}

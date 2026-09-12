export interface AuthenticatedPrincipal {
  readonly subjectId: string;
  readonly sessionId?: string;
}

export function assertAuthenticatedPrincipal(
  principal: AuthenticatedPrincipal | null | undefined,
): asserts principal is AuthenticatedPrincipal {
  if (principal === null || principal === undefined || principal.subjectId.trim().length === 0) {
    throw new Error('authenticated principal is required');
  }
}

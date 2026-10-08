export const MAX_AUTHENTICATED_PRINCIPAL_IDENTIFIER_LENGTH = 128;

export interface AuthenticatedPrincipal {
  readonly subjectId: string;
  readonly sessionId?: string;
}

function isCanonicalIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_AUTHENTICATED_PRINCIPAL_IDENTIFIER_LENGTH &&
    value.trim() === value
  );
}

export function assertAuthenticatedPrincipal(
  principal: unknown,
): asserts principal is AuthenticatedPrincipal {
  if (
    typeof principal !== 'object' ||
    principal === null ||
    Array.isArray(principal)
  ) {
    throw new Error('authenticated principal is invalid');
  }

  const candidate = principal as Readonly<Record<string, unknown>>;
  if (
    !isCanonicalIdentifier(candidate.subjectId) ||
    (candidate.sessionId !== undefined &&
      !isCanonicalIdentifier(candidate.sessionId))
  ) {
    throw new Error('authenticated principal is invalid');
  }
}

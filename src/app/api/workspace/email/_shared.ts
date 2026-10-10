import type { ManagerIssue } from '@/types/manager';

/**
 * Shared response mapping for the Email Studio routes. Mirrors the inbox and
 * content route conventions: structured `ServiceResult` failures map onto the
 * HTTP status implied by their error class, and validation failures are 400.
 */
export function studioFailure(error: ManagerIssue) {
  // A missing row is a 404, not a validation error — this matches the existing
  // clients and email_templates routes.
  if (/_NOT_FOUND$/.test(error.code)) {
    return { ok: false as const, status: 404, error };
  }
  const status =
    error.errorClass === 'permission'
      ? 403
      : error.errorClass === 'auth'
        ? 401
        : error.errorClass === 'validation'
          ? 400
          : error.errorClass === 'not_configured'
            ? 503
            : error.errorClass === 'unsupported'
              ? 422
              : error.errorClass === 'rate_limit'
                ? 429
                : error.errorClass === 'network'
                  ? 502
                  : 500;
  return { ok: false as const, status, error };
}

export function invalidStudioInput(message: string) {
  return {
    ok: false as const,
    status: 400,
    error: {
      code: 'INVALID_INPUT',
      message,
      severity: 'error' as const,
      retryable: false,
      errorClass: 'validation' as const,
    },
  };
}

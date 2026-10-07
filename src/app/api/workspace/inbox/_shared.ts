import type { ManagerIssue } from '@/types/manager';

export function inboxFailure(error: ManagerIssue) {
  const status = error.errorClass === 'permission'
    ? 403
    : error.errorClass === 'unsupported'
      ? 422
      : error.errorClass === 'validation'
        ? 400
        : error.errorClass === 'auth'
          ? 409
          : error.errorClass === 'rate_limit'
            ? 429
            : error.errorClass === 'network'
              ? 502
              : error.errorClass === 'not_configured'
                ? 503
                : 500;
  return { ok: false as const, status, error };
}

export function invalidInboxInput(message: string) {
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

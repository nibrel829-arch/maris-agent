import type { ManagerIssue } from '@/types/manager';

const STATUS_BY_CLASS: Record<string, number> = {
  permission: 403,
  validation: 400,
  auth: 401,
  not_configured: 503,
  unsupported: 422,
  rate_limit: 429,
  network: 502,
  server: 500,
  unknown: 500,
};

export function socialFailure(error: ManagerIssue) {
  if (error.code === 'SOCIAL_NOT_FOUND' || error.code === 'SOCIAL_STATE_INVALID') {
    return { ok: false as const, status: 404, error };
  }
  return { ok: false as const, status: STATUS_BY_CLASS[error.errorClass] ?? 500, error };
}

export function invalidInput(message: string) {
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

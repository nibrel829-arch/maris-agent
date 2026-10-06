import type { ErrorClass, ManagerIssue } from '@/types/manager';

/**
 * Every service and tool returns a discriminated result. Nothing in the
 * codebase returns a fabricated success (CEO spec §11, PDF #08 §14).
 */
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ManagerIssue };

export const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });

export const fail = <T = never>(
  code: string,
  message: string,
  options: { severity?: ManagerIssue['severity']; retryable?: boolean; errorClass?: ErrorClass } = {},
): ServiceResult<T> => ({
  ok: false,
  error: {
    code,
    message,
    severity: options.severity ?? 'error',
    retryable: options.retryable ?? false,
    errorClass: options.errorClass ?? 'unknown',
  },
});

export class ToolError extends Error {
  readonly issue: ManagerIssue;

  constructor(issue: ManagerIssue) {
    super(issue.message);
    this.name = 'ToolError';
    this.issue = issue;
  }
}

/**
 * Maps an unknown thrown value onto a structured, classified failure.
 * Internal detail is logged, never returned to the user (PDF #06 §11).
 */
export function classifyError(error: unknown): ManagerIssue {
  if (error instanceof ToolError) return error.issue;

  const message = error instanceof Error ? error.message : 'Unexpected error';

  if (/not configured|missing environment|SUPABASE_NOT_CONFIGURED/i.test(message)) {
    return {
      code: 'NOT_CONFIGURED',
      message: 'This capability is not configured for this environment.',
      severity: 'warning',
      retryable: false,
      errorClass: 'not_configured',
    };
  }
  if (/unsupported|not supported by the official/i.test(message)) {
    return {
      code: 'UNSUPPORTED',
      message,
      severity: 'warning',
      retryable: false,
      errorClass: 'unsupported',
    };
  }
  if (/permission|denied|forbidden/i.test(message)) {
    return {
      code: 'PERMISSION_DENIED',
      message: 'You do not have permission to perform this action.',
      severity: 'error',
      retryable: false,
      errorClass: 'permission',
    };
  }
  if (/rate limit|429|too many requests/i.test(message)) {
    return {
      code: 'RATE_LIMITED',
      message: 'The external platform is rate limiting this action. It can be retried safely.',
      severity: 'warning',
      retryable: true,
      errorClass: 'rate_limit',
    };
  }
  if (/timeout|network|ECONN|fetch failed/i.test(message)) {
    return {
      code: 'NETWORK_ERROR',
      message: 'A network error interrupted this action. It can be retried.',
      severity: 'error',
      retryable: true,
      errorClass: 'network',
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    severity: 'error',
    retryable: false,
    errorClass: 'server',
  };
}

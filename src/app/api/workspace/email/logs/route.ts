import { withApiContext } from '@/server/api/handler';
import { listEmailLogs } from '@/server/email/service';
import { emailLogListQuerySchema } from '@/server/email/validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/email/logs?search=&status=&limit=&offset=
 * Tenant-scoped outbound email record listing (Timestamps, status, provider id, errors visible).
 */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = emailLogListQuerySchema.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  const result = await listEmailLogs(actor, repo, parsed.data);
  if (!result.ok) {
    return {
      ok: false as const,
      status: result.error.errorClass === 'permission' ? 403 : 500,
      error: result.error,
    };
  }
  return { ok: true as const, data: result.data };
});

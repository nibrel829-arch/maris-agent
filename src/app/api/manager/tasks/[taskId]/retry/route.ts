import { withApiContext } from '@/server/api/handler';
import { retryManagerTask } from '@/server/manager/orchestrator';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/manager/tasks/:taskId/retry
 *
 * Re-runs blocked and failed steps. Succeeded steps keep their idempotency
 * key and are not executed again.
 */
export const POST = withApiContext(async ({ actor, repo }, _request, extra) => {
  const { taskId } = await (extra as RouteParams).params;
  try {
    const snapshot = await retryManagerTask({ taskId, actor, repo });
    return { ok: true as const, data: snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retry failed.';
    const missing = /not found/i.test(message);
    return {
      ok: false as const,
      status: missing ? 404 : 409,
      error: {
        code: missing ? 'NOT_FOUND' : 'RETRY_REFUSED',
        message,
        severity: 'warning' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }
});

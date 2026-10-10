import { withApiContext } from '@/server/api/handler';
import { requireAi } from '@/server/manager/route-guards';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

/** GET /api/manager/tasks/:taskId (ai:view, organization-scoped). */
export const GET = withApiContext(async ({ actor, repo }, _request, extra) => {
  const denied = requireAi(actor, 'view');
  if (denied) return denied;

  const { taskId } = await (extra as RouteParams).params;
  const task = await repo.tasks.get(taskId, actor.organizationId);
  if (!task) {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: 'NOT_FOUND',
        message: 'Task not found.',
        severity: 'warning' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }
  return { ok: true as const, data: task };
});

import { withApiContext } from '@/server/api/handler';
import { listTaskDeliverables } from '@/server/artifacts/service';
import { requireAi } from '@/server/manager/route-guards';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

/** GET /api/manager/tasks/:taskId/deliverables (ai:view, organization-scoped). */
export const GET = withApiContext(async ({ actor, repo }, _request, extra) => {
  const denied = requireAi(actor, 'view');
  if (denied) return denied;

  const { taskId } = await (extra as RouteParams).params;
  const task = await repo.tasks.get(taskId, actor.organizationId);
  if (!task) {
    return {
      ok: false as const,
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Task not found.', severity: 'warning' as const, retryable: false, errorClass: 'validation' as const },
    };
  }

  const listed = await listTaskDeliverables({ repo, actor, taskId });
  if (!listed.ok) {
    return {
      ok: false as const,
      status: listed.error.status,
      error: { code: listed.error.code, message: listed.error.message, severity: 'error' as const, retryable: false, errorClass: 'permission' as const },
    };
  }
  return { ok: true as const, data: listed.data };
});

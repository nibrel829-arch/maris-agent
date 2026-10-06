import { withApiContext } from '@/server/api/handler';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

/** GET /api/manager/tasks/:taskId */
export const GET = withApiContext(async ({ actor, repo }, _request, extra) => {
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

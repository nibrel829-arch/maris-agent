import { withApiContext } from '@/server/api/handler';
import { resumeManagerTask } from '@/server/manager/orchestrator';
import { writeAudit } from '@/server/manager/audit';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/manager/tasks/:taskId/resume
 *
 * Continues a task that stopped for approval. Approval state is read from the
 * database, not from the request body, so a client cannot self-approve.
 */
export const POST = withApiContext(async ({ actor, repo }, _request, extra) => {
  const { taskId } = await (extra as RouteParams).params;

  const snapshot = await resumeManagerTask({ taskId, actor, repo });

  await writeAudit(repo, actor, {
    action: 'manager.task.resumed',
    entityType: 'manager_task',
    entityId: taskId,
    metadata: { state: snapshot.state },
  });

  return { ok: true as const, data: snapshot };
});

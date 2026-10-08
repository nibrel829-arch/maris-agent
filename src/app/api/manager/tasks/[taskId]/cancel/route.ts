import { withApiContext } from '@/server/api/handler';
import { writeAudit } from '@/server/manager/audit';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/manager/tasks/:taskId/cancel
 *
 * Marks the task cancelled. An in-flight run stops between steps. Completed
 * external actions are not undone and are not reported as reversed.
 */
export const POST = withApiContext(async ({ actor, repo }, _request, extra) => {
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

  if (task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'WAITING_APPROVAL') {
    return {
      ok: false as const,
      status: 409,
      error: {
        code: 'NOT_CANCELLABLE',
        message:
          task.state === 'WAITING_APPROVAL'
            ? 'This task is waiting for an approval decision. Reject the approval instead of cancelling the saved work.'
            : 'This task already finished. Cancellation does not undo saved records or change its result.',
        severity: 'warning' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  if (task.state === 'CANCELLED') return { ok: true as const, data: task };

  const updated = await repo.tasks.update(taskId, actor.organizationId, {
    state: 'CANCELLED',
    error: 'Cancellation requested. Steps already saved were kept; remaining steps will not run.',
  });

  if (!updated || updated.state !== 'CANCELLED') {
    return {
      ok: false as const,
      status: 409,
      error: {
        code: 'NOT_CANCELLABLE',
        message: 'This task already finished. Cancellation does not undo saved records or change its result.',
        severity: 'warning' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  await writeAudit(repo, actor, {
    action: 'manager.task.cancelled',
    entityType: 'manager_task',
    entityId: taskId,
    metadata: { previousState: task.state },
  });

  return { ok: true as const, data: updated ?? task };
});

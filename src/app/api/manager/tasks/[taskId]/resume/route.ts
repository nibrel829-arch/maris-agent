import { z } from 'zod';
import type { z as Zod } from 'zod';
import { parseBody, withApiContext } from '@/server/api/handler';
import { ManagerConflictError, resumeManagerTask } from '@/server/manager/orchestrator';
import { writeAudit } from '@/server/manager/audit';
import { requireAi } from '@/server/manager/route-guards';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

const resumeSchema = z.object({
  /** Answers keyed by the field the Manager asked for, e.g. { "audience": "..." }. */
  answers: z
    .record(
      z.string().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Answer keys must be field names.'),
      z.string().trim().min(1, 'An answer cannot be empty.').max(2000),
    )
    .refine((value) => Object.keys(value).length <= 10, 'Answer at most 10 questions at once.')
    .optional(),
});

/**
 * POST /api/manager/tasks/:taskId/resume (ai:create).
 *
 * Continues a task that stopped for approval, input, or a fixed blocker.
 * Approval state is read from the database, never from the request body, so a
 * client cannot self-approve. Answers may only resolve questions the Manager
 * actually asked.
 */
export const POST = withApiContext(async ({ actor, repo }, request, extra) => {
  const denied = requireAi(actor, 'create');
  if (denied) return denied;

  const { taskId } = await (extra as RouteParams).params;

  // An empty body means "resume without answers" (approval resumes send none).
  const raw = await request.text();
  const body = raw.trim().length === 0
    ? ({ ok: true as const, data: {} })
    : await parseBody(new Request(request.url, { method: 'POST', body: raw, headers: { 'content-type': 'application/json' } }), resumeSchema as unknown as Zod.ZodTypeAny);
  if (!body.ok) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: body.message,
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  try {
    const answers = (body.data as { answers?: Record<string, string> }).answers;
    const snapshot = await resumeManagerTask({
      taskId,
      actor,
      repo,
      ...(answers ? { answers } : {}),
    });

    await writeAudit(repo, actor, {
      action: 'manager.task.resumed',
      entityType: 'manager_task',
      entityId: taskId,
      metadata: { state: snapshot.state, answeredFields: Object.keys(answers ?? {}) },
    });

    return { ok: true as const, data: snapshot };
  } catch (error) {
    if (error instanceof ManagerConflictError) {
      return {
        ok: false as const,
        status: 409,
        error: {
          code: 'CONFLICT',
          message: error.message,
          severity: 'warning' as const,
          retryable: false,
          errorClass: 'validation' as const,
        },
      };
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
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
    throw error;
  }
});

import { after } from 'next/server';
import { z } from 'zod';
import type { z as Zod } from 'zod';
import { parseBody, withApiContext } from '@/server/api/handler';
import { continueManagerTask, runManagerTask } from '@/server/manager/orchestrator';

const createSchema = z.object({
  request: z.string().min(3, 'Describe what you need in at least 3 characters.').max(4000),
});

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export const dynamic = 'force-dynamic';

const taskIdempotency = new Set<string>();

/** POST /api/manager/tasks — hand a request to the NIBREXO CEO / Manager. */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, createSchema as unknown as Zod.ZodTypeAny);
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

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
  const lockKey = idempotencyKey ? `${actor.organizationId}:${idempotencyKey}` : null;
  if (lockKey) {
    const remembered = await repo.memory.list(actor.organizationId, { limit: 200 });
    const hit = remembered.find(
      (row) => row.scope === 'manager.task.idempotency' && row.key === idempotencyKey,
    );
    const taskId =
      hit && typeof hit.value === 'object' && hit.value && 'taskId' in hit.value
        ? String((hit.value as { taskId: unknown }).taskId)
        : null;
    if (taskId) {
      const existing = await repo.tasks.get(taskId, actor.organizationId);
      if (existing) return { ok: true as const, data: existing, status: 200 };
    }
    if (taskIdempotency.has(lockKey)) {
      return {
        ok: false as const,
        status: 409,
        error: {
          code: 'DUPLICATE_EXECUTION',
          message: 'This request is already being executed. Poll the existing task instead of starting another.',
          severity: 'warning' as const,
          retryable: true,
          errorClass: 'validation' as const,
        },
      };
    }
    taskIdempotency.add(lockKey);
  }

  const wantsAsync = request.headers.get('x-nibrexo-async') === '1';
  try {
    const snapshot = await runManagerTask({
      request: body.data.request as string,
      actor,
      repo,
      deferExecution: wantsAsync,
    });

    if (idempotencyKey) {
      await repo.memory.insert({
        organization_id: actor.organizationId,
        scope: 'manager.task.idempotency',
        key: idempotencyKey,
        value: { taskId: snapshot.id },
        created_by: actor.userId,
      });
    }

    if (wantsAsync) {
      const work = continueManagerTask({ taskId: snapshot.id, actor, repo });
      after(() => work);
      void work.catch(() => undefined);
      return { ok: true as const, data: snapshot, status: 202 };
    }

    return { ok: true as const, data: snapshot, status: 201 };
  } finally {
    if (lockKey) taskIdempotency.delete(lockKey);
  }
});

/** GET /api/manager/tasks — recent Manager tasks for this organization. */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const url = new URL(request.url);
  const limit = listSchema.safeParse({ limit: url.searchParams.get('limit') ?? undefined });
  const tasks = await repo.tasks.list(actor.organizationId, {
    limit: limit.success ? limit.data.limit : 20,
  });
  return { ok: true as const, data: tasks };
});

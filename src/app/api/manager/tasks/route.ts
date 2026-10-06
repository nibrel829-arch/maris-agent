import { z } from 'zod';
import type { z as Zod } from 'zod';
import { parseBody, withApiContext } from '@/server/api/handler';
import { runManagerTask } from '@/server/manager/orchestrator';

const createSchema = z.object({
  request: z.string().min(3, 'Describe what you need in at least 3 characters.').max(4000),
});

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export const dynamic = 'force-dynamic';

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

  const snapshot = await runManagerTask({
    request: body.data.request as string,
    actor,
    repo,
  });

  return { ok: true as const, data: snapshot, status: 201 };
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

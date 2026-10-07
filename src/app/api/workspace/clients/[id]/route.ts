import { parseBody, withApiContext, type ApiContext } from '@/server/api/handler';
import { getClientDetail, updateClient } from '@/server/clients/service';
import type { ManagerIssue } from '@/types/manager';
import { clientIdSchema, updateClientSchema } from '@/server/clients/validation';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function routeId(extra: unknown): Promise<string | null> {
  const { id } = await (extra as RouteParams).params;
  return clientIdSchema.safeParse(id).success ? id : null;
}

function invalidId() {
  return {
    ok: false as const,
    status: 400,
    error: {
      code: 'INVALID_INPUT',
      message: 'Client id must be a valid UUID.',
      severity: 'error' as const,
      retryable: false,
      errorClass: 'validation' as const,
    },
  };
}

function serviceFailure(error: ManagerIssue) {
  if (error.code === 'CLIENT_NOT_FOUND') {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: 'CLIENT_NOT_FOUND',
        message: 'Client not found.',
        severity: 'warning' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }
  return {
    ok: false as const,
    status: error.errorClass === 'permission' ? 403 : 500,
    error: {
      code: String(error.code),
      message: error.message,
      severity: 'error' as const,
      retryable: false,
      errorClass: (error.errorClass === 'permission' ? 'permission' : 'server') as 'permission' | 'server',
    },
  };
}

/** GET /api/workspace/clients/:id — client with its activity timeline. */
export const GET = withApiContext(async ({ actor, repo }, _request, extra) => {
  const id = await routeId(extra);
  if (!id) return invalidId();

  const result = await getClientDetail(actor, repo, id);
  if (!result.ok) return serviceFailure(result.error);
  return { ok: true as const, data: result.data };
});

async function update(
  context: ApiContext,
  request: Request,
  extra: unknown,
) {
  const id = await routeId(extra);
  if (!id) return invalidId();

  const body = await parseBody(request, updateClientSchema);
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

  const result = await updateClient(context.actor, context.repo, id, body.data);
  if (!result.ok) return serviceFailure(result.error);
  return { ok: true as const, data: result.data };
}

/** PATCH /api/workspace/clients/:id — partial update (PUT accepted too). */
export const PATCH = withApiContext(update);
export const PUT = withApiContext(update);

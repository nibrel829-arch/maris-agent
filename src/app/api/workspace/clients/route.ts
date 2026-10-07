import { parseBody, withApiContext } from '@/server/api/handler';
import { createClient, listClients } from '@/server/clients/service';
import { clientListQuerySchema, createClientSchema } from '@/server/clients/validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/clients?search=&status=&limit=&offset=
 * Organization-scoped client directory with search, status filter and
 * pagination. Tenancy comes from the session actor, never from the query.
 */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = clientListQuerySchema.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  const result = await listClients(actor, repo, parsed.data);
  if (!result.ok) {
    return {
      ok: false as const,
      status: result.error.errorClass === 'permission' ? 403 : 500,
      error: result.error,
    };
  }
  return { ok: true as const, data: result.data };
});

/**
 * POST /api/workspace/clients
 * Creates a client in the actor's organization. `organization_id` is not
 * accepted from the body — Zod strips it and the service uses the actor.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, createClientSchema);
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

  const result = await createClient(actor, repo, body.data);
  if (!result.ok) {
    return {
      ok: false as const,
      status: result.error.errorClass === 'permission' ? 403 : 500,
      error: result.error,
    };
  }
  return { ok: true as const, data: result.data, status: 201 };
});

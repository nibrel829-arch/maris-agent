import { parseBody, withApiContext } from '@/server/api/handler';
import { addClientNote } from '@/server/clients/service';
import { addClientNoteSchema, clientIdSchema } from '@/server/clients/validation';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/workspace/clients/:id/notes — append a timeline note. */
export const POST = withApiContext(async ({ actor, repo }, request, extra) => {
  const { id } = await (extra as RouteParams).params;
  if (!clientIdSchema.safeParse(id).success) {
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

  const body = await parseBody(request, addClientNoteSchema);
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

  const result = await addClientNote(actor, repo, id, body.data);
  if (!result.ok) {
    if (result.error.code === 'CLIENT_NOT_FOUND') {
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
      status: result.error.errorClass === 'permission' ? 403 : 500,
      error: result.error,
    };
  }
  return { ok: true as const, data: result.data, status: 201 };
});

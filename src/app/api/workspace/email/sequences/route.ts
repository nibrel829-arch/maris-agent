import { parseBody, withApiContext } from '@/server/api/handler';
import { createSequence, listSequences } from '@/server/email/sequence-service';
import { createSequenceSchema, sequenceListQuerySchema } from '@/server/email/sequence-validation';

export const dynamic = 'force-dynamic';

export const GET = withApiContext(async ({ actor, repo }, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = sequenceListQuerySchema.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues.map((i) => i.message).join('; '),
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }
  const result = await listSequences(actor, repo, parsed.data);
  if (!result.ok) {
    return { ok: false as const, status: result.error.errorClass === 'permission' ? 403 : 500, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, createSequenceSchema);
  if (!body.ok) {
    return {
      ok: false as const,
      status: 400,
      error: { code: 'INVALID_INPUT', message: body.message, severity: 'error' as const, retryable: false, errorClass: 'validation' as const },
    };
  }
  const result = await createSequence(actor, repo, body.data);
  if (!result.ok) {
    const status = result.error.errorClass === 'permission' ? 403 : result.error.errorClass === 'validation' ? 400 : 500;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data, status: 201 };
});

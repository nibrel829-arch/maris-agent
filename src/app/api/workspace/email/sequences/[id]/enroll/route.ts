import { parseBody, withApiContext } from '@/server/api/handler';
import { enrollInSequence } from '@/server/email/sequence-service';
import { enrollSequenceSchema } from '@/server/email/sequence-validation';

export const dynamic = 'force-dynamic';

export const POST = withApiContext(async ({ actor, repo }, request, { params }: { params: Promise<{ id: string }> }) => {
  const body = await parseBody(request, enrollSequenceSchema);
  if (!body.ok) {
    return { ok: false as const, status: 400, error: { code: 'INVALID_INPUT', message: body.message, severity: 'error' as const, retryable: false, errorClass: 'validation' as const } };
  }
  const result = await enrollInSequence(actor, repo, (await params).id, body.data);
  if (!result.ok) {
    const status = result.error.errorClass === 'permission' ? 403 : result.error.code?.includes('NOT_FOUND') ? 404 : 400;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data, status: 201 };
});

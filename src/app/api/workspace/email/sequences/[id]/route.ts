import { parseBody, withApiContext } from '@/server/api/handler';
import { deleteSequence, getSequence, updateSequence } from '@/server/email/sequence-service';
import { updateSequenceSchema } from '@/server/email/sequence-validation';

export const dynamic = 'force-dynamic';

export const GET = withApiContext(async ({ actor, repo }, _request, { params }: { params: Promise<{ id: string }> }) => {
  const result = await getSequence(actor, repo, (await params).id);
  if (!result.ok) {
    const status = result.error.errorClass === 'permission' ? 403 : result.error.code === 'SEQUENCE_NOT_FOUND' ? 404 : 500;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

export const PATCH = withApiContext(async ({ actor, repo }, request, { params }: { params: Promise<{ id: string }> }) => {
  const body = await parseBody(request, updateSequenceSchema);
  if (!body.ok) {
    return { ok: false as const, status: 400, error: { code: 'INVALID_INPUT', message: body.message, severity: 'error' as const, retryable: false, errorClass: 'validation' as const } };
  }
  const result = await updateSequence(actor, repo, (await params).id, body.data);
  if (!result.ok) {
    const status = result.error.errorClass === 'permission' ? 403 : result.error.code === 'SEQUENCE_NOT_FOUND' ? 404 : 400;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

// Back-compat: PUT behaves like PATCH
export const PUT = PATCH;

export const DELETE = withApiContext(async ({ actor, repo }, _request, { params }: { params: Promise<{ id: string }> }) => {
  const result = await deleteSequence(actor, repo, (await params).id);
  if (!result.ok) {
    const status = result.error.errorClass === 'permission' ? 403 : result.error.code === 'SEQUENCE_NOT_FOUND' ? 404 : 500;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

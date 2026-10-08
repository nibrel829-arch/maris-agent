import { withApiContext } from '@/server/api/handler';
import { startSequence } from '@/server/email/sequence-service';

export const dynamic = 'force-dynamic';

export const POST = withApiContext(async ({ actor, repo }, _request, { params }: { params: Promise<{ id: string }> }) => {
  const result = await startSequence(actor, repo, (await params).id);
  if (!result.ok) {
    const status = result.error.errorClass === 'permission' ? 403 : result.error.code === 'SEQUENCE_NOT_FOUND' ? 404 : 400;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

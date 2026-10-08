import { withApiContext } from '@/server/api/handler';
import { listJobs } from '@/server/email/sequence-service';

export const dynamic = 'force-dynamic';

export const GET = withApiContext(async ({ actor, repo }, request, { params }: { params: Promise<{ id: string }> }) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
  const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined;
  const result = await listJobs(actor, repo, { sequenceId: (await params).id, status, limit, offset });
  if (!result.ok) {
    return { ok: false as const, status: result.error.errorClass === 'permission' ? 403 : 500, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

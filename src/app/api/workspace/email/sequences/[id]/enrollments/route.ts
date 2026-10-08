import { withApiContext } from '@/server/api/handler';
import { listEnrollments } from '@/server/email/sequence-service';
import { enrollmentListQuerySchema } from '@/server/email/sequence-validation';

export const dynamic = 'force-dynamic';

export const GET = withApiContext(async ({ actor, repo }, request, { params }: { params: Promise<{ id: string }> }) => {
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = enrollmentListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues.map((i) => i.message).join('; '), severity: 'error' as const, retryable: false, errorClass: 'validation' as const },
    };
  }
  const result = await listEnrollments(actor, repo, (await params).id, parsed.data);
  if (!result.ok) {
    const status = result.error.errorClass === 'permission' ? 403 : result.error.code === 'SEQUENCE_NOT_FOUND' ? 404 : 500;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

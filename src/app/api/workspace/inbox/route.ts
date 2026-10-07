import { withApiContext } from '@/server/api/handler';
import { listInbox } from '@/server/inbox/service';
import { inboxListQuerySchema } from '@/server/inbox/validation';
import { inboxFailure, invalidInboxInput } from './_shared';

export const dynamic = 'force-dynamic';

/** GET /api/workspace/inbox — tenant-scoped normalized conversations and capabilities. */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const parsed = inboxListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return invalidInboxInput(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const result = await listInbox(actor, repo, parsed.data);
  if (!result.ok) return inboxFailure(result.error);
  return { ok: true as const, data: result.data };
});

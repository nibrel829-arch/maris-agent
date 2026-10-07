import { withApiContext } from '@/server/api/handler';
import { listPinterestBoards } from '@/server/social/publish/service';
import { z } from 'zod';
import { invalidInput, socialFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ accountId: z.string().uuid('accountId must be a UUID.') });

/**
 * GET /api/workspace/social/publish/boards?accountId=
 * Lists the connected Pinterest account's boards for the publish target
 * picker (the board id is a required per-target option).
 */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ accountId: url.searchParams.get('accountId') });
  if (!parsed.success) {
    return invalidInput(parsed.error.issues[0]?.message ?? 'accountId is required.');
  }

  const result = await listPinterestBoards(actor, repo, parsed.data.accountId);
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: result.data };
});

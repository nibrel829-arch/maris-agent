import { withApiContext } from '@/server/api/handler';
import { disconnectAccount } from '@/server/social/service';
import { accountIdSchema } from '@/server/social/validation';
import { invalidInput, socialFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/workspace/social/accounts/[id]
 * Disconnects the account: provider revocation where verified (Google),
 * then the stored tokens are deleted and the account is marked disconnected.
 * Owner-only (social.delete in the permission matrix).
 */
export const DELETE = withApiContext(async ({ actor, repo }, _request, extra) => {
  const { id } = await (extra as RouteParams).params;
  if (!accountIdSchema.safeParse(id).success) {
    return invalidInput('Unknown account.');
  }

  const result = await disconnectAccount(actor, repo, id);
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: result.data };
});

import { withApiContext } from '@/server/api/handler';
import { refreshAccount } from '@/server/social/service';
import { accountIdSchema } from '@/server/social/validation';
import { invalidInput, socialFailure } from '../../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/workspace/social/accounts/[id]/refresh
 * Refreshes the account's tokens where the provider supports it. A dead or
 * ungranted refresh marks the account `reconnect_required` with a safe
 * message instead of failing silently.
 */
export const POST = withApiContext(async ({ actor, repo }, _request, extra) => {
  const { id } = await (extra as RouteParams).params;
  if (!accountIdSchema.safeParse(id).success) {
    return invalidInput('Unknown account.');
  }

  const result = await refreshAccount(actor, repo, id);
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: result.data };
});

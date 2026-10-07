import { withApiContext } from '@/server/api/handler';
import { listAccounts } from '@/server/social/service';
import { socialFailure } from '../_shared';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/social/accounts
 * Organization-scoped connected accounts with credential *metadata*
 * (scopes, expiry) plus per-platform connection support. Never contains
 * token material.
 */
export const GET = withApiContext(async ({ actor, repo }) => {
  const result = await listAccounts(actor, repo);
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: result.data };
});

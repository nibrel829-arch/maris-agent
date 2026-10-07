import { withApiContext } from '@/server/api/handler';
import { syncInboxAccount } from '@/server/inbox/service';
import { inboxFailure, invalidInboxInput } from '@/app/api/workspace/inbox/_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ accountId: string }>;
}

export const POST = withApiContext(async ({ actor, repo }, _request, extra) => {
  const { accountId } = await (extra as RouteParams).params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
    return invalidInboxInput('Account id must be a valid UUID.');
  }
  const result = await syncInboxAccount(actor, repo, accountId);
  if (!result.ok) return inboxFailure(result.error);
  return { ok: true as const, data: result.data };
});

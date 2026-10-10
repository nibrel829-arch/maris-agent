import { isExpired } from '@/server/manager/approval-policy';
import { withApiContext } from '@/server/api/handler';
import { requireAi } from '@/server/manager/route-guards';
import type { ApprovalRecord } from '@/types/domain';

export const dynamic = 'force-dynamic';

/** GET /api/manager/approvals — pending and recently decided approvals. */
export const GET = withApiContext(async ({ actor, repo }) => {
  const denied = requireAi(actor, 'view');
  if (denied) return denied;

  const approvals = await repo.approvals.list(actor.organizationId, { limit: 100 });
  const now = Date.now();

  const decorated: Array<ApprovalRecord & { expired: boolean }> = approvals.map((approval) => ({
    ...approval,
    expired: approval.status === 'pending' && isExpired(approval.expires_at, new Date(now)),
  }));

  return { ok: true as const, data: decorated };
});

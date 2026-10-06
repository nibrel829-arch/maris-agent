import { withApiContext } from '@/server/api/handler';
import { checkPermission } from '@/server/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/overview — dashboard data.
 * Only returns what the role is allowed to see (PDF #04 §4, PDF #07 §9).
 */
export const GET = withApiContext(async ({ actor, repo }) => {
  const canViewClients = checkPermission(actor, { module: 'clients', action: 'view' }).allowed;
  const canViewContent = checkPermission(actor, { module: 'content', action: 'view' }).allowed;
  const canViewEmail = checkPermission(actor, { module: 'email', action: 'view' }).allowed;

  const [counts, approvals, activity] = await Promise.all([
    repo.counts(actor.organizationId),
    repo.approvals.list(actor.organizationId, { limit: 50 }),
    repo.activityLogs.list(actor.organizationId, { limit: 20 }),
  ]);

  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');

  return {
    ok: true as const,
    data: {
      role: actor.role,
      counts: {
        ...(canViewClients ? { clients: counts.clients ?? 0, leads: counts.leads ?? 0 } : {}),
        ...(canViewContent ? { contentItems: counts.content_items ?? 0 } : {}),
        ...(canViewEmail ? { emailTemplates: counts.email_templates ?? 0, emailLogs: counts.email_logs ?? 0 } : {}),
      },
      pendingApprovals: pendingApprovals.map((approval) => ({
        id: approval.id,
        action: approval.action,
        risk: approval.risk,
        expires_at: approval.expires_at,
      })),
      recentActivity: activity.map((log) => ({
        id: log.id,
        action: log.action,
        createdAt: log.created_at,
      })),
    },
  };
});

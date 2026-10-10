import { withApiContext } from '@/server/api/handler';
import { toSummary } from '@/server/artifacts/service';
import { requireAi } from '@/server/manager/route-guards';

export const dynamic = 'force-dynamic';

/** GET /api/manager/deliverables — every stored deliverable in this organization (ai:view). */
export const GET = withApiContext(async ({ actor, repo }) => {
  const denied = requireAi(actor, 'view');
  if (denied) return denied;

  const rows = await repo.managerArtifacts.list(actor.organizationId, { limit: 200 });
  const data = rows
    .filter((row) => row.organization_id === actor.organizationId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map(toSummary);
  return { ok: true as const, data };
});

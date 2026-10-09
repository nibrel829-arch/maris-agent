import { withApiContext } from '@/server/api/handler';
import { deleteBrandSection } from '@/server/email/design-service';
import { studioFailure } from '../../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ sectionId: string }>;
}

/** DELETE /api/workspace/email/brand/sections/:sectionId — owner/admin only. */
export const DELETE = withApiContext(async ({ actor, repo }, _request, extra: RouteParams) => {
  const { sectionId } = await extra.params;
  const result = await deleteBrandSection(actor, repo, sectionId);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

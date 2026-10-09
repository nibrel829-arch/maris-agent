import { parseBody, withApiContext } from '@/server/api/handler';
import { deleteDesign, getDesign, updateDesign } from '@/server/email/design-service';
import { updateDesignSchema } from '@/server/email/design-validation';
import { invalidStudioInput, studioFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/workspace/email/designs/:id — one design, tenant-scoped. */
export const GET = withApiContext(async ({ actor, repo }, _request, extra: RouteParams) => {
  const { id } = await extra.params;
  const result = await getDesign(actor, repo, id);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

/**
 * PATCH /api/workspace/email/designs/:id
 * Autosave endpoint used by the studio: name/category/subject/status and the
 * whole design document. Requires email:edit.
 */
export const PATCH = withApiContext(async ({ actor, repo }, request, extra: RouteParams) => {
  const { id } = await extra.params;
  const body = await parseBody(request, updateDesignSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = await updateDesign(actor, repo, id, body.data);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

/** DELETE /api/workspace/email/designs/:id — requires email:delete. */
export const DELETE = withApiContext(async ({ actor, repo }, _request, extra: RouteParams) => {
  const { id } = await extra.params;
  const result = await deleteDesign(actor, repo, id);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

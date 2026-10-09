import { parseBody, withApiContext } from '@/server/api/handler';
import { resolveRequestOrigin } from '@/server/email/asset-url';
import { renderDesign } from '@/server/email/design-service';
import { renderDesignSchema } from '@/server/email/design-validation';
import { invalidStudioInput, studioFailure } from '../../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/workspace/email/designs/:id/render
 * Renders the stored design into responsive HTML, a plain-text alternative and
 * a validation report. Image URLs are the same signed Content Library URLs the
 * delivered email will request, so the preview is the artefact.
 */
export const POST = withApiContext(async ({ actor, repo }, request, extra: RouteParams) => {
  const { id } = await extra.params;
  const body = await parseBody(request, renderDesignSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = await renderDesign(actor, repo, id, {
    variables: body.data.variables,
    baseUrl: resolveRequestOrigin(request),
  });
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

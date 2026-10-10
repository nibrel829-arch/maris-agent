import { z } from 'zod';
import { parseBody, withApiContext } from '@/server/api/handler';
import { resolveRequestOrigin } from '@/server/email/asset-url';
import { renderDraftDesign } from '@/server/email/design-service';
import { invalidStudioInput, studioFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

const draftRenderSchema = z.object({
  /** The in-editor design document — not necessarily saved yet. */
  design: z.unknown(),
  variables: z.record(z.string(), z.string()).default({}),
  subject: z.string().trim().max(300).optional(),
});

/**
 * POST /api/workspace/email/designs/render-draft
 *
 * Renders the document currently open in the studio, before it is saved, so
 * the canvas always shows the real artefact. Nothing is persisted and nothing
 * is sent.
 */
export const POST = withApiContext(async ({ actor }, request) => {
  const body = await parseBody(request, draftRenderSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = renderDraftDesign(
    actor,
    {
      design: body.data.design,
      variables: body.data.variables,
      ...(body.data.subject ? { subject: body.data.subject } : {}),
    },
    { baseUrl: resolveRequestOrigin(request) },
  );
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

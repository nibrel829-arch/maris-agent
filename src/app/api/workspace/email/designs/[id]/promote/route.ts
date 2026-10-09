import { parseBody, withApiContext } from '@/server/api/handler';
import { resolveRequestOrigin } from '@/server/email/asset-url';
import { promoteDesignToTemplate } from '@/server/email/design-service';
import { promoteDesignSchema } from '@/server/email/design-validation';
import { invalidStudioInput, studioFailure } from '../../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/workspace/email/designs/:id/promote
 *
 * Writes the rendered design into the existing Phase 10 `email_templates`
 * table so the composer, sequences and campaigns can use it. The created
 * template keeps the draft/active lifecycle (draft by default): promotion
 * never activates a template for sending, and sending still requires
 * `email:send` plus the existing approval gates.
 */
export const POST = withApiContext(async ({ actor, repo }, request, extra: RouteParams) => {
  const { id } = await extra.params;
  const body = await parseBody(request, promoteDesignSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = await promoteDesignToTemplate(actor, repo, id, body.data, {
    baseUrl: resolveRequestOrigin(request),
  });
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data, status: 201 };
});

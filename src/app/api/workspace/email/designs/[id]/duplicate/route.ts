import { z } from 'zod';
import { parseBody, withApiContext } from '@/server/api/handler';
import { duplicateDesign } from '@/server/email/design-service';
import { invalidStudioInput, studioFailure } from '../../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const duplicateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

/**
 * POST /api/workspace/email/designs/:id/duplicate
 * Copies a design inside the same organization. The copy is always a draft and
 * never carries the source's promoted template link.
 */
export const POST = withApiContext(async ({ actor, repo }, request, extra: RouteParams) => {
  const { id } = await extra.params;
  const body = await parseBody(request, duplicateSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = await duplicateDesign(actor, repo, id, body.data.name);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data, status: 201 };
});

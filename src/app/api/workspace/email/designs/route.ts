import { parseBody, withApiContext } from '@/server/api/handler';
import { createDesign, listDesigns } from '@/server/email/design-service';
import { createDesignSchema, designListQuerySchema } from '@/server/email/design-validation';
import { invalidStudioInput, studioFailure } from '../_shared';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/email/designs?search=&status=&category=&source=&limit=&offset=
 * Tenant-scoped design directory (studio drafts, Manager drafts and starters
 * that were saved).
 */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = designListQuerySchema.safeParse(params);
  if (!parsed.success) return invalidStudioInput(parsed.error.issues.map((issue) => issue.message).join('; '));

  const result = await listDesigns(actor, repo, parsed.data);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

/**
 * POST /api/workspace/email/designs
 * Creates an organization-owned design. The block document is validated before
 * it is stored, so an invalid design never reaches the database.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, createDesignSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = await createDesign(actor, repo, body.data);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data, status: 201 };
});

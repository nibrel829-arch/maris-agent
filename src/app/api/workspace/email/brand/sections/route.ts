import { parseBody, withApiContext } from '@/server/api/handler';
import { saveBrandSection } from '@/server/email/design-service';
import { savedSectionSchema } from '@/server/email/design-validation';
import { invalidStudioInput, studioFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/email/brand/sections
 * Saves a block as a reusable organization section (owner/admin with
 * email:edit). Sections are stored on the brand profile and can be dropped
 * into any design.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, savedSectionSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = await saveBrandSection(actor, repo, body.data);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data, status: 201 };
});

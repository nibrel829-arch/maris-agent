import { parseBody, withApiContext } from '@/server/api/handler';
import { getBrandProfile, updateBrandProfile } from '@/server/email/design-service';
import { brandProfileSchema } from '@/server/email/design-validation';
import { invalidStudioInput, studioFailure } from '../_shared';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/email/brand
 * The organization brand + design system. Returns the stored profile, or the
 * documented defaults with `recordId: null` when none has been saved yet.
 */
export const GET = withApiContext(async ({ actor, repo }) => {
  const result = await getBrandProfile(actor, repo);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

/**
 * PUT /api/workspace/email/brand
 * Upserts the organization brand profile. Restricted to owner/admin with
 * email:edit, because the brand applies to every template in the organization.
 */
export const PUT = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, brandProfileSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = await updateBrandProfile(actor, repo, body.data);
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data };
});

import { parseBody, withApiContext } from '@/server/api/handler';
import { selectFacebookPage } from '@/server/social/service';
import { selectPageSchema } from '@/server/social/validation';
import { invalidInput, socialFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/social/facebook/select
 * Completes a Facebook connection by binding it to one of the Pages the
 * OAuth flow found. The state is single-use and organization-bound; only a
 * listed Page with content permission can be chosen.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, selectPageSchema);
  if (!body.ok) {
    return invalidInput(body.message);
  }

  const result = await selectFacebookPage(actor, repo, body.data);
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: result.data, status: 201 };
});

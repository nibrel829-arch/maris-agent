import { parseBody, withApiContext } from '@/server/api/handler';
import { getRequestMediaStorage } from '@/server/content/storage';
import { validatePublishTargets } from '@/server/social/publish/service';
import { validatePublishSchema } from '@/server/social/publish/validation';
import { invalidInput, socialFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/social/publish/validate
 * Dry-run of job creation: returns the same per-target errors and warnings
 * the composer needs, without writing jobs or calling providers.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, validatePublishSchema);
  if (!body.ok) {
    return invalidInput(body.message);
  }

  // Validation degrades gracefully when byte storage is unavailable: the
  // pre-flight then reports public-URL requirements as target issues.
  const storageResult = await getRequestMediaStorage();
  const result = await validatePublishTargets(
    actor,
    repo,
    storageResult.ok ? storageResult.data : null,
    body.data,
  );
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: result.data };
});

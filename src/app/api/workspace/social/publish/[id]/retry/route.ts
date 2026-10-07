import { withApiContext } from '@/server/api/handler';
import { getRequestMediaStorage } from '@/server/content/storage';
import { retryPublishJob } from '@/server/social/publish/service';
import { publishJobIdSchema } from '@/server/social/publish/validation';
import { invalidInput, socialFailure } from '../../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/workspace/social/publish/[id]/retry
 * Resumes a failed job. Jobs that already submitted to a provider resume at
 * verification (never resubmit); jobs that never submitted restart from
 * queued. Refused for non-retryable failures and exhausted attempts.
 */
export const POST = withApiContext(async ({ actor, repo }, _request, extra) => {
  const { id } = await (extra as RouteParams).params;
  const parsed = publishJobIdSchema.safeParse(id);
  if (!parsed.success) {
    return invalidInput('Job id must be a valid UUID.');
  }

  const storageResult = await getRequestMediaStorage();
  if (!storageResult.ok) return socialFailure(storageResult.error);

  const result = await retryPublishJob(actor, repo, storageResult.data, parsed.data);
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: { job: result.data } };
});

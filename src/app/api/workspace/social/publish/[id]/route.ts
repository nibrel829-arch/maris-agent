import { withApiContext } from '@/server/api/handler';
import { getPublishJob } from '@/server/social/publish/service';
import { publishJobIdSchema } from '@/server/social/publish/validation';
import { invalidInput, socialFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/workspace/social/publish/[id]
 * Returns a single publish job for this organization. Job rows carry no
 * secrets (tokens stay in the accounts store), so the full snapshot is safe
 * to show in the queue UI.
 */
export const GET = withApiContext(async ({ actor, repo }, _request, extra) => {
  const { id } = await (extra as RouteParams).params;
  const parsed = publishJobIdSchema.safeParse(id);
  if (!parsed.success) {
    return invalidInput('Job id must be a valid UUID.');
  }

  const result = await getPublishJob(actor, repo, parsed.data);
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: { job: result.data } };
});

import { parseBody, withApiContext } from '@/server/api/handler';
import { getRequestMediaStorage } from '@/server/content/storage';
import { createPublishJobs, listPublishJobs } from '@/server/social/publish/service';
import { createPublishSchema, publishListQuerySchema } from '@/server/social/publish/validation';
import { invalidInput, socialFailure } from '../_shared';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/social/publish
 * Creates one job per target (immediate jobs are driven inline; future and
 * provider-held schedules wait for the sweeper). 201 on creation, 200 when
 * every target deduplicated onto an existing active job.
 *
 * GET /api/workspace/social/publish?contentId=&accountId=&status=&limit=&offset=
 * Lists jobs in reverse-chronological order for this organization.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, createPublishSchema);
  if (!body.ok) {
    return invalidInput(body.message);
  }

  const storageResult = await getRequestMediaStorage();
  if (!storageResult.ok) return socialFailure(storageResult.error);

  const result = await createPublishJobs(actor, repo, storageResult.data, body.data);
  if (!result.ok) return socialFailure(result.error);
  const allDuplicates = result.data.jobs.every((entry) => entry.duplicate);
  return { ok: true as const, data: result.data, status: allDuplicates ? 200 : 201 };
});

export const GET = withApiContext(async ({ actor, repo }, request) => {
  const url = new URL(request.url);
  const parsed = publishListQuerySchema.safeParse({
    contentId: url.searchParams.get('contentId') ?? undefined,
    accountId: url.searchParams.get('accountId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return invalidInput(parsed.error.issues[0]?.message ?? 'Invalid query.');
  }

  const result = await listPublishJobs(actor, repo, parsed.data);
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: result.data };
});

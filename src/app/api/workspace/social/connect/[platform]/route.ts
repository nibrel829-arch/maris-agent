import { withApiContext } from '@/server/api/handler';
import { initiateConnect } from '@/server/social/service';
import { socialPlatformSchema } from '@/server/social/validation';
import { invalidInput, socialFailure } from '../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ platform: string }>;
}

/**
 * POST /api/workspace/social/connect/[platform]
 * Starts the OAuth flow: creates a single-use server-side state and returns
 * the provider authorization URL for the browser to visit. Unsupported or
 * unconfigured platforms fail here with an honest code — never with a
 * dead link.
 */
export const POST = withApiContext(async ({ actor, repo }, request, extra) => {
  const { platform } = await (extra as RouteParams).params;
  const parsed = socialPlatformSchema.safeParse(platform);
  if (!parsed.success) {
    return invalidInput('Unknown social platform.');
  }

  const result = await initiateConnect(actor, repo, parsed.data, {
    origin: new URL(request.url).origin,
  });
  if (!result.ok) return socialFailure(result.error);
  return { ok: true as const, data: result.data };
});

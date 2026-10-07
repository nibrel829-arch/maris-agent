import { NextResponse } from 'next/server';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { completeCallback } from '@/server/social/service';
import { callbackQuerySchema, socialPlatformSchema } from '@/server/social/validation';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ platform: string }>;
}

function redirectTo(origin: string, path: string): NextResponse {
  return NextResponse.redirect(`${origin}${path}`, { status: 302 });
}

/**
 * GET /api/workspace/social/callback/[platform]?code=&state=[&error=…]
 * Provider redirect target. This route hand-rolls its plumbing (instead of
 * `withApiContext`) because every outcome is a browser redirect, never JSON:
 * success lands on /social with a notice, Facebook multi-Page results land
 * on the Page picker, and failures land on /social with an error code the
 * page renders in plain language. The completing user must hold
 * social.create and must belong to the organization that initiated the flow.
 */
export async function GET(request: Request, extra: RouteParams): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  const { platform } = await extra.params;
  const parsedPlatform = socialPlatformSchema.safeParse(platform);
  if (!parsedPlatform.success) {
    return redirectTo(origin, '/social?error=platform');
  }

  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return redirectTo(origin, '/social?error=auth');
  }
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) {
    return redirectTo(origin, '/social?error=unavailable');
  }

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsedQuery = callbackQuerySchema.safeParse(params);
  if (!parsedQuery.success) {
    return redirectTo(origin, '/social?error=invalid');
  }

  try {
    const result = await completeCallback(
      actorResult.data,
      repoResult.data,
      parsedPlatform.data,
      parsedQuery.data,
    );
    if (!result.ok) {
      const code = result.error.code;
      if (code === 'SOCIAL_USER_DENIED') return redirectTo(origin, '/social?error=cancelled');
      if (code === 'SOCIAL_STATE_INVALID') return redirectTo(origin, '/social?error=expired');
      if (code === 'SOCIAL_UNSUPPORTED') return redirectTo(origin, '/social?error=unsupported');
      if (code === 'SOCIAL_NOT_CONFIGURED') return redirectTo(origin, '/social?error=not_configured');
      if (code === 'SOCIAL_PERMISSION_DENIED') return redirectTo(origin, '/social?error=forbidden');
      if (code === 'SOCIAL_FACEBOOK_NO_PAGE') return redirectTo(origin, '/social?error=no_page');
      return redirectTo(origin, '/social?error=failed');
    }

    if (result.data.status === 'needs_selection') {
      return redirectTo(
        origin,
        `/social/facebook/select?state=${encodeURIComponent(result.data.stateToken)}`,
      );
    }
    return redirectTo(origin, `/social?connected=${parsedPlatform.data}`);
  } catch {
    return redirectTo(origin, '/social?error=failed');
  }
}

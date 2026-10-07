/**
 * Instagram publisher (Phase 8).
 *
 * Verified against the official Content Publishing guide (updated Jun 30,
 * 2026) for **Instagram Login (Business Login)** — our token type:
 *  - Host: graph.instagram.com; permissions instagram_business_basic +
 *    instagram_business_content_publish (exactly our connect-time scopes).
 *  - Flow: `POST /{IG_ID}/media` (image_url [+ caption], or media_type
 *    REELS|VIDEO|STORIES + video_url + caption + share_to_feed) -> container
 *    id; `GET /{container}?fields=status_code` until FINISHED (values:
 *    IN_PROGRESS/FINISHED/ERROR/EXPIRED/PUBLISHED); `POST
 *    /{IG_ID}/media_publish` {creation_id} -> media id.
 *  - Media MUST be on a public server (Meta cURLs it). Resumable upload is
 *    Facebook-Login-only, so URL publishing is the only path for us.
 *  - JPEG is the only supported image format.
 *  - 100 API-published posts per rolling 24h (content_publishing_limit).
 *  - No provider scheduling: future posts are held Nibrexo-side.
 *  - Carousels need multiple media; our items carry one — unsupported.
 *
 * v1 scope: single-image posts + REELS video. Stories use the same container
 * shape but were not exercised against the official reference beyond the
 * media_type enum, so they stay unsupported until verified end to end.
 */

import {
  parseProviderJson,
  ProviderError,
  stringField,
} from '@/server/social/providers';
import {
  pollRound,
  stepContinue,
  stepFailed,
  stepPublished,
  stepUnknown,
  stepUnsupported,
  type PublisherAdapter,
  type PublishStepContext,
  type PublishStepOutcome,
  type PublishSupport,
  type PublishSupportInput,
} from './types';

/** Meta platform version (matches Phase 7 verification, Jun 2026). */
const GRAPH_VERSION = 'v26.0';
const API = `https://graph.instagram.com/${GRAPH_VERSION}`;
const POLL_INTERVAL_SECONDS = 300;
const MAX_POLLS = 6;

export const instagramPublisher: PublisherAdapter = {
  platform: 'instagram',
  label: 'Instagram',

  checkSupport(input: PublishSupportInput): PublishSupport {
    if (!input.media) {
      return { ok: false, reason: 'Instagram publishing needs an image or a video.' };
    }
    if (input.media.kind === 'image' && input.media.mime.toLowerCase() !== 'image/jpeg') {
      return {
        ok: false,
        reason: `Instagram image posts accept JPEG only; got ${input.media.mime}.`,
      };
    }
    return { ok: true };
  },

  mediaStrategy(kind: 'image' | 'video' | null): 'bytes' | 'public-url' | 'none' {
    return kind ? 'public-url' : 'none';
  },

  async executeStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
    try {
      return await runStep(ctx);
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.code === 'INVALID_GRANT') {
          return stepFailed(`Instagram: ${error.message}`, false, true);
        }
        if (error.code === 'RATE_LIMITED' || error.retryable) {
          return stepFailed(`Instagram: ${error.message}`, true);
        }
        return stepFailed(`Instagram: ${error.message}`, false);
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      return stepFailed(`Instagram: provider request failed (${detail.slice(0, 160)}).`, true);
    }
  },
};

async function runStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
  const media = ctx.media;
  if (!media) {
    return stepUnsupported('Instagram publishing needs an image or a video.');
  }
  if (!media.publicUrl) {
    return stepUnsupported(
      'Instagram fetches media from a public URL, which needs the Supabase backend (signed media URL).',
    );
  }
  if (media.kind === 'image' && media.mime.toLowerCase() !== 'image/jpeg') {
    return stepUnsupported(`Instagram image posts accept JPEG only; got ${media.mime}.`);
  }
  const tokenQuery = `access_token=${encodeURIComponent(ctx.accessToken)}`;

  // Step 1 — create the container.
  if (ctx.state.step === undefined) {
    const params: Record<string, string> = {};
    if (media.kind === 'image') {
      params.image_url = media.publicUrl;
    } else {
      params.media_type = 'REELS';
      params.video_url = media.publicUrl;
      params.share_to_feed = 'true';
    }
    if (ctx.text.trim()) params.caption = ctx.text.trim();
    const response = await ctx.http(
      `${API}/${encodeURIComponent(ctx.accountExternalId)}/media?${tokenQuery}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      },
    );
    const payload = (await parseProviderJson(response, { platform: 'Instagram' })) as Record<string, unknown>;
    const containerId = stringField(payload, 'id');
    if (!containerId) {
      return stepFailed('Instagram did not return a media container.', true);
    }
    return stepContinue(
      { ...ctx.state, step: 'poll', ref: containerId, pollRound: 0 },
      media.kind === 'image' ? 0 : POLL_INTERVAL_SECONDS,
      'Container created; waiting on Instagram processing.',
    );
  }

  // Step 2 — poll the container, then publish once FINISHED.
  if (ctx.state.step === 'poll' && ctx.state.ref) {
    const containerId = String(ctx.state.ref);
    const round = pollRound(ctx.state);
    const response = await ctx.http(
      `${API}/${encodeURIComponent(containerId)}?fields=status_code&${tokenQuery}`,
      { method: 'GET' },
    );
    const payload = (await parseProviderJson(response, { platform: 'Instagram' })) as Record<string, unknown>;
    const code = stringField(payload, 'status_code');
    if (code === 'ERROR' || code === 'EXPIRED') {
      return stepFailed(
        code === 'ERROR'
          ? 'Instagram failed to process the media (unsupported file, aspect ratio or duration for this format).'
          : 'Instagram expired the media container before publishing.',
        false,
      );
    }
    if (code !== 'FINISHED') {
      if (round + 1 >= MAX_POLLS) {
        return stepUnknown(
          'Instagram is still processing the media after repeated polls. Check Instagram before republishing.',
        );
      }
      return stepContinue(
        { ...ctx.state, pollRound: round + 1 },
        POLL_INTERVAL_SECONDS,
        `Instagram processing (${code ?? 'unknown'}, poll ${round + 1}/${MAX_POLLS}).`,
      );
    }
    const publishResponse = await ctx.http(
      `${API}/${encodeURIComponent(ctx.accountExternalId)}/media_publish?${tokenQuery}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: containerId }),
      },
    );
    const published = (await parseProviderJson(publishResponse, { platform: 'Instagram' })) as Record<string, unknown>;
    const mediaId = stringField(published, 'id');
    if (!mediaId) {
      return stepFailed('Instagram accepted the publish but returned no media id.', false);
    }
    // Step 3 — read-back verification.
    try {
      const readResponse = await ctx.http(
        `${API}/${encodeURIComponent(mediaId)}?fields=id,media_type,timestamp&${tokenQuery}`,
        { method: 'GET' },
      );
      const read = (await parseProviderJson(readResponse, { platform: 'Instagram' })) as Record<string, unknown>;
      if (stringField(read, 'id') === mediaId) {
        return stepPublished('read_back', mediaId, mediaId, 'Verified: media read back from Instagram.');
      }
      return stepUnknown(`Instagram media ${mediaId} published but reads back differently. Check Instagram before republishing.`);
    } catch {
      return stepUnknown(`Instagram media ${mediaId} was published but could not be read back. Check Instagram before republishing.`);
    }
  }

  return stepFailed('Instagram publish state is corrupted; start a new publish.', false);
}

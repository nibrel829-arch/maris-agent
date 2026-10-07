/**
 * Facebook publisher (Phase 8).
 *
 * Verified (Oct 2026 — official Pages API reference + corroborated guides):
 *  - Text/link: `POST /{page-id}/feed` {message, link} (official: params
 *    message/link/picture/published). Pages only — profile posting removed.
 *  - Photo: `POST /{page-id}/photos` {url, caption}. Verified formats for
 *    the url path: JPEG/PNG/GIF (+BMP/TIFF, which our library never holds).
 *  - Video: `POST /{page-id}/videos` {file_url, description}.
 *  - Native scheduling: published=false + scheduled_publish_time (Unix).
 *    Feed/photos: 10 minutes to 30 days (conservative verified window — one
 *    source claims 75 days for feed; we enforce 30 and hold longer waits
 *    Nibrexo-side). Videos use the same 30-day window here.
 *  - Verify: `GET /{post-id}?fields=id,is_published,created_time` (needs
 *    pages_read_engagement — the scope corrected in Phase 8).
 *  - Provider cancel: `DELETE /{post-id}` (pages_manage_posts covers
 *    create/edit/delete) removes an unpublished scheduled post.
 *  - Scopes: pages_show_list, pages_read_engagement, pages_manage_posts
 *    (+ pages_manage_metadata, connect-time).
 *  - Reels (/video_reels three-phase upload) and Stories are documented but
 *    not implemented: unsupported with reasons.
 *
 * Media strategy: URL-based (signed URLs on the Supabase backend).
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
  stepScheduledProvider,
  stepUnknown,
  stepUnsupported,
  type PublisherAdapter,
  type PublishStepContext,
  type PublishStepOutcome,
  type PublishSupport,
  type PublishSupportInput,
} from './types';
import { FACEBOOK_GRAPH_VERSION } from '@/server/social/providers/facebook';

const API = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif']);
const MIN_SCHEDULE_SECONDS = 10 * 60;
const MAX_SCHEDULE_SECONDS = 30 * 24 * 60 * 60;
const VERIFY_ROUNDS = 3;
const VERIFY_INTERVAL_SECONDS = 300;

function tokenQuery(accessToken: string): string {
  return `access_token=${encodeURIComponent(accessToken)}`;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export const facebookPublisher: PublisherAdapter = {
  platform: 'facebook',
  label: 'Facebook',

  checkSupport(input: PublishSupportInput): PublishSupport {
    const hasText = input.text.trim().length > 0;
    const hasLink = !!input.linkUrl && isAbsoluteHttpUrl(input.linkUrl);
    if (!hasText && !hasLink && !input.media) {
      return { ok: false, reason: 'Facebook posts need text, a link, or media.' };
    }
    if (input.media?.kind === 'image' && !IMAGE_MIMES.has(input.media.mime.toLowerCase())) {
      return {
        ok: false,
        reason: `Facebook photo posts accept JPEG, PNG or GIF; got ${input.media.mime}.`,
      };
    }
    if (input.scheduled) {
      const deltaSeconds = (Date.parse(input.runAt) - input.now.getTime()) / 1000;
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < MIN_SCHEDULE_SECONDS) {
        return {
          ok: false,
          reason: 'Facebook provider scheduling needs at least 10 minutes lead time; nearer posts publish immediately at the scheduled time.',
        };
      }
      if (deltaSeconds > MAX_SCHEDULE_SECONDS) {
        return {
          ok: false,
          reason: 'Facebook provider scheduling covers up to 30 days ahead; later posts are held and published at the scheduled time.',
        };
      }
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
          return stepFailed(`Facebook: ${error.message}`, false, true);
        }
        if (error.code === 'RATE_LIMITED' || error.retryable) {
          return stepFailed(`Facebook: ${error.message}`, true);
        }
        return stepFailed(`Facebook: ${error.message}`, false);
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      return stepFailed(`Facebook: provider request failed (${detail.slice(0, 160)}).`, true);
    }
  },

  async cancelRemote(ctx: PublishStepContext): Promise<{ cancelled: boolean; reason: string }> {
    // The executor injects the job's provider_ref into state.postId when the
    // adapter did not persist one, so postId is always the cancel target.
    const ref = ctx.state.postId;
    if (typeof ref !== 'string' || !ref) {
      return { cancelled: false, reason: 'No provider post to cancel.' };
    }
    try {
      const response = await ctx.http(
        `${API}/${encodeURIComponent(ref)}?${tokenQuery(ctx.accessToken)}`,
        // ProviderHttp has no DELETE: Meta honours method=delete as a POST
        // parameter (long-standing Graph API behaviour).
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'delete' }),
        },
      );
      const payload = (await parseProviderJson(response, { platform: 'Facebook' })) as Record<string, unknown>;
      if (payload.success === true) {
        return { cancelled: true, reason: 'Scheduled post deleted at Facebook.' };
      }
      return { cancelled: false, reason: 'Facebook did not confirm the deletion.' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      return { cancelled: false, reason: `Facebook deletion failed (${detail.slice(0, 160)}).` };
    }
  },
};

async function runStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
  const pageId = ctx.accountExternalId;
  const query = tokenQuery(ctx.accessToken);

  // Submit step.
  if (ctx.state.step === undefined) {
    const scheduleParams: Record<string, string | number | boolean> = {};
    if (ctx.scheduled) {
      const deltaSeconds = (Date.parse(ctx.runAt) - ctx.now.getTime()) / 1000;
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < MIN_SCHEDULE_SECONDS || deltaSeconds > MAX_SCHEDULE_SECONDS) {
        return stepFailed('Facebook schedule is outside the 10-minute to 30-day provider window.', false);
      }
      scheduleParams.published = false;
      scheduleParams.scheduled_publish_time = Math.floor(Date.parse(ctx.runAt) / 1000);
    }

    let edge: string;
    let params: Record<string, string | number | boolean>;
    if (ctx.media?.kind === 'image') {
      if (!IMAGE_MIMES.has(ctx.media.mime.toLowerCase())) {
        return stepUnsupported(`Facebook photo posts accept JPEG, PNG or GIF; got ${ctx.media.mime}.`);
      }
      if (!ctx.media.publicUrl) {
        return stepUnsupported('Facebook photo posts fetch the image from a public URL, which needs the Supabase backend.');
      }
      edge = 'photos';
      params = { url: ctx.media.publicUrl, ...(ctx.text.trim() ? { caption: ctx.text.trim() } : {}), ...scheduleParams };
    } else if (ctx.media?.kind === 'video') {
      if (!ctx.media.publicUrl) {
        return stepUnsupported('Facebook video posts fetch the video from a public URL, which needs the Supabase backend.');
      }
      edge = 'videos';
      params = {
        file_url: ctx.media.publicUrl,
        ...(ctx.text.trim() ? { description: ctx.text.trim() } : {}),
        ...scheduleParams,
      };
    } else {
      const hasText = ctx.text.trim().length > 0;
      const link = ctx.linkUrl && isAbsoluteHttpUrl(ctx.linkUrl) ? ctx.linkUrl : null;
      if (!hasText && !link) {
        return stepFailed('Facebook posts need text, a link, or media.', false);
      }
      edge = 'feed';
      params = { ...(hasText ? { message: ctx.text.trim() } : {}), ...(link ? { link } : {}), ...scheduleParams };
    }

    const response = await ctx.http(`${API}/${encodeURIComponent(pageId)}/${edge}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const payload = (await parseProviderJson(response, { platform: 'Facebook' })) as Record<string, unknown>;
    const id = stringField(payload, 'id');
    if (!id) {
      return stepFailed('Facebook accepted the post but returned no id.', false);
    }
    const postId = stringField(payload, 'post_id') ?? id;
    if (ctx.scheduled) {
      const verifyAfter = new Date(Date.parse(ctx.runAt) + 10 * 60 * 1000).toISOString();
      // The executor persists postId into the provider state (see service).
      return stepScheduledProvider(id, verifyAfter, postId, 'Post scheduled natively at Facebook.');
    }
    return stepContinue({ ...ctx.state, step: 'verify', ref: id, postId, pollRound: 0 }, 0, 'Post submitted; verifying.');
  }

  // Verify step (immediate posts and late provider-schedule checks).
  if ((ctx.state.step === 'verify' || ctx.state.step === 'scheduled_verify') && ctx.state.ref) {
    const round = pollRound(ctx.state);
    const ref = String(ctx.state.postId ?? ctx.state.ref);
    try {
      const response = await ctx.http(
        `${API}/${encodeURIComponent(ref)}?fields=id,is_published,created_time&${query}`,
        { method: 'GET' },
      );
      const node = (await parseProviderJson(response, { platform: 'Facebook' })) as Record<string, unknown>;
      if (!stringField(node, 'id')) {
        return stepUnknown(`Facebook post ${ref} was submitted but reads back empty. Check the Page before republishing.`);
      }
      const isPublished = node.is_published;
      if (ctx.state.step === 'scheduled_verify' && isPublished === false) {
        if (round + 1 >= VERIFY_ROUNDS) {
          return stepUnknown(`Facebook still shows post ${ref} as unpublished past its scheduled time. Check the Page.`);
        }
        return stepContinue({ ...ctx.state, pollRound: round + 1 }, VERIFY_INTERVAL_SECONDS, 'Scheduled post not live yet; re-checking.');
      }
      return stepPublished(
        'read_back',
        ref,
        String(ctx.state.ref),
        ctx.state.step === 'scheduled_verify'
          ? 'Verified: scheduled post is live on the Page.'
          : 'Verified: post read back from the Page.',
      );
    } catch {
      if (round + 1 >= VERIFY_ROUNDS) {
        return stepUnknown(`Facebook post ${ref} was submitted but could not be read back. Check the Page before republishing.`);
      }
      return stepContinue({ ...ctx.state, pollRound: round + 1 }, VERIFY_INTERVAL_SECONDS, 'Read-back failed; retrying.');
    }
  }

  return stepFailed('Facebook publish state is corrupted; start a new publish.', false);
}

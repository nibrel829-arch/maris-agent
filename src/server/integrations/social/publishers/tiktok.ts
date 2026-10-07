/**
 * TikTok publisher (Phase 8).
 *
 * Verified against the official Content Posting API docs (Oct 2026):
 *  - Direct Post video: `POST /v2/post/publish/video/init/` with
 *    FILE_UPLOAD (video_size/chunk_size/total_chunk_count -> upload_url,
 *    chunk PUT with Content-Range) or PULL_FROM_URL. Returns publish_id.
 *  - Direct Post photos: `POST /v2/post/publish/content/init/` with
 *    post_mode DIRECT_POST, media_type PHOTO, PULL_FROM_URL only.
 *  - Capabilities: `POST /v2/post/publish/creator_info/query/` returns
 *    privacy_level_options, interaction flags and max_video_post_duration_sec.
 *    The requested privacy_level MUST be one of the returned options.
 *  - Verification: `POST /v2/post/publish/status/fetch/` with publish_id ->
 *    PROCESSING_UPLOAD / PROCESSING_DOWNLOAD / PUBLISH_COMPLETE / FAILED
 *    (+ fail_reason, publicaly_available_post_id when public + moderated).
 *  - Scopes: video.publish (direct post), video.upload (drafts). Both are
 *    requested at connect time.
 *  - No provider scheduling: future posts are held Nibrexo-side.
 *  - Unaudited clients post private-only; per-creator daily caps apply.
 *    Those are provider behaviours we surface, not bypass.
 *
 * Media strategy: video via FILE_UPLOAD bytes (works on every backend);
 * photos via PULL_FROM_URL (needs a public URL — Supabase signed URL).
 */

import {
  parseProviderJson,
  ProviderError,
  stringField,
  type ProviderHttp,
} from '@/server/social/providers';
import type { PublishProviderState } from '@/types/domain';
import {
  optionString,
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

const API = 'https://open.tiktokapis.com';
const CHUNK_SIZE = 10 * 1024 * 1024;
const POLL_INTERVAL_SECONDS = 300;
const MAX_POLLS = 12;

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
  };
}

function privacyOptions(state: PublishProviderState): string[] {
  const raw = state.privacyOptions;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

async function queryCreatorInfo(
  http: ProviderHttp,
  accessToken: string,
): Promise<{ privacyOptions: string[]; maxDurationSec: number | null }> {
  const response = await http(`${API}/v2/post/publish/creator_info/query/`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: '{}',
  });
  const payload = (await parseProviderJson(response, { platform: 'TikTok' })) as Record<string, unknown>;
  const data = (payload.data as Record<string, unknown> | undefined) ?? {};
  const options = Array.isArray(data.privacy_level_options)
    ? (data.privacy_level_options as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const maxDuration = typeof data.max_video_post_duration_sec === 'number' ? data.max_video_post_duration_sec : null;
  return { privacyOptions: options, maxDurationSec: maxDuration };
}

export const tiktokPublisher: PublisherAdapter = {
  platform: 'tiktok',
  label: 'TikTok',

  checkSupport(input: PublishSupportInput): PublishSupport {
    if (!input.media) {
      return { ok: false, reason: 'TikTok publishing needs a video or a photo; text-only posts are not supported.' };
    }
    if (!input.text.trim()) {
      return { ok: false, reason: 'TikTok posts need a title/caption.' };
    }
    return { ok: true };
  },

  mediaStrategy(kind: 'image' | 'video' | null): 'bytes' | 'public-url' | 'none' {
    if (kind === 'video') return 'bytes';
    if (kind === 'image') return 'public-url';
    return 'none';
  },

  async executeStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
    try {
      return await runStep(ctx);
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.code === 'INVALID_GRANT') {
          return stepFailed(`TikTok: ${error.message}`, false, true);
        }
        if (error.code === 'RATE_LIMITED' || error.retryable) {
          return stepFailed(`TikTok: ${error.message}`, true);
        }
        return stepFailed(`TikTok: ${error.message}`, false);
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      return stepFailed(`TikTok: provider request failed (${detail.slice(0, 160)}).`, true);
    }
  },
};

async function runStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
  const media = ctx.media;
  if (!media) {
    return stepUnsupported('TikTok publishing needs a video or a photo; text-only posts are not supported.');
  }
  if (!ctx.text.trim()) {
    return stepFailed('TikTok posts need a title/caption.', false);
  }

  // Step 1 — creator capabilities (privacy options are per-creator).
  if (ctx.state.step === undefined) {
    const info = await queryCreatorInfo(ctx.http, ctx.accessToken);
    if (info.privacyOptions.length === 0) {
      return stepFailed('TikTok returned no privacy options for this creator; the account may not be eligible for API posting.', false);
    }
    return stepContinue(
      { ...ctx.state, step: 'submit', privacyOptions: info.privacyOptions },
      0,
      'Creator options loaded.',
    );
  }

  const options = privacyOptions(ctx.state);
  const requested = optionString(ctx.options, 'privacy');
  const privacy =
    requested && options.includes(requested)
      ? requested
      : options.includes('PUBLIC_TO_EVERYONE')
        ? 'PUBLIC_TO_EVERYONE'
        : options[0]!;
  if (requested && !options.includes(requested)) {
    return stepFailed(
      `TikTok privacy "${requested}" is not available to this creator (options: ${options.join(', ')}).`,
      false,
    );
  }
  const title = ctx.text.trim();

  // Step 2 — submit.
  if (ctx.state.step === 'submit') {
    if (media.kind === 'image') {
      if (!media.publicUrl) {
        return stepUnsupported(
          'TikTok photo posts fetch the image from a public URL, which needs the Supabase backend. Videos work everywhere via direct upload.',
        );
      }
      const response = await ctx.http(`${API}/v2/post/publish/content/init/`, {
        method: 'POST',
        headers: authHeaders(ctx.accessToken),
        body: JSON.stringify({
          post_info: { title, privacy_level: privacy },
          source_info: { source: 'PULL_FROM_URL', photo_images: [media.publicUrl] },
          post_mode: 'DIRECT_POST',
          media_type: 'PHOTO',
        }),
      });
      const payload = (await parseProviderJson(response, { platform: 'TikTok' })) as Record<string, unknown>;
      const data = (payload.data as Record<string, unknown> | undefined) ?? {};
      const publishId = stringField(data, 'publish_id');
      if (!publishId) {
        return stepFailed('TikTok did not return a publish id for the photo post.', false);
      }
      return stepContinue(
        { ...ctx.state, step: 'poll', ref: publishId, pollRound: 0 },
        POLL_INTERVAL_SECONDS,
        'Photo post submitted; waiting on TikTok processing.',
      );
    }

    // Video via FILE_UPLOAD. Library files are <= 10 MiB, so one chunk.
    if (!media.bytes) {
      return stepFailed('TikTok video upload needs the media bytes.', false);
    }
    const totalChunks = Math.max(1, Math.ceil(media.bytes.byteLength / CHUNK_SIZE));
    const initResponse = await ctx.http(`${API}/v2/post/publish/video/init/`, {
      method: 'POST',
      headers: authHeaders(ctx.accessToken),
      body: JSON.stringify({
        post_info: {
          title,
          privacy_level: privacy,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: media.bytes.byteLength,
          chunk_size: CHUNK_SIZE,
          total_chunk_count: totalChunks,
        },
      }),
    });
    const initPayload = (await parseProviderJson(initResponse, { platform: 'TikTok' })) as Record<string, unknown>;
    const initData = (initPayload.data as Record<string, unknown> | undefined) ?? {};
    const publishId = stringField(initData, 'publish_id');
    const uploadUrl = stringField(initData, 'upload_url');
    if (!publishId || !uploadUrl) {
      return stepFailed('TikTok did not return an upload session for the video.', false);
    }
    // Upload chunks (one chunk for library-sized files). Upload URLs are
    // capability URLs: used immediately, never stored.
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, media.bytes.byteLength);
      const chunk = media.bytes.slice(start, end);
      const putResponse = await ctx.http(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': media.mime,
          'Content-Range': `bytes ${start}-${end - 1}/${media.bytes.byteLength}`,
        },
        body: chunk,
      });
      if (putResponse.status < 200 || putResponse.status >= 300) {
        return stepFailed(`TikTok video chunk ${index + 1}/${totalChunks} was rejected (${putResponse.status}).`, true);
      }
    }
    return stepContinue(
      { ...ctx.state, step: 'poll', ref: publishId, pollRound: 0 },
      POLL_INTERVAL_SECONDS,
      'Video uploaded; waiting on TikTok processing.',
    );
  }

  // Step 3 — poll until the provider decides.
  if (ctx.state.step === 'poll' && ctx.state.ref) {
    const round = pollRound(ctx.state);
    const response = await ctx.http(`${API}/v2/post/publish/status/fetch/`, {
      method: 'POST',
      headers: authHeaders(ctx.accessToken),
      body: JSON.stringify({ publish_id: ctx.state.ref }),
    });
    const payload = (await parseProviderJson(response, { platform: 'TikTok' })) as Record<string, unknown>;
    const data = (payload.data as Record<string, unknown> | undefined) ?? {};
    const status = stringField(data, 'status');
    if (status === 'PUBLISH_COMPLETE') {
      const postIds = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id : [];
      const postId = postIds.length > 0 ? String(postIds[0]) : String(ctx.state.ref);
      const note =
        postIds.length > 0
          ? 'Verified: TikTok reports the post complete and publicly available.'
          : 'Verified: TikTok reports the post complete (private visibility — no public post id).';
      return stepPublished('read_back', postId, String(ctx.state.ref), note);
    }
    if (status === 'FAILED') {
      const reason = stringField(data, 'fail_reason') ?? 'TikTok failed the post without a reason.';
      return stepFailed(`TikTok: ${reason.slice(0, 300)}`, false);
    }
    if (status === 'PROCESSING_UPLOAD' || status === 'PROCESSING_DOWNLOAD' || status === null) {
      if (round + 1 >= MAX_POLLS) {
        return stepUnknown(
          'TikTok is still processing after an hour of polling. Check TikTok before republishing to avoid a duplicate.',
        );
      }
      return stepContinue(
        { ...ctx.state, pollRound: round + 1 },
        POLL_INTERVAL_SECONDS,
        `TikTok processing (${status ?? 'unknown status'}, poll ${round + 1}/${MAX_POLLS}).`,
      );
    }
    return stepFailed(`TikTok returned an unrecognized post status: ${String(status).slice(0, 80)}.`, false);
  }

  return stepFailed('TikTok publish state is corrupted; start a new publish.', false);
}

/**
 * Pinterest publisher (Phase 8).
 *
 * Verified against the official API v5 reference + guides (Oct 2026):
 *  - Image Pin: `POST /v5/pins` {board_id (required), title (<=100),
 *    description (<=800), link (<=2048), alt_text, media_source:
 *    {source_type: image_base64, content_type, data}}. -> 201 + Pin id.
 *  - Video Pin: `POST /v5/media` {media_type: video} -> {media_id,
 *    upload_url, upload_parameters}; multipart POST bytes to upload_url
 *    (no auth, 204); `GET /v5/media/{media_id}` until status "succeeded";
 *    `POST /v5/pins` {board_id, title, description,
 *    media_source: {source_type: video_id, media_id, cover_image_url}} —
 *    a valid cover_image_url is REQUIRED (400 otherwise). Video files
 *    .mp4/.mov/.m4v. -> 201 + Pin id.
 *  - Boards: `GET /v5/boards` (board picker). Verify: `GET /v5/pins/{id}`.
 *  - Scopes: boards:read, boards:write, pins:read, pins:write (connect-time).
 *  - No `publish_at` in the official schema: scheduling is Nibrexo-side.
 *  - Sandbox supports image Pins; video Pins need production.
 *
 * Media strategy: bytes everywhere (base64 image, S3 video upload) — works
 * on every backend. Only the video COVER needs a public URL (signed URL).
 */

import {
  parseProviderJson,
  ProviderError,
  requiredString,
  stringField,
} from '@/server/social/providers';
import {
  buildMultipartForm,
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

const API = 'https://api.pinterest.com/v5';
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/m4v']);
const MEDIA_POLL_INTERVAL_SECONDS = 300;
const MEDIA_MAX_POLLS = 6;

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

function boardIdOption(options: Record<string, string | boolean>): string | null {
  const value = optionString(options, 'boardId');
  return value && /^\d+$/.test(value) ? value : null;
}

export const pinterestPublisher: PublisherAdapter = {
  platform: 'pinterest',
  label: 'Pinterest',

  checkSupport(input: PublishSupportInput): PublishSupport {
    if (!boardIdOption(input.options)) {
      return { ok: false, reason: 'Pinterest Pins need a target board.' };
    }
    if (!input.media) {
      return { ok: false, reason: 'Pinterest Pins need an image or a video.' };
    }
    if (input.media.kind === 'image' && !IMAGE_MIMES.has(input.media.mime.toLowerCase())) {
      return {
        ok: false,
        reason: `Pinterest image Pins accept JPEG or PNG; got ${input.media.mime}.`,
      };
    }
    if (input.media.kind === 'video') {
      if (!VIDEO_MIMES.has(input.media.mime.toLowerCase())) {
        return {
          ok: false,
          reason: `Pinterest video Pins accept MP4, MOV or M4V; got ${input.media.mime}.`,
        };
      }
      if (!input.coverPublicUrl) {
        return {
          ok: false,
          reason: 'Pinterest video Pins require a cover image (Pinterest rejects the Pin without a valid cover_image_url).',
        };
      }
    }
    if (input.title.trim().length > 100) {
      return { ok: false, reason: 'Pinterest titles are limited to 100 characters.' };
    }
    if (input.text.length > 800) {
      return { ok: false, reason: 'Pinterest descriptions are limited to 800 characters.' };
    }
    if (input.linkUrl && input.linkUrl.length > 2048) {
      return { ok: false, reason: 'Pinterest links are limited to 2048 characters.' };
    }
    return { ok: true };
  },

  mediaStrategy(kind: 'image' | 'video' | null): 'bytes' | 'public-url' | 'none' {
    return kind ? 'bytes' : 'none';
  },

  async executeStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
    try {
      return await runStep(ctx);
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.code === 'INVALID_GRANT') {
          return stepFailed(`Pinterest: ${error.message}`, false, true);
        }
        if (error.code === 'RATE_LIMITED' || error.retryable) {
          return stepFailed(`Pinterest: ${error.message}`, true);
        }
        return stepFailed(`Pinterest: ${error.message}`, false);
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      return stepFailed(`Pinterest: provider request failed (${detail.slice(0, 160)}).`, true);
    }
  },
};

async function readPin(
  ctx: PublishStepContext,
  pinId: string,
): Promise<boolean> {
  const response = await ctx.http(`${API}/pins/${encodeURIComponent(pinId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
  });
  const payload = (await parseProviderJson(response, { platform: 'Pinterest' })) as Record<string, unknown>;
  return stringField(payload, 'id') === pinId;
}

async function runStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
  const media = ctx.media;
  const boardId = boardIdOption(ctx.options);
  if (!media || !media.bytes) {
    return stepUnsupported('Pinterest Pins need an image or a video from the media library.');
  }
  if (!boardId) return stepFailed('Pinterest Pins need a target board.', false);

  const base = {
    board_id: boardId,
    ...(ctx.title.trim() ? { title: ctx.title.trim().slice(0, 100) } : {}),
    ...(ctx.text.trim() ? { description: ctx.text.trim().slice(0, 800) } : {}),
    ...(ctx.linkUrl ? { link: ctx.linkUrl } : {}),
  };

  // Image Pin: single submit, then read-back.
  if (media.kind === 'image') {
    if (!IMAGE_MIMES.has(media.mime.toLowerCase())) {
      return stepUnsupported(`Pinterest image Pins accept JPEG or PNG; got ${media.mime}.`);
    }
    if (ctx.state.step === undefined) {
      const data = Buffer.from(media.bytes).toString('base64');
      const response = await ctx.http(`${API}/pins`, {
        method: 'POST',
        headers: authHeaders(ctx.accessToken),
        body: JSON.stringify({
          ...base,
          media_source: {
            source_type: 'image_base64',
            content_type: media.mime.toLowerCase(),
            data,
          },
        }),
      });
      const payload = (await parseProviderJson(response, { platform: 'Pinterest' })) as Record<string, unknown>;
      const pinId = stringField(payload, 'id');
      if (!pinId) return stepFailed('Pinterest accepted the Pin but returned no id.', false);
      return stepContinue({ ...ctx.state, step: 'verify', ref: pinId, pollRound: 0 }, 0, 'Pin created; verifying.');
    }
    if (ctx.state.step === 'verify' && ctx.state.ref) {
      const pinId = String(ctx.state.ref);
      try {
        if (await readPin(ctx, pinId)) {
          return stepPublished('read_back', pinId, pinId, 'Verified: Pin read back from Pinterest.');
        }
        return stepUnknown(`Pinterest Pin ${pinId} was created but reads back differently. Check Pinterest before republishing.`);
      } catch {
        const round = pollRound(ctx.state);
        if (round + 1 >= 3) {
          return stepUnknown(`Pinterest Pin ${pinId} was created but could not be read back. Check Pinterest before republishing.`);
        }
        return stepContinue({ ...ctx.state, pollRound: round + 1 }, MEDIA_POLL_INTERVAL_SECONDS, 'Read-back failed; retrying.');
      }
    }
    return stepFailed('Pinterest publish state is corrupted; start a new publish.', false);
  }

  // Video Pin: register -> S3 upload -> poll media -> create Pin -> verify.
  if (!VIDEO_MIMES.has(media.mime.toLowerCase())) {
    return stepUnsupported(`Pinterest video Pins accept MP4, MOV or M4V; got ${media.mime}.`);
  }
  if (!ctx.coverPublicUrl) {
    return stepFailed('Pinterest video Pins require a cover image.', false);
  }

  if (ctx.state.step === undefined) {
    const regResponse = await ctx.http(`${API}/media`, {
      method: 'POST',
      headers: authHeaders(ctx.accessToken),
      body: JSON.stringify({ media_type: 'video' }),
    });
    const reg = (await parseProviderJson(regResponse, { platform: 'Pinterest' })) as Record<string, unknown>;
    const mediaId = stringField(reg, 'media_id');
    const uploadUrl = stringField(reg, 'upload_url');
    const params = reg.upload_parameters as Record<string, unknown> | undefined;
    if (!mediaId || !uploadUrl || !params) {
      return stepFailed('Pinterest did not return a video upload session.', true);
    }
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      // The Content-Type form field is documentation noise; the real header
      // comes from the multipart body itself.
      if (key.toLowerCase() === 'content-type' || typeof value !== 'string') continue;
      fields[key] = value;
    }
    const { body, contentType } = buildMultipartForm(fields, {
      fieldName: 'file',
      filename: media.filename,
      mime: media.mime,
      bytes: media.bytes,
    });
    const s3Response = await ctx.http(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    if (s3Response.status !== 204 && (s3Response.status < 200 || s3Response.status >= 300)) {
      return stepFailed(`Pinterest video upload was rejected (${s3Response.status}).`, true);
    }
    return stepContinue(
      { ...ctx.state, step: 'media_poll', ref: mediaId, pollRound: 0 },
      MEDIA_POLL_INTERVAL_SECONDS,
      'Video uploaded; waiting on Pinterest processing.',
    );
  }

  if (ctx.state.step === 'media_poll' && ctx.state.ref) {
    const mediaId = String(ctx.state.ref);
    const round = pollRound(ctx.state);
    const response = await ctx.http(`${API}/media/${encodeURIComponent(mediaId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    const payload = (await parseProviderJson(response, { platform: 'Pinterest' })) as Record<string, unknown>;
    const status = stringField(payload, 'status');
    if (status === 'succeeded') {
      const pinResponse = await ctx.http(`${API}/pins`, {
        method: 'POST',
        headers: authHeaders(ctx.accessToken),
        body: JSON.stringify({
          ...base,
          media_source: {
            source_type: 'video_id',
            media_id: mediaId,
            cover_image_url: ctx.coverPublicUrl,
          },
        }),
      });
      const pin = (await parseProviderJson(pinResponse, { platform: 'Pinterest' })) as Record<string, unknown>;
      const pinId = requiredString(pin, 'id', 'Pinterest');
      return stepContinue({ ...ctx.state, step: 'verify', ref: pinId, pollRound: 0 }, 0, 'Video Pin created; verifying.');
    }
    if (status === 'failed') {
      return stepFailed('Pinterest could not process the video.', false);
    }
    if (round + 1 >= MEDIA_MAX_POLLS) {
      return stepUnknown(
        'Pinterest is still processing the video after repeated polls. Check Pinterest before republishing.',
      );
    }
    return stepContinue(
      { ...ctx.state, pollRound: round + 1 },
      MEDIA_POLL_INTERVAL_SECONDS,
      `Pinterest video processing (${status ?? 'unknown'}, poll ${round + 1}/${MEDIA_MAX_POLLS}).`,
    );
  }

  if (ctx.state.step === 'verify' && ctx.state.ref) {
    const pinId = String(ctx.state.ref);
    try {
      if (await readPin(ctx, pinId)) {
        return stepPublished('read_back', pinId, pinId, 'Verified: video Pin read back from Pinterest.');
      }
      return stepUnknown(`Pinterest Pin ${pinId} was created but reads back differently. Check Pinterest before republishing.`);
    } catch {
      const round = pollRound(ctx.state);
      if (round + 1 >= 3) {
        return stepUnknown(`Pinterest Pin ${pinId} was created but could not be read back. Check Pinterest before republishing.`);
      }
      return stepContinue({ ...ctx.state, pollRound: round + 1 }, MEDIA_POLL_INTERVAL_SECONDS, 'Read-back failed; retrying.');
    }
  }

  return stepFailed('Pinterest publish state is corrupted; start a new publish.', false);
}

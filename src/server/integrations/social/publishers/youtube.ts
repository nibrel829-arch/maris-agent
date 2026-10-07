/**
 * YouTube publisher (Phase 8).
 *
 * Verified (Oct 2026 — official videos resource reference + corroborated
 * upload flows):
 *  - Upload: resumable session `POST
 *    https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
 *    with JSON metadata + X-Upload-Content-Length/Type -> `Location` session
 *    URI -> `PUT` bytes -> 201 video resource with `id`.
 *  - Metadata: snippet.title (required, <=100 chars), snippet.description
 *    (<=5000 bytes), snippet.categoryId, status.privacyStatus
 *    (public/unlisted/private), status.selfDeclaredMadeForKids.
 *  - Native scheduling: status.publishAt (ISO 8601) REQUIRES privacyStatus
 *    private on a never-published video; YouTube flips it to public at that
 *    time. Past publishAt publishes immediately. Because publishAt always
 *    flips to PUBLIC, unlisted/private futures are held Nibrexo-side instead.
 *  - Verification: `GET .../youtube/v3/videos?id=...&part=status,snippet` ->
 *    status.uploadStatus (uploaded/processed/failed/rejected) +
 *    status.privacyStatus. Unverified API projects stay private until audit —
 *    the read-back reports the ACTUAL privacy so we never claim public.
 *  - Scope: https://www.googleapis.com/auth/youtube.upload (connect-time).
 *
 * Video-only platform: no text/image posts. Bytes upload works on every
 * backend (no public URL needed).
 */

import {
  parseProviderJson,
  ProviderError,
  stringField,
  type ProviderHttp,
} from '@/server/social/providers';
import {
  optionBoolean,
  optionString,
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

const UPLOAD_INIT_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const MAX_DESCRIPTION_BYTES = 5000;
const MAX_TITLE_CHARS = 100;
const VERIFY_ROUNDS = 3;
const VERIFY_INTERVAL_SECONDS = 300;

export type YouTubePrivacy = 'public' | 'unlisted' | 'private';

export function youtubePrivacyOption(options: Record<string, string | boolean>): YouTubePrivacy {
  const value = optionString(options, 'privacyStatus');
  return value === 'unlisted' || value === 'private' ? value : 'public';
}

function categoryIdOption(options: Record<string, string | boolean>): string {
  const value = optionString(options, 'categoryId');
  return value && /^\d{1,4}$/.test(value) ? value : '22';
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export const youtubePublisher: PublisherAdapter = {
  platform: 'youtube',
  label: 'YouTube',

  checkSupport(input: PublishSupportInput): PublishSupport {
    if (!input.media || input.media.kind !== 'video') {
      return { ok: false, reason: 'YouTube publishing needs a video file.' };
    }
    if (!input.title.trim()) {
      return { ok: false, reason: 'YouTube videos need a title.' };
    }
    if (input.title.trim().length > MAX_TITLE_CHARS) {
      return { ok: false, reason: `YouTube titles are limited to ${MAX_TITLE_CHARS} characters.` };
    }
    if (utf8Length(input.text) > MAX_DESCRIPTION_BYTES) {
      return {
        ok: false,
        reason: `YouTube descriptions are limited to ${MAX_DESCRIPTION_BYTES} bytes.`,
      };
    }
    const privacy = youtubePrivacyOption(input.options);
    if (input.scheduled && privacy !== 'public') {
      // publishAt always flips to public; hold these Nibrexo-side instead.
      return {
        ok: false,
        reason: `YouTube ${privacy} videos cannot use provider scheduling (publishAt always flips to public); they are held and uploaded at the scheduled time.`,
      };
    }
    return { ok: true };
  },

  mediaStrategy(kind: 'image' | 'video' | null): 'bytes' | 'public-url' | 'none' {
    return kind === 'video' ? 'bytes' : 'none';
  },

  async executeStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
    try {
      return await runStep(ctx);
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.code === 'INVALID_GRANT') {
          return stepFailed(`YouTube: ${error.message}`, false, true);
        }
        if (error.code === 'RATE_LIMITED' || error.retryable) {
          return stepFailed(`YouTube: ${error.message}`, true);
        }
        return stepFailed(`YouTube: ${error.message}`, false);
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      return stepFailed(`YouTube: provider request failed (${detail.slice(0, 160)}).`, true);
    }
  },
};

async function readVideoStatus(
  http: ProviderHttp,
  accessToken: string,
  videoId: string,
): Promise<{ uploadStatus: string | null; privacyStatus: string | null }> {
  const url = `${VIDEOS_URL}?${new URLSearchParams({ id: videoId, part: 'status,snippet' }).toString()}`;
  const response = await http(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await parseProviderJson(response, { platform: 'YouTube' })) as Record<string, unknown>;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const first = (items[0] ?? {}) as Record<string, unknown>;
  const status = (first.status as Record<string, unknown> | undefined) ?? {};
  return {
    uploadStatus: stringField(status, 'uploadStatus'),
    privacyStatus: stringField(status, 'privacyStatus'),
  };
}

async function runStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
  const media = ctx.media;
  if (!media || media.kind !== 'video' || !media.bytes) {
    return stepUnsupported('YouTube publishing needs a video file.');
  }
  const title = ctx.title.trim();
  if (!title) return stepFailed('YouTube videos need a title.', false);
  if (title.length > MAX_TITLE_CHARS) {
    return stepFailed(`YouTube titles are limited to ${MAX_TITLE_CHARS} characters.`, false);
  }
  if (utf8Length(ctx.text) > MAX_DESCRIPTION_BYTES) {
    return stepFailed(`YouTube descriptions are limited to ${MAX_DESCRIPTION_BYTES} bytes.`, false);
  }

  // Step 1 — resumable upload.
  if (ctx.state.step === undefined) {
    const privacy = youtubePrivacyOption(ctx.options);
    const scheduledPublic = ctx.scheduled && privacy === 'public';
    if (ctx.scheduled && !scheduledPublic) {
      return stepFailed(
        'YouTube provider scheduling only supports public videos; this job should have been held Nibrexo-side.',
        false,
      );
    }
    const metadata = {
      snippet: {
        title,
        description: ctx.text,
        categoryId: categoryIdOption(ctx.options),
      },
      status: {
        privacyStatus: scheduledPublic ? 'private' : privacy,
        ...(scheduledPublic ? { publishAt: ctx.runAt } : {}),
        selfDeclaredMadeForKids: optionBoolean(ctx.options, 'madeForKids', false),
      },
    };
    const initResponse = await ctx.http(UPLOAD_INIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(media.bytes.byteLength),
        'X-Upload-Content-Type': media.mime,
      },
      body: JSON.stringify(metadata),
    });
    // The session init returns 200 with an empty body: only the status and the
    // Location header matter, so this response deliberately skips JSON parsing.
    if (initResponse.status < 200 || initResponse.status >= 300) {
      throw new ProviderError('PROVIDER_HTTP', `YouTube: upload session init failed (${initResponse.status}).`, initResponse.status >= 500, initResponse.status);
    }
    const sessionUri =
      initResponse.headers?.location ?? initResponse.headers?.Location ?? null;
    if (typeof sessionUri !== 'string' || !sessionUri.startsWith('https://')) {
      return stepFailed('YouTube did not return an upload session.', true);
    }
    const putResponse = await ctx.http(sessionUri, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': media.mime,
      },
      body: media.bytes,
    });
    const video = (await parseProviderJson(putResponse, { platform: 'YouTube' })) as Record<string, unknown>;
    const videoId = stringField(video, 'id');
    if (!videoId) {
      return stepFailed('YouTube accepted the upload but returned no video id.', false);
    }
    if (scheduledPublic) {
      const verifyAfter = new Date(Date.parse(ctx.runAt) + 10 * 60 * 1000).toISOString();
      return stepScheduledProvider(
        videoId,
        verifyAfter,
        videoId,
        'Video uploaded as private with a provider publish time; YouTube flips it to public.',
      );
    }
    return stepContinue({ ...ctx.state, step: 'verify', ref: videoId, pollRound: 0 }, 0, 'Upload accepted; verifying.');
  }

  // Step 2 — read-back verification.
  if ((ctx.state.step === 'verify' || ctx.state.step === 'scheduled_verify') && ctx.state.ref) {
    const round = pollRound(ctx.state);
    const videoId = String(ctx.state.ref);
    let status: { uploadStatus: string | null; privacyStatus: string | null };
    try {
      status = await readVideoStatus(ctx.http, ctx.accessToken, videoId);
    } catch (error) {
      if (round + 1 >= VERIFY_ROUNDS) {
        const detail = error instanceof Error ? error.message : 'read-back failed';
        return stepUnknown(`YouTube upload ${videoId} could not be read back (${detail.slice(0, 120)}). Check YouTube Studio before republishing.`);
      }
      return stepContinue({ ...ctx.state, pollRound: round + 1 }, VERIFY_INTERVAL_SECONDS, 'Read-back failed; retrying.');
    }
    if (status.uploadStatus === 'failed' || status.uploadStatus === 'rejected') {
      return stepFailed(`YouTube ${status.uploadStatus} the video.`, false);
    }
    if (status.uploadStatus === 'processed' || status.uploadStatus === 'uploaded') {
      const actual = status.privacyStatus ?? 'unknown';
      const note =
        ctx.state.step === 'scheduled_verify'
          ? `Verified: scheduled video is ${actual} (upload ${status.uploadStatus}).`
          : `Verified: video ${status.uploadStatus}, visibility ${actual}.` +
            (actual === 'private' && youtubePrivacyOption(ctx.options) === 'public'
              ? ' YouTube kept it private — unverified API projects stay private until audit.'
              : '');
      return stepPublished('read_back', videoId, videoId, note);
    }
    if (round + 1 >= VERIFY_ROUNDS) {
      return stepUnknown(
        `YouTube video ${videoId} is still "${status.uploadStatus ?? 'unknown'}". Check YouTube Studio before republishing.`,
      );
    }
    return stepContinue(
      { ...ctx.state, pollRound: round + 1 },
      VERIFY_INTERVAL_SECONDS,
      `YouTube processing (${status.uploadStatus ?? 'unknown'}).`,
    );
  }

  return stepFailed('YouTube publish state is corrupted; start a new publish.', false);
}

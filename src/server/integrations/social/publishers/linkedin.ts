/**
 * LinkedIn publisher (Phase 8).
 *
 * Verified against the official Microsoft Learn API reference (Oct 2026):
 *  - Posts API `POST https://api.linkedin.com/rest/posts` replaces
 *    ugcPosts. Required headers: Linkedin-Version YYYYMM +
 *    X-Restli-Protocol-Version 2.0.0. Text post:
 *    {author, commentary, visibility PUBLIC, distribution {feedDistribution
 *    MAIN_FEED, ...}, lifecycleState PUBLISHED, isReshareDisabledByAuthor}.
 *    Media post adds content.media {id: asset URN, title}. -> 201 with the
 *    post URN in the `x-restli-id` response header.
 *  - Member posts: author urn:li:person:{sub} (sub from userinfo — our
 *    stored external id) with w_member_social (Share on LinkedIn, self-serve).
 *    Organization posts need w_organization_social (vetted Community
 *    Management API) — NOT requested at connect time, so member-only here.
 *  - Images API: `POST /rest/images?action=initializeUpload`
 *    {initializeUploadRequest: {owner}} -> {value: {uploadUrl, image}}; PUT
 *    bytes to uploadUrl; reference the image URN. Formats JPG/GIF/PNG
 *    (<36,152,320 px). w_member_social is WRITE-ONLY for rest/images: no
 *    asset status polling — initialize, upload, post.
 *  - No read-back: r_member_social is restricted/approved-only, so a 201 +
 *    x-restli-id is the strongest available signal (`provider_reference`
 *    verification, documented honestly).
 *  - No provider scheduling: future posts are held Nibrexo-side.
 *  - Video: multi-step chunked Videos API with ETag finalization —
 *    documented but not implemented; video targets report unsupported.
 */

import {
  parseProviderJson,
  ProviderError,
  responseHeader,
  stringField,
} from '@/server/social/providers';
import {
  stepFailed,
  stepPublished,
  stepUnsupported,
  type PublisherAdapter,
  type PublishStepContext,
  type PublishStepOutcome,
  type PublishSupport,
  type PublishSupportInput,
} from './types';

const API = 'https://api.linkedin.com/rest';
/** Latest versioned API at verification time (view=li-lms-2026-08). */
const LINKEDIN_VERSION = '202608';
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif']);

function apiHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Linkedin-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

export const linkedinPublisher: PublisherAdapter = {
  platform: 'linkedin',
  label: 'LinkedIn',

  checkSupport(input: PublishSupportInput): PublishSupport {
    if (!input.text.trim()) {
      return { ok: false, reason: 'LinkedIn posts need text.' };
    }
    if (!input.media) return { ok: true };
    if (input.media.kind === 'video') {
      return {
        ok: false,
        reason:
          'LinkedIn video posts need the multi-step chunked Videos API (ETag finalization), which is not implemented yet. Text and image posts are supported.',
      };
    }
    if (!IMAGE_MIMES.has(input.media.mime.toLowerCase())) {
      return {
        ok: false,
        reason: `LinkedIn images accept JPG, PNG or GIF; got ${input.media.mime}.`,
      };
    }
    return { ok: true };
  },

  mediaStrategy(kind: 'image' | 'video' | null): 'bytes' | 'public-url' | 'none' {
    return kind === 'image' ? 'bytes' : 'none';
  },

  async executeStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
    try {
      return await runStep(ctx);
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.code === 'INVALID_GRANT') {
          return stepFailed(`LinkedIn: ${error.message}`, false, true);
        }
        if (error.code === 'RATE_LIMITED' || error.retryable) {
          return stepFailed(`LinkedIn: ${error.message}`, true);
        }
        return stepFailed(`LinkedIn: ${error.message}`, false);
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      return stepFailed(`LinkedIn: provider request failed (${detail.slice(0, 160)}).`, true);
    }
  },
};

async function runStep(ctx: PublishStepContext): Promise<PublishStepOutcome> {
  const text = ctx.text.trim();
  if (!text) return stepFailed('LinkedIn posts need text.', false);
  const author = `urn:li:person:${ctx.accountExternalId}`;

  let mediaId: string | null = null;
  if (ctx.media) {
    if (ctx.media.kind === 'video') {
      return stepUnsupported(
        'LinkedIn video posts need the multi-step chunked Videos API (ETag finalization), which is not implemented yet. Text and image posts are supported.',
      );
    }
    if (!IMAGE_MIMES.has(ctx.media.mime.toLowerCase())) {
      return stepUnsupported(`LinkedIn images accept JPG, PNG or GIF; got ${ctx.media.mime}.`);
    }
    if (!ctx.media.bytes) {
      return stepFailed('LinkedIn image upload needs the media bytes.', false);
    }
    const initResponse = await ctx.http(`${API}/images?action=initializeUpload`, {
      method: 'POST',
      headers: apiHeaders(ctx.accessToken),
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    });
    const init = (await parseProviderJson(initResponse, { platform: 'LinkedIn' })) as Record<string, unknown>;
    const value = (init.value as Record<string, unknown> | undefined) ?? {};
    const uploadUrl = stringField(value, 'uploadUrl');
    const imageUrn = stringField(value, 'image');
    if (!uploadUrl || !imageUrn) {
      return stepFailed('LinkedIn did not return an image upload session.', true);
    }
    const putResponse = await ctx.http(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': ctx.media.mime,
      },
      body: ctx.media.bytes,
    });
    if (putResponse.status < 200 || putResponse.status >= 300) {
      return stepFailed(`LinkedIn image upload was rejected (${putResponse.status}).`, true);
    }
    mediaId = imageUrn;
  }

  const postResponse = await ctx.http(`${API}/posts`, {
    method: 'POST',
    headers: apiHeaders(ctx.accessToken),
    body: JSON.stringify({
      author,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(mediaId ? { content: { media: { id: mediaId, title: ctx.title.trim().slice(0, 200) || 'Image' } } } : {}),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  if (postResponse.status !== 201) {
    const payload = await parseProviderJson(postResponse, { platform: 'LinkedIn' });
    void payload;
    return stepFailed(`LinkedIn did not confirm the post (${postResponse.status}).`, postResponse.status >= 500);
  }
  const postUrn = responseHeader(postResponse, 'x-restli-id');
  if (!postUrn) {
    return stepFailed('LinkedIn returned 201 without a post reference header.', false);
  }
  return stepPublished(
    'provider_reference',
    postUrn,
    postUrn,
    'LinkedIn returned 201 with a post URN. Read-back is unavailable: post retrieval needs the restricted r_member_social product.',
  );
}

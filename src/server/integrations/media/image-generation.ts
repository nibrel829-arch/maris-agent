/**
 * Image generation adapters.
 *
 * Arena Agent Mode / Image Arena (https://arena.ai/agent, help.arena.ai image
 * article) are website experiences. No official public API for invoking Agent
 * Mode image generation was found on 2026-10-08. That path is unsupported and
 * is never called.
 *
 * Native adapter, compatible with the existing OpenAI provider:
 *   POST https://api.openai.com/v1/images/generations
 *   Authorization: Bearer $OPENAI_API_KEY
 *   Default model: gpt-image-1.5 (override with NIBREXO_IMAGE_MODEL)
 *   Docs: https://developers.openai.com/api/reference/resources/images/methods/generate
 */

import { serverEnv } from '@/lib/env';
import { redactSecrets } from '@/server/integrations/redact';

export const OPENAI_IMAGES_ENDPOINT = 'https://api.openai.com/v1/images/generations';

export const ARENA_IMAGE_UNSUPPORTED = {
  status: 'unsupported' as const,
  name: 'Arena Agent Mode',
  message:
    'Arena Agent Mode image generation has no supported programmatic API. The Arena website and Agent Mode are not called. Use the native OpenAI Images adapter when OPENAI_API_KEY is configured.',
  evidence:
    'Checked https://arena.ai/agent and Arena help articles for Image Arena on 2026-10-08. Those surfaces are interactive website flows, not a documented automation API for third-party apps.',
};

export type ImageGenerationResult =
  | { status: 'generated'; bytes: Uint8Array; mimeType: 'image/png'; model: string; provider: 'openai' }
  | { status: 'needs_configuration'; missing: string[]; message: string }
  | { status: 'error'; message: string; retryable: boolean };

function decodeImagePayload(payload: {
  data?: Array<{ b64_json?: string; url?: string }>;
}): { b64?: string; url?: string } {
  const first = payload.data?.[0];
  return { b64: first?.b64_json, url: first?.url };
}

export async function generateImage(input: {
  prompt: string;
  signal?: AbortSignal;
}): Promise<ImageGenerationResult> {
  const env = serverEnv();
  if (!env.openAiApiKey) {
    return {
      status: 'needs_configuration',
      missing: ['OPENAI_API_KEY'],
      message: `${ARENA_IMAGE_UNSUPPORTED.message} Native generation needs OPENAI_API_KEY (POST ${OPENAI_IMAGES_ENDPOINT}). No image was created.`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(OPENAI_IMAGES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: env.imageModel,
        prompt: input.prompt.slice(0, 3200),
        n: 1,
        size: '1024x1024',
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      return {
        status: 'error',
        retryable: response.status === 429 || response.status >= 500,
        message: `OpenAI Images returned HTTP ${response.status}. ${redactSecrets(raw).slice(0, 280)}`.trim(),
      };
    }
    const parsed = JSON.parse(raw) as { data?: Array<{ b64_json?: string; url?: string }> };
    const image = decodeImagePayload(parsed);
    if (image.b64) {
      const bytes = Uint8Array.from(Buffer.from(image.b64, 'base64'));
      if (bytes.byteLength === 0) {
        return { status: 'error', retryable: false, message: 'OpenAI Images returned an empty file. Nothing was saved.' };
      }
      return { status: 'generated', bytes, mimeType: 'image/png', model: env.imageModel, provider: 'openai' };
    }
    if (image.url && /^https:\/\//i.test(image.url)) {
      const downloaded = await fetch(image.url, { signal: controller.signal });
      if (!downloaded.ok) {
        return {
          status: 'error',
          retryable: true,
          message: `OpenAI returned an image URL but the download failed with HTTP ${downloaded.status}. The image was not saved.`,
        };
      }
      const bytes = new Uint8Array(await downloaded.arrayBuffer());
      return { status: 'generated', bytes, mimeType: 'image/png', model: env.imageModel, provider: 'openai' };
    }
    return {
      status: 'error',
      retryable: false,
      message: 'OpenAI Images did not return image bytes. No image was saved.',
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      status: 'error',
      retryable: true,
      message: aborted
        ? 'Image generation timed out or was cancelled. It can be retried.'
        : `Image generation failed: ${redactSecrets(error instanceof Error ? error.message : 'network error')}`,
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

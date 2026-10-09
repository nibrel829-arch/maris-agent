/**
 * Nibrexo-owned image engine client.
 *
 * The Manager talks only to the process started by
 * `scripts/nibrexo-image-engine.py`. It does not call OpenAI, Cloudflare,
 * Pollinations, Arena, Hugging Face Inference, or Black Forest's hosted API.
 *
 * A step is not successful until that process returns real image bytes.
 * A missing worker, missing weights, or insufficient RAM is a configuration
 * failure. No placeholder file is created.
 */

import { createHash } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { redactSecrets } from '@/server/integrations/redact';
import { inspectImageBytes, type RasterMime } from '@/server/integrations/media/image-bytes';

export const NIBREXO_IMAGE_ENGINE_ID = 'nibrexo-image-engine';
export const NIBREXO_IMAGE_MODEL_ID = 'sd-legacy/stable-diffusion-v1-5';
export const NIBREXO_IMAGE_LICENSE = 'CreativeML Open RAIL-M';
export const NIBREXO_IMAGE_MIN_RAM_GB = 8;
export const NIBREXO_IMAGE_WEIGHTS_GB = 4;

export interface AppliedImageOptions {
  negativePrompt: boolean;
  dimensions: boolean;
  steps: number;
}

export interface ImageProgress {
  stage: string;
  step: number;
  total: number;
  message: string;
}

export type NativeImageResult =
  | {
      status: 'generated';
      bytes: Uint8Array;
      mimeType: RasterMime;
      provider: 'nibrexo';
      model: string;
      width: number | null;
      height: number | null;
      applied: AppliedImageOptions;
      ignored: string[];
      sha256: string;
      jobId?: string | null;
      progress?: ImageProgress | null;
    }
  | { status: 'needs_configuration'; missing: string[]; message: string; jobId?: string }
  | { status: 'running'; jobId: string; message: string; progress: ImageProgress | null; retryable: true }
  | { status: 'error'; message: string; retryable: boolean; jobId?: string };

export interface NativeImageRequest {
  prompt: string;
  negativePrompt?: string | null;
  width?: number | null;
  height?: number | null;
  steps?: number | null;
  signal?: AbortSignal;
  jobId?: string | null;
  onProgress?: (progress: ImageProgress) => void;
}

type Generator = (input: NativeImageRequest) => Promise<NativeImageResult>;

let testGenerator: Generator | null = null;

export function setNativeImageGeneratorForTests(generator: Generator | null): void {
  testGenerator = generator;
}

export function nativeImageSetupMessage(): string {
  return [
    'Nibrexo image engine is not ready, so no image was created.',
    'This is a local worker, not an external image API. On a machine you control, run: python3 scripts/nibrexo-image-engine.py doctor && python3 scripts/nibrexo-image-engine.py serve',
    `Then set NIBREXO_IMAGE_ENGINE_URL=http://127.0.0.1:8788. Loopback does not need a vendor API key. A non-loopback worker also needs NIBREXO_IMAGE_ENGINE_TOKEN, which you generate locally; it is not an OpenAI, Cloudflare, or Pollinations key.`,
    `Model: Stable Diffusion v1.5 (${NIBREXO_IMAGE_MODEL_ID}). License: ${NIBREXO_IMAGE_LICENSE} (https://github.com/CompVis/stable-diffusion/blob/main/LICENSE). Commercial use is permitted with use-based restrictions. It is not Apache-2.0. The model card says the weights are not fit for product use without a safety review.`,
    `Disk: about ${NIBREXO_IMAGE_WEIGHTS_GB} GB in NIBREXO_IMAGE_WEIGHTS_DIR. RAM: ${NIBREXO_IMAGE_MIN_RAM_GB} GB for this worker. A paid GPU is not required and is not called. The published lighter path is stable-diffusion.cpp SD 1.5 q4_0, about 2.0 GB at 512x512 or 1.5 GB with flash attention. It was not run here because the weights could not be downloaded and this machine has under 4 GB RAM.`,
    'Vercel cannot run this model (memory, time, and no persistent weights). Do not point the URL at OpenAI, Cloudflare, Pollinations, Arena, Hugging Face Inference, or api.bfl.ai.',
    'A stored CLOUDFLARE_API_TOKEN or OPENAI_API_KEY is ignored. A token alone does not enable image generation.',
  ].join(' ');
}

export function isExternalImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const blocked = [
    'api.openai.com',
    'openai.com',
    'api.cloudflare.com',
    'cloudflare.com',
    'pollinations.ai',
    'api.deepseek.com',
    'api.search.brave.com',
    'api.bfl.ai',
    'bfl.ai',
    'huggingface.co',
    'hf.co',
  ];
  return blocked.some((item) => host === item || host.endsWith(`.${item}`));
}

export function nativeImageRuntimeConfigured(): boolean {
  if (testGenerator) return true;
  const url = engineUrl();
  if (!url) return false;
  try {
    return !isExternalImageHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function generateNativeImage(input: NativeImageRequest): Promise<NativeImageResult> {
  if (testGenerator) return testGenerator(input);
  const url = engineUrl();
  if (!url) {
    return { status: 'needs_configuration', missing: ['NIBREXO_IMAGE_ENGINE_URL'], message: nativeImageSetupMessage() };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      status: 'needs_configuration',
      missing: ['NIBREXO_IMAGE_ENGINE_URL'],
      message: 'NIBREXO_IMAGE_ENGINE_URL is not a valid http(s) URL. No image was created.',
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      status: 'needs_configuration',
      missing: ['NIBREXO_IMAGE_ENGINE_URL'],
      message: 'The image engine URL must be http or https. No image was created.',
    };
  }
  if (isExternalImageHost(parsed.hostname)) {
    return {
      status: 'needs_configuration',
      missing: ['NIBREXO_IMAGE_ENGINE_URL'],
      message: `Refused ${parsed.hostname}. Nibrexo does not call an external image API. ${nativeImageSetupMessage()}`,
    };
  }
  const token = serverEnv().imageEngineToken;
  if (!isLoopback(parsed.hostname) && !token) {
    return {
      status: 'needs_configuration',
      missing: ['NIBREXO_IMAGE_ENGINE_TOKEN'],
      message:
        'A non-loopback image engine requires NIBREXO_IMAGE_ENGINE_TOKEN, a secret you generate locally and share only with that worker. No vendor API key is used, and the prompt was not sent.',
    };
  }

  const timeoutMs = engineTimeoutMs();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    if (!input.jobId) {
      const health = await requestJson(new URL('/health', parsed), { method: 'GET', headers, signal: input.signal }, 8_000);
      if (health.engine !== NIBREXO_IMAGE_ENGINE_ID) {
        return {
          status: 'needs_configuration',
          missing: ['NIBREXO_IMAGE_ENGINE_URL'],
          message: 'The URL did not identify itself as nibrexo-image-engine. The prompt was not sent and no image was created.',
        };
      }
      if (health.canGenerate !== true) {
        const missing = Array.isArray(health.missing) ? health.missing.filter((item): item is string => typeof item === 'string') : [];
        return {
          status: 'needs_configuration',
          missing: missing.length > 0 ? missing : ['NIBREXO_IMAGE_WEIGHTS_DIR'],
          message: typeof health.message === 'string' ? health.message : nativeImageSetupMessage(),
        };
      }
    }

    const started = input.jobId
      ? { id: input.jobId, status: 'running' }
      : await requestJson(new URL('/v1/jobs', parsed), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: input.prompt.slice(0, 2000),
            negativePrompt: input.negativePrompt ?? '',
            width: input.width ?? 512,
            height: input.height ?? 512,
            steps: input.steps ?? 20,
          }),
          signal: input.signal,
        }, 15_000);

    if (started.status === 'needs_configuration') {
      return {
        status: 'needs_configuration',
        missing: stringList(started.missing),
        message: typeof started.message === 'string' ? started.message : nativeImageSetupMessage(),
      };
    }
    const jobId = typeof started.id === 'string' ? started.id : input.jobId;
    if (!jobId) {
      return { status: 'error', retryable: true, message: 'The image engine did not return a job id. No image was saved.' };
    }
    if (isProgress(started.progress)) input.onProgress?.(started.progress);

    const deadline = Date.now() + timeoutMs;
    let snapshot = started;
    while (snapshot.status === 'queued' || snapshot.status === 'running') {
      if (Date.now() >= deadline) {
        const progress = isProgress(snapshot.progress) ? snapshot.progress : null;
        return {
          status: 'running',
          jobId,
          retryable: true,
          progress,
          message: `${progress?.message ?? 'Image generation is still running.'} Job ${jobId} was not saved. Retry resumes this job and does not start a second one.`,
        };
      }
      await delay(Math.min(500, Math.max(20, deadline - Date.now())), input.signal);
      snapshot = await requestJson(new URL(`/v1/jobs/${jobId}`, parsed), { method: 'GET', headers, signal: input.signal }, 8_000);
      if (isProgress(snapshot.progress)) input.onProgress?.(snapshot.progress);
    }

    if (snapshot.status === 'failed' || snapshot.status === 'error') {
      return {
        status: 'error',
        retryable: snapshot.retryable !== false,
        jobId,
        message: typeof snapshot.message === 'string' ? snapshot.message : 'Image generation failed. No file was saved.',
      };
    }
    if (snapshot.status !== 'completed') {
      return {
        status: 'error',
        retryable: true,
        jobId,
        message: `Unexpected image engine status "${String(snapshot.status)}". No file was saved.`,
      };
    }

    const imageResponse = await fetch(new URL(`/v1/jobs/${jobId}/image`, parsed), {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}`, Accept: 'image/png, image/jpeg, image/webp' } : { Accept: 'image/png, image/jpeg, image/webp' },
      redirect: 'error',
      signal: input.signal,
    });
    if (!imageResponse.ok) {
      return {
        status: 'error',
        retryable: true,
        jobId,
        message: `The engine finished job ${jobId} but did not return an image file (HTTP ${imageResponse.status}). Nothing was saved.`,
      };
    }
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    const inspected = inspectImageBytes(bytes);
    if (!inspected.ok) return { status: 'error', retryable: false, jobId, message: inspected.message };
    const ignored = stringList(snapshot.ignored);
    return {
      status: 'generated',
      bytes,
      mimeType: inspected.mimeType,
      provider: 'nibrexo',
      model: typeof snapshot.model === 'string' ? snapshot.model : NIBREXO_IMAGE_MODEL_ID,
      width: inspected.width,
      height: inspected.height,
      applied: {
        negativePrompt: Boolean(input.negativePrompt) && !ignored.includes('negativePrompt'),
        dimensions: !ignored.includes('dimensions'),
        steps: typeof snapshot.steps === 'number' ? snapshot.steps : input.steps ?? 20,
      },
      ignored,
      sha256: sha256Bytes(bytes),
      jobId,
      progress: isProgress(snapshot.progress) ? snapshot.progress : null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      status: 'error',
      retryable: true,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      message: aborted
        ? 'Image generation was cancelled before a file was returned. No file was saved.'
        : `Nibrexo image engine was not reachable: ${redactSecrets(error instanceof Error ? error.message : 'network error')}. No external image API was called and no file was saved.`,
    };
  }
}

function engineUrl(): string | null {
  return serverEnv().imageEngineUrl;
}

function engineTimeoutMs(): number {
  const parsed = Number(process.env.NIBREXO_IMAGE_ENGINE_TIMEOUT_MS ?? '90000');
  if (!Number.isFinite(parsed)) return 90_000;
  return Math.max(50, Math.min(15 * 60 * 1000, Math.round(parsed)));
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isProgress(value: unknown): value is ImageProgress {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.stage === 'string' && typeof record.message === 'string';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function requestJson(url: URL, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  init.signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      const value = JSON.parse(text) as unknown;
      if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    if (!response.ok && parsed.status == null) {
      throw new Error(`HTTP ${response.status}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

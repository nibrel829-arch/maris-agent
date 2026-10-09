/**
 * Image and video tools for the central Manager.
 *
 * Image bytes are saved only after a provider returns them. Video rendering
 * in Google Vids is assisted: the tool saves a draft package and does not
 * claim an MP4 exists.
 */

import { z } from 'zod';
import { mediaPreviewUrl } from '@/server/content/service';
import { resolveMediaStorage } from '@/server/content/storage';
import { ToolError } from '@/lib/result';
import { ARENA_IMAGE_UNSUPPORTED } from '@/server/integrations/media/image-generation';
import {
  freeImageRuntimeConfigured,
  freeImageSetupMessage,
  generateFreeImage,
} from '@/server/integrations/media/free-image';
import { serverEnv } from '@/lib/env';
import { inspectImageBytes } from '@/server/integrations/media/image-bytes';
import { writeAudit } from '@/server/manager/audit';
import {
  buildVideoDraftPackage,
  renderVideoDraftBody,
  VIDS_ASSISTED_STEPS,
} from '@/server/integrations/media/video-draft';
import type { ContentStatus } from '@/types/domain';
import { readIdempotentOutput, storeIdempotentOutput } from '@/server/manager/idempotency';
import type { ToolContext } from '@/types/manager';
import { defineTool } from './define';

const libraryFields = {
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  caption: z.string().max(500).optional(),
  mediaUrl: z.string().max(1000).optional(),
};

async function saveDraft(
  ctx: ToolContext,
  input: { title: string; body: string; caption?: string; mediaUrl?: string },
) {
  return ctx.repo.contentItems.insert({
    organization_id: ctx.organizationId,
    title: input.title,
    caption: input.caption ?? null,
    body: input.body,
    status: 'DRAFT' as ContentStatus,
    platforms: [],
    media_url: input.mediaUrl ?? null,
    created_by: ctx.actor.userId,
  });
}

const imageInputSchema = z.object({
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(1000).optional(),
  aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional(),
  width: z.number().int().min(256).max(1024).optional(),
  height: z.number().int().min(256).max(1024).optional(),
  steps: z.number().int().min(1).max(30).optional(),
  conceptTitle: z.string().max(200).optional(),
});

const ASPECT: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1024, height: 576 },
  '9:16': { width: 576, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
};

const QUOTA_SCOPE = 'image.generate.quota';
const JOB_SCOPE = 'image.generate.job';

async function withinImageQuota(ctx: ToolContext): Promise<{ ok: true } | { ok: false; message: string }> {
  const limit = serverEnv().imageHourlyLimit;
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const rows = await ctx.repo.memory.list(ctx.organizationId, { limit: 50 });
  const existing = rows.find((row) => row.scope === QUOTA_SCOPE && row.key === 'hourly');
  const stamps = Array.isArray(existing?.value)
    ? existing.value.filter((value): value is number => typeof value === 'number' && now - value < windowMs)
    : [];
  if (stamps.length >= limit) {
    return {
      ok: false,
      message: `This organization already started ${limit} image jobs in the last hour. No additional engine job was started, and no external image API was called.`,
    };
  }
  stamps.push(now);
  if (existing) {
    await ctx.repo.memory.update(existing.id, ctx.organizationId, { value: stamps });
  } else {
    await ctx.repo.memory.insert({
      organization_id: ctx.organizationId,
      scope: QUOTA_SCOPE,
      key: 'hourly',
      value: stamps,
      created_by: ctx.actor.userId,
    });
  }
  return { ok: true };
}

function blockedImage(status: 'needs_configuration' | 'quota_exhausted', message: string, missing: string[] = []) {
  return {
    capabilityStatus: status === 'quota_exhausted' ? ('quota_exhausted' as const) : ('needs_configuration' as const),
    executed: false,
    imageAsset: null,
    arena: ARENA_IMAGE_UNSUPPORTED,
    missingConfig: missing,
    message,
  };
}

async function executeImageGenerate(
  input: z.infer<typeof imageInputSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const cached = await readIdempotentOutput<Record<string, unknown>>(ctx);
  if (cached) return cached;

  const aspect = input.aspectRatio ? ASPECT[input.aspectRatio] : undefined;
  const prompt = [input.prompt, input.conceptTitle ? `Visual concept: ${input.conceptTitle}` : null]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1800);
  const pending = await readImageJob(ctx);
  if (!pending && !freeImageRuntimeConfigured()) {
    const unconfigured = await generateFreeImage({ prompt });
    return blockedImage(
      'needs_configuration',
      unconfigured.status === 'needs_configuration' ? unconfigured.message : freeImageSetupMessage(),
      unconfigured.status === 'needs_configuration' ? unconfigured.missing : ['NIBREXO_IMAGE_ENGINE_URL'],
    );
  }
  if (!pending) {
    const quota = await withinImageQuota(ctx);
    if (!quota.ok) return blockedImage('quota_exhausted', quota.message);
  }

  const generated = await generateFreeImage({
    prompt,
    negativePrompt: input.negativePrompt ?? null,
    width: input.width ?? aspect?.width ?? null,
    height: input.height ?? aspect?.height ?? null,
    steps: input.steps ?? null,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(pending ? { jobId: pending } : {}),
    onProgress: (progress) => ctx.onProgress?.(progress),
  });
  if (generated.status === 'running' && generated.jobId) {
    await writeImageJob(ctx, generated.jobId);
  }
  if ((generated.status === 'error' || generated.status === 'needs_configuration') && generated.jobId) {
    await clearImageJob(ctx);
  }

  if (generated.status === 'needs_configuration') {
    return blockedImage('needs_configuration', generated.message, generated.missing);
  }
  if (generated.status === 'running') {
    throw new ToolError({
      code: 'IMAGE_ENGINE_RUNNING',
      message: generated.message,
      severity: 'warning',
      retryable: true,
      errorClass: 'network',
    });
  }
  if (generated.status === 'error') {
    throw new ToolError({
      code: 'IMAGE_ENGINE_FAILED',
      message: generated.message,
      severity: 'error',
      retryable: generated.retryable,
      errorClass: generated.retryable ? 'network' : 'unknown',
    });
  }

  const inspected = inspectImageBytes(generated.bytes);
  if (!inspected.ok) {
    throw new Error(inspected.message);
  }

  const storage = await resolveMediaStorage(ctx.repo.backend);
  if (!storage.ok) {
    return blockedImage(
      'needs_configuration',
      `${storage.error.message} The provider returned an image, but it was not saved. Retry after storage is configured.`,
    );
  }

  const extension = inspected.mimeType === 'image/jpeg' ? 'jpg' : inspected.mimeType === 'image/webp' ? 'webp' : 'png';
  const filename = `${input.title.slice(0, 40).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'image'}.${extension}`;
  const storagePath = `${ctx.organizationId}/${ctx.idempotencyKey}-${filename}`;
  await storage.data.upload(storagePath, generated.bytes, inspected.mimeType);
  const stored = await storage.data.download(storagePath);
  const storedInspection = stored ? inspectImageBytes(stored.bytes) : { ok: false as const, message: 'missing' };
  if (!stored || stored.bytes.byteLength !== generated.bytes.byteLength || !storedInspection.ok) {
    await storage.data.remove(storagePath);
    throw new Error('The saved file could not be read back as a valid image. It was removed and the step was not marked successful.');
  }

  const media = await ctx.repo.mediaFiles.insert({
    organization_id: ctx.organizationId,
    storage_path: storagePath,
    mime_type: inspected.mimeType,
    size_bytes: stored.bytes.byteLength,
    created_by: ctx.actor.userId,
    task_id: ctx.taskId,
    step_id: ctx.stepId ?? null,
    provider: generated.provider,
    model: generated.model,
    prompt,
    negative_prompt: input.negativePrompt ?? null,
    width: inspected.width,
    height: inspected.height,
    sha256: generated.sha256,
  });
  const mediaUrl = mediaPreviewUrl(media.id);
  const contentItem = await saveDraft(ctx, {
    title: input.title,
    caption: 'Generated image file. Not published.',
    body: [
      `Verified ${inspected.mimeType} file, ${stored.bytes.byteLength} bytes, sha256 ${generated.sha256}.`,
      `Provider: ${generated.provider}. Model: ${generated.model}.`,
      `Task: ${ctx.taskId}. Step: ${ctx.stepId ?? 'unknown'}.`,
      generated.ignored.length > 0 ? `Ignored by this model: ${generated.ignored.join(', ')}.` : null,
      'This is a draft in the Content Library. It has not been published.',
    ]
      .filter(Boolean)
      .join('\n'),
    mediaUrl,
  });
  await writeAudit(ctx.repo, ctx.actor, {
    action: 'content.image_generated',
    entityType: 'media_file',
    entityId: media.id,
    metadata: {
      taskId: ctx.taskId,
      stepId: ctx.stepId ?? null,
      contentItemId: contentItem.id,
      provider: generated.provider,
      model: generated.model,
      bytes: stored.bytes.byteLength,
    },
  });

  const output = {
    capabilityStatus: 'available' as const,
    executed: true,
    generationStatus: 'generated' as const,
    imageAsset: {
      provider: generated.provider,
      model: generated.model,
      mediaId: media.id,
      contentItemId: contentItem.id,
      bytes: stored.bytes.byteLength,
      sha256: generated.sha256,
      mimeType: inspected.mimeType,
    },
    media,
    contentItem,
    message: `Image file saved to the Content Library as ${contentItem.title}. It has not been published.`,
  };
  await storeIdempotentOutput(ctx, output);
  await clearImageJob(ctx);
  return output;
}

async function readImageJob(ctx: ToolContext): Promise<string | null> {
  const rows = await ctx.repo.memory.list(ctx.organizationId, { limit: 50 });
  const existing = rows.find((row) => row.scope === JOB_SCOPE && row.key === ctx.idempotencyKey);
  const value = existing?.value as { jobId?: unknown } | null;
  return typeof value?.jobId === 'string' ? value.jobId : null;
}

async function writeImageJob(ctx: ToolContext, jobId: string): Promise<void> {
  const rows = await ctx.repo.memory.list(ctx.organizationId, { limit: 50 });
  const existing = rows.find((row) => row.scope === JOB_SCOPE && row.key === ctx.idempotencyKey);
  if (existing) {
    await ctx.repo.memory.update(existing.id, ctx.organizationId, { value: { jobId } });
    return;
  }
  await ctx.repo.memory.insert({
    organization_id: ctx.organizationId,
    scope: JOB_SCOPE,
    key: ctx.idempotencyKey,
    value: { jobId },
    created_by: ctx.actor.userId,
  });
}

async function clearImageJob(ctx: ToolContext): Promise<void> {
  const rows = await ctx.repo.memory.list(ctx.organizationId, { limit: 50 });
  const existing = rows.find((row) => row.scope === JOB_SCOPE && row.key === ctx.idempotencyKey);
  if (existing) await ctx.repo.memory.delete(existing.id, ctx.organizationId);
}

export const imageGenerateTool = defineTool({
  name: 'image.generate',
  description:
    'Generate an image with the Nibrexo image engine, verify the bytes, and save the file to the Content Library. Does not call OpenAI, Cloudflare, Arena or Pollinations. A missing worker, missing weights, or insufficient RAM blocks the step; no placeholder image is saved.',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: imageInputSchema,
  execute: executeImageGenerate,
});

export const generateImageAssetTool = defineTool({
  name: 'generate_image_asset',
  description: 'Alias of image.generate. Saves a verified image file, not a prompt.',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: imageInputSchema,
  execute: executeImageGenerate,
});

export const prepareVideoDraftTool = defineTool({
  name: 'prepare_video_draft',
  description:
    'Save a Google Vids draft package (scenes, narration, assisted steps) to the Content Library. Does not render or export a video file.',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    brief: z.string().min(1).max(8000),
  }),
  async execute(input, ctx) {
    const cached = await readIdempotentOutput<Record<string, unknown>>(ctx);
    if (cached) return cached;

    const videoDraft = buildVideoDraftPackage(input);
    const contentItem = await saveDraft(ctx, {
      title: `${input.title} — video draft`,
      caption: 'Google Vids draft package. No video file rendered.',
      body: renderVideoDraftBody(videoDraft),
    });
    const output = {
      capabilityStatus: 'assisted' as const,
      executed: true,
      videoDraft,
      contentItem,
      renderedVideo: null,
      message:
        'Video draft package saved to the Content Library. Google Vids has no public create/edit/export API, so no video file was rendered.',
    };
    await storeIdempotentOutput(ctx, output);
    return output;
  },
});

export const exportVideoFileTool = defineTool({
  name: 'export_video_file',
  description:
    'Would export a rendered video. Google Vids does not offer a public export API, so this step stays assisted and does not create a file.',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
  }),
  async execute(input) {
    return {
      capabilityStatus: 'assisted' as const,
      executed: false,
      title: input.title,
      renderedVideo: null,
      assistedSteps: [...VIDS_ASSISTED_STEPS],
      message: `No video file was exported for "${input.title}". ${VIDS_ASSISTED_STEPS[0]} Remaining steps are assisted in Google Vids. Upload the MP4 to the Content Library when you have reviewed it.`,
    };
  },
});

export const saveLibraryAssetTool = defineTool({
  name: 'save_library_asset',
  description: 'Save a completed text asset to the Content Library as a draft. Does not publish it.',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: z.object(libraryFields),
  async execute(input, ctx) {
    const cached = await readIdempotentOutput<Record<string, unknown>>(ctx);
    if (cached) return cached;
    const contentItem = await saveDraft(ctx, input);
    const output = {
      capabilityStatus: 'available' as const,
      executed: true,
      contentItem,
      message: `Saved "${contentItem.title}" to the Content Library as a draft.`,
    };
    await storeIdempotentOutput(ctx, output);
    return output;
  },
});

export const mediaTools = [
  imageGenerateTool,
  generateImageAssetTool,
  prepareVideoDraftTool,
  exportVideoFileTool,
  saveLibraryAssetTool,
];

/**
 * Content Library validation (Phase 6).
 *
 * One Zod source of truth shared by the API routes and the service layer,
 * following the Phase 5 clients pattern. The browser never supplies
 * `organization_id`, `created_by` or `id`: those keys are absent from every
 * schema, so Zod strips them even if a caller sends them.
 */

import { z } from 'zod';
import {
  CONTENT_PLATFORMS,
  CONTENT_STATUSES,
  DRAFT_LIFECYCLE_STATUSES,
} from '@/features/content/content-statuses';

export { CONTENT_PLATFORMS, CONTENT_STATUSES, DRAFT_LIFECYCLE_STATUSES };

/** Private Storage bucket created by migration 0007. */
export const MEDIA_BUCKET = 'nibrexo-media';

/** 10 MiB per file — matches the bucket `file_size_limit` in 0007. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Must stay identical to the bucket `allowed_mime_types` in 0007. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'application/pdf',
] as const;

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

export function mediaKindFor(mimeType: string): MediaKind | null {
  const normalized = mimeType.trim().toLowerCase();
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(normalized)) return null;
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Strips path separators and unsafe characters so the original filename can
 * travel inside the storage path without directory traversal. The service
 * prefixes the result with a UUID, so collisions are impossible.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return (cleaned || 'file').slice(0, 120);
}

export interface UploadDescriptor {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export function validateUpload(file: UploadDescriptor): { ok: true } | { ok: false; message: string } {
  if (!file.filename || file.filename.trim().length === 0) {
    return { ok: false, message: 'A file is required.' };
  }
  if (file.sizeBytes <= 0) return { ok: false, message: 'The file is empty.' };
  if (file.sizeBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, message: 'Files must be 10 MB or smaller.' };
  }
  if (!mediaKindFor(file.mimeType)) {
    return {
      ok: false,
      message: 'Unsupported file type. Upload an image, video, audio file or PDF.',
    };
  }
  return { ok: true };
}

/** Empty form fields arrive as `''`; treat them as "not supplied". */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const titleSchema = z
  .string()
  .trim()
  .min(1, 'A title is required.')
  .max(200, 'Title must be 200 characters or fewer.');

const captionSchema = z.string().max(5000, 'Caption must be 5000 characters or fewer.');

const bodySchema = z.string().max(20000, 'Body must be 20000 characters or fewer.');

const platformsSchema = z
  .array(z.enum(CONTENT_PLATFORMS))
  .max(7, 'A content item targets at most 7 platforms.');

const mediaUrlSchema = z
  .string()
  .trim()
  .max(1000, 'Media URL must be 1000 characters or fewer.')
  .refine(
    (value) => value.startsWith('/') || /^https?:\/\//i.test(value),
    'Media URL must be a site path or an http(s) URL.',
  );

export const createContentSchema = z.object({
  title: titleSchema,
  caption: z.preprocess(emptyToUndefined, captionSchema.optional()),
  body: z.preprocess(emptyToUndefined, bodySchema.optional()),
  platforms: platformsSchema.default([]),
  media_url: z.preprocess(emptyToUndefined, mediaUrlSchema.optional()),
});

export type CreateContentInput = z.output<typeof createContentSchema>;

export const updateContentSchema = z
  .object({
    title: titleSchema.optional(),
    caption: z.preprocess(emptyToUndefined, captionSchema.optional()),
    body: z.preprocess(emptyToUndefined, bodySchema.optional()),
    platforms: platformsSchema.optional(),
    media_url: z.preprocess(emptyToUndefined, mediaUrlSchema.optional()),
    status: z.enum(DRAFT_LIFECYCLE_STATUSES).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'No changes supplied.',
  });

export type UpdateContentInput = z.output<typeof updateContentSchema>;

export const contentListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
  platform: z.enum(CONTENT_PLATFORMS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type ContentListQuery = z.output<typeof contentListQuerySchema>;

export const mediaListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  kind: z.enum(['image', 'video', 'audio', 'document']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type MediaListQuery = z.output<typeof mediaListQuerySchema>;

export const contentIdSchema = z.string().uuid('Content id must be a valid UUID.');
export const mediaIdSchema = z.string().uuid('Media id must be a valid UUID.');

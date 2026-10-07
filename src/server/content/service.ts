/**
 * Content Library business service (Phase 6).
 *
 * Same pipeline as the Phase 5 clients service (PDF #12 §16):
 *   AUTHENTICATE (actor resolved by the caller) -> AUTHORIZE (permission
 *   guard, organization-scoped) -> VALIDATE INPUT (Zod, in validation.ts)
 *   -> DATABASE / STORAGE (tenant-scoped; table RLS + 0007 storage RLS
 *   underneath) -> LOG (audit log) -> RESPONSE (ServiceResult).
 *
 * Tenancy rules:
 *  - `organization_id` always comes from `actor.organizationId`.
 *  - Storage object paths always start with the organization id, matching
 *    the `nibrexo-media` policies from migration 0007.
 *  - Rows from another organization resolve to NOT_FOUND so existence is
 *    never leaked across tenants.
 */

import { newId } from '@/lib/id';
import { fail, ok, type ServiceResult } from '@/lib/result';
import { checkPermission } from '@/server/auth/permissions';
import type { NibrexoRepository } from '@/server/db/types';
import { writeAudit } from '@/server/manager/audit';
import type {
  ActorContext,
  ContentItem,
  ContentStatus,
  MediaFile,
  UUID,
} from '@/types/domain';
import type { MediaStorage } from './storage';
import {
  mediaKindFor,
  sanitizeFilename,
  validateUpload,
  type ContentListQuery,
  type CreateContentInput,
  type MediaKind,
  type MediaListQuery,
  type UpdateContentInput,
} from './validation';

/** Bounded window for server-side search/filter (same rationale as Phase 5). */
export const CONTENT_LIST_WINDOW = 500;

export interface ContentListResult {
  items: ContentItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface MediaListItem extends MediaFile {
  preview_url: string;
  kind: MediaKind;
  filename: string;
}

export interface MediaListResult {
  items: MediaListItem[];
  total: number;
  limit: number;
  offset: number;
}

export type ResolvedMediaFile =
  | { row: MediaFile; kind: 'bytes'; bytes: Uint8Array; mimeType: string; filename: string }
  | { row: MediaFile; kind: 'redirect'; url: string; filename: string };

/** Single preview-URL contract for both backends (authorized file route). */
export function mediaPreviewUrl(mediaId: string): string {
  return `/api/workspace/content/media/${mediaId}/file`;
}

export function filenameFromStoragePath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return (
    base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || base
  );
}

export function toMediaListItem(row: MediaFile): MediaListItem {
  return {
    ...row,
    preview_url: mediaPreviewUrl(row.id),
    kind: mediaKindFor(row.mime_type) ?? 'document',
    filename: filenameFromStoragePath(row.storage_path),
  };
}

function permissionDenied(actor: ActorContext, action: string) {
  return fail(
    'PERMISSION_DENIED',
    `Role "${actor.role}" does not have "${action}" permission on module "content".`,
    { errorClass: 'permission', severity: 'error' },
  );
}

function notFound(kind: 'CONTENT_NOT_FOUND' | 'MEDIA_NOT_FOUND'): ServiceResult<never> {
  return fail(kind, kind === 'CONTENT_NOT_FOUND' ? 'Content item not found.' : 'Media file not found.', {
    errorClass: 'validation',
    severity: 'warning',
  });
}

/* -------------------------------------------------------------------------- */
/* Content items                                                               */
/* -------------------------------------------------------------------------- */

export async function listContentItems(
  actor: ActorContext,
  repo: NibrexoRepository,
  query: ContentListQuery,
): Promise<ServiceResult<ContentListResult>> {
  if (!checkPermission(actor, { module: 'content', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const items = await repo.contentItems.list(actor.organizationId, {
    limit: CONTENT_LIST_WINDOW,
  });

  const needle = query.search?.trim().toLowerCase() ?? '';
  const filtered = items.filter((item) => {
    if (query.status && item.status !== query.status) return false;
    if (query.platform && !item.platforms.includes(query.platform)) return false;
    if (!needle) return true;
    const haystack = [item.title, item.caption, item.body]
      .filter((field): field is string => typeof field === 'string' && field.length > 0)
      .join(' ')
      .toLowerCase();
    return needle
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .every((token) => haystack.includes(token));
  });

  return ok({
    items: filtered.slice(query.offset, query.offset + query.limit),
    total: filtered.length,
    limit: query.limit,
    offset: query.offset,
  });
}

export async function createContentItem(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: CreateContentInput,
): Promise<ServiceResult<ContentItem>> {
  if (!checkPermission(actor, { module: 'content', action: 'create' }).allowed) {
    return permissionDenied(actor, 'create');
  }

  // Library items are always born as drafts; READY is a deliberate later
  // transition, and publishing statuses belong to Phase 8.
  const item = await repo.contentItems.insert({
    organization_id: actor.organizationId,
    title: input.title.trim(),
    caption: input.caption?.trim() ? input.caption : null,
    body: input.body?.trim() ? input.body : null,
    status: 'DRAFT' as ContentStatus,
    platforms: [...input.platforms],
    media_url: input.media_url?.trim() ? input.media_url.trim() : null,
    created_by: actor.userId,
  });

  await writeAudit(repo, actor, {
    action: 'content.created',
    entityType: 'content_item',
    entityId: item.id,
    metadata: {},
  });

  return ok(item);
}

export async function getContentItem(
  actor: ActorContext,
  repo: NibrexoRepository,
  contentId: UUID,
): Promise<ServiceResult<ContentItem>> {
  if (!checkPermission(actor, { module: 'content', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const item = await repo.contentItems.get(contentId, actor.organizationId);
  if (!item) return notFound('CONTENT_NOT_FOUND');
  return ok(item);
}

export async function updateContentItem(
  actor: ActorContext,
  repo: NibrexoRepository,
  contentId: UUID,
  input: UpdateContentInput,
): Promise<ServiceResult<ContentItem>> {
  if (!checkPermission(actor, { module: 'content', action: 'edit' }).allowed) {
    return permissionDenied(actor, 'edit');
  }

  const existing = await repo.contentItems.get(contentId, actor.organizationId);
  if (!existing) return notFound('CONTENT_NOT_FOUND');

  // Draft lifecycle guard: only DRAFT <-> READY moves through the library.
  // Rows already in a publishing status are managed by later phases.
  if (input.status !== undefined && existing.status !== 'DRAFT' && existing.status !== 'READY') {
    return fail(
      'CONTENT_STATUS_LOCKED',
      `This item is ${existing.status} and can no longer move through the draft lifecycle.`,
      { errorClass: 'validation', severity: 'warning' },
    );
  }

  const patch: Partial<ContentItem> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.caption !== undefined) patch.caption = input.caption?.trim() ? input.caption : null;
  if (input.body !== undefined) patch.body = input.body?.trim() ? input.body : null;
  if (input.platforms !== undefined) patch.platforms = [...input.platforms];
  if (input.media_url !== undefined) {
    patch.media_url = input.media_url?.trim() ? input.media_url.trim() : null;
  }
  if (input.status !== undefined) patch.status = input.status as ContentStatus;

  const changedFields = (Object.keys(patch) as Array<keyof ContentItem>).filter(
    (field) => JSON.stringify(patch[field] ?? null) !== JSON.stringify(existing[field] ?? null),
  );

  const updated = await repo.contentItems.update(contentId, actor.organizationId, patch);
  if (!updated) return notFound('CONTENT_NOT_FOUND');

  if (changedFields.length > 0) {
    await writeAudit(repo, actor, {
      action: 'content.updated',
      entityType: 'content_item',
      entityId: contentId,
      metadata: { changedFields },
    });
  }

  return ok(updated);
}

export async function deleteContentItem(
  actor: ActorContext,
  repo: NibrexoRepository,
  contentId: UUID,
): Promise<ServiceResult<{ deleted: true }>> {
  if (!checkPermission(actor, { module: 'content', action: 'delete' }).allowed) {
    return permissionDenied(actor, 'delete');
  }

  const existing = await repo.contentItems.get(contentId, actor.organizationId);
  if (!existing) return notFound('CONTENT_NOT_FOUND');

  // Attached media bytes are intentionally NOT cascade-deleted: one upload
  // may back several drafts, and media has its own lifecycle below.
  await repo.contentItems.delete(contentId, actor.organizationId);
  await writeAudit(repo, actor, {
    action: 'content.deleted',
    entityType: 'content_item',
    entityId: contentId,
    metadata: { title: existing.title },
  });

  return ok({ deleted: true as const });
}

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

export async function listMedia(
  actor: ActorContext,
  repo: NibrexoRepository,
  query: MediaListQuery,
): Promise<ServiceResult<MediaListResult>> {
  if (!checkPermission(actor, { module: 'content', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const rows = await repo.mediaFiles.list(actor.organizationId, {
    limit: CONTENT_LIST_WINDOW,
  });

  const needle = query.search?.trim().toLowerCase() ?? '';
  const filtered = rows.filter((row) => {
    const kind = mediaKindFor(row.mime_type) ?? 'document';
    if (query.kind && kind !== query.kind) return false;
    if (!needle) return true;
    const haystack =
      `${filenameFromStoragePath(row.storage_path)} ${row.mime_type}`.toLowerCase();
    return needle
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .every((token) => haystack.includes(token));
  });

  return ok({
    items: filtered
      .slice(query.offset, query.offset + query.limit)
      .map(toMediaListItem),
    total: filtered.length,
    limit: query.limit,
    offset: query.offset,
  });
}

export async function getMedia(
  actor: ActorContext,
  repo: NibrexoRepository,
  mediaId: UUID,
): Promise<ServiceResult<MediaListItem>> {
  if (!checkPermission(actor, { module: 'content', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const row = await repo.mediaFiles.get(mediaId, actor.organizationId);
  if (!row) return notFound('MEDIA_NOT_FOUND');
  return ok(toMediaListItem(row));
}

export interface UploadInput {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function uploadMedia(
  actor: ActorContext,
  repo: NibrexoRepository,
  storage: MediaStorage,
  input: UploadInput,
): Promise<ServiceResult<MediaListItem>> {
  if (!checkPermission(actor, { module: 'content', action: 'create' }).allowed) {
    return permissionDenied(actor, 'create');
  }

  const valid = validateUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
  });
  if (!valid.ok) {
    return fail('INVALID_UPLOAD', valid.message, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  const mimeType = input.mimeType.trim().toLowerCase();
  const storagePath = `${actor.organizationId}/${newId()}-${sanitizeFilename(input.filename)}`;

  try {
    await storage.upload(storagePath, input.bytes, mimeType);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Media upload failed.';
    if (/row-level security/i.test(message)) return permissionDenied(actor, 'create');
    return fail('MEDIA_STORE_ERROR', 'The file could not be stored. Try again.', {
      errorClass: 'server',
      severity: 'error',
    });
  }

  let row: MediaFile;
  try {
    row = await repo.mediaFiles.insert({
      organization_id: actor.organizationId,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: input.bytes.byteLength,
      created_by: actor.userId,
    });
  } catch (error) {
    // Never leave orphan bytes behind a failed row write.
    try {
      await storage.remove(storagePath);
    } catch {
      // Best effort; the row write error below is what matters.
    }
    throw error;
  }

  await writeAudit(repo, actor, {
    action: 'media.uploaded',
    entityType: 'media_file',
    entityId: row.id,
    metadata: { mimeType, sizeBytes: row.size_bytes },
  });

  return ok(toMediaListItem(row));
}

export async function resolveMediaFile(
  actor: ActorContext,
  repo: NibrexoRepository,
  storage: MediaStorage,
  mediaId: UUID,
): Promise<ServiceResult<ResolvedMediaFile>> {
  if (!checkPermission(actor, { module: 'content', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const row = await repo.mediaFiles.get(mediaId, actor.organizationId);
  if (!row) return notFound('MEDIA_NOT_FOUND');

  const filename = filenameFromStoragePath(row.storage_path);

  if (storage.backend === 'memory') {
    const stored = await storage.download(row.storage_path);
    if (!stored) return notFound('MEDIA_NOT_FOUND');
    return ok({ row, kind: 'bytes', bytes: stored.bytes, mimeType: row.mime_type, filename });
  }

  try {
    const url = await storage.createSignedUrl(row.storage_path, 3600);
    if (!url) return notFound('MEDIA_NOT_FOUND');
    return ok({ row, kind: 'redirect', url, filename });
  } catch {
    return fail('MEDIA_STORE_ERROR', 'The file preview is temporarily unavailable.', {
      errorClass: 'server',
      severity: 'error',
      retryable: true,
    });
  }
}

export async function deleteMedia(
  actor: ActorContext,
  repo: NibrexoRepository,
  storage: MediaStorage,
  mediaId: UUID,
): Promise<ServiceResult<{ deleted: true }>> {
  if (!checkPermission(actor, { module: 'content', action: 'delete' }).allowed) {
    return permissionDenied(actor, 'delete');
  }

  const row = await repo.mediaFiles.get(mediaId, actor.organizationId);
  if (!row) return notFound('MEDIA_NOT_FOUND');

  try {
    await storage.remove(row.storage_path);
  } catch {
    // Bytes are best-effort; the tenant-scoped row delete below is the
    // authoritative removal. A stray object stays unreadable without its row.
  }
  await repo.mediaFiles.delete(mediaId, actor.organizationId);

  await writeAudit(repo, actor, {
    action: 'media.deleted',
    entityType: 'media_file',
    entityId: mediaId,
    metadata: { storagePath: row.storage_path },
  });

  return ok({ deleted: true as const });
}

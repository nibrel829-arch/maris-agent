import { describe, expect, it } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import {
  createContentItem,
  deleteContentItem,
  deleteMedia,
  getContentItem,
  getMedia,
  listContentItems,
  listMedia,
  resolveMediaFile,
  updateContentItem,
  uploadMedia,
} from '@/server/content/service';
import { createMemoryMediaStorage } from '@/server/content/storage';
import {
  contentListQuerySchema,
  createContentSchema,
  mediaListQuerySchema,
  updateContentSchema,
} from '@/server/content/validation';

/**
 * Phase 6 library lifecycle through the real path:
 * validate -> authorize -> tenant-scoped rows + bytes -> audit.
 * Bytes use the memory backend here; Supabase Storage + the 0007 RLS
 * policies provide the same tenant boundary in production.
 */
describe('Content Library lifecycle', () => {
  it('runs upload -> draft -> attach -> lifecycle -> delete with tenant isolation', async () => {
    const store = repo();
    const storage = createMemoryMediaStorage();
    const owner = actor();
    const otherOwner = actor({ organizationId: OTHER_ORG });
    const bytes = new TextEncoder().encode('fake-image-bytes');

    // Upload.
    const uploaded = await uploadMedia(owner, store, storage, {
      filename: 'launch-hero.png',
      mimeType: 'image/png',
      bytes,
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    // Draft with the media attached.
    const created = await createContentItem(
      owner,
      store,
      createContentSchema.parse({
        title: 'Launch announcement',
        caption: 'We are live.',
        body: 'Longer story…',
        platforms: ['linkedin', 'instagram'],
        media_url: uploaded.data.preview_url,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.status).toBe('DRAFT');
    expect(created.data.media_url).toBe(uploaded.data.preview_url);

    // Attached bytes resolve for the same organization.
    const mediaRow = await getMedia(owner, store, uploaded.data.id);
    expect(mediaRow.ok).toBe(true);
    const resolved = await resolveMediaFile(owner, store, storage, uploaded.data.id);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || resolved.data.kind !== 'bytes') return;
    expect(resolved.data.bytes).toEqual(bytes);

    // Lifecycle: DRAFT -> READY -> DRAFT.
    const ready = await updateContentItem(
      owner,
      store,
      created.data.id,
      updateContentSchema.parse({ status: 'READY' }),
    );
    expect(ready.ok && ready.data.status).toBe('READY');
    const back = await updateContentItem(
      owner,
      store,
      created.data.id,
      updateContentSchema.parse({ status: 'DRAFT' }),
    );
    expect(back.ok && back.data.status).toBe('DRAFT');

    // Library queries see the new records.
    const drafts = await listContentItems(owner, store, contentListQuerySchema.parse({ search: 'launch' }));
    expect(drafts.ok && drafts.data.total).toBe(1);
    const media = await listMedia(owner, store, mediaListQuerySchema.parse({ kind: 'image' }));
    expect(media.ok && media.data.total).toBe(1);

    // The other organization sees nothing and touches nothing.
    const foreignDrafts = await listContentItems(otherOwner, store, contentListQuerySchema.parse({}));
    expect(foreignDrafts.ok && foreignDrafts.data.total).toBe(0);
    const foreignMedia = await listMedia(otherOwner, store, mediaListQuerySchema.parse({}));
    expect(foreignMedia.ok && foreignMedia.data.total).toBe(0);
    expect((await getContentItem(otherOwner, store, created.data.id)).ok).toBe(false);
    expect((await resolveMediaFile(otherOwner, store, storage, uploaded.data.id)).ok).toBe(false);
    expect(
      (await deleteMedia(otherOwner, store, storage, uploaded.data.id)).ok,
    ).toBe(false);

    // Deletes remove rows (media bytes too) without touching the other org.
    expect((await deleteMedia(owner, store, storage, uploaded.data.id)).ok).toBe(true);
    expect((await deleteContentItem(owner, store, created.data.id)).ok).toBe(true);
    expect(await store.contentItems.list(TEST_ORG)).toEqual([]);
    expect(await store.mediaFiles.list(TEST_ORG)).toEqual([]);
  });

  it('rejects invalid input before touching rows or bytes', async () => {
    const store = repo();
    const storage = createMemoryMediaStorage();

    expect(() => createContentSchema.parse({ title: '' })).toThrow();
    expect(() => updateContentSchema.parse({ status: 'PUBLISHED' })).toThrow();

    const bad = await uploadMedia(actor(), store, storage, {
      filename: 'evil.html',
      mimeType: 'text/html',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(bad.ok).toBe(false);

    expect(await store.contentItems.list(TEST_ORG)).toEqual([]);
    expect(await store.mediaFiles.list(TEST_ORG)).toEqual([]);
  });
});

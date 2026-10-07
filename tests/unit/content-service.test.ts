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

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const draft = (overrides: Record<string, unknown> = {}) =>
  createContentSchema.parse({ title: 'Launch post', ...overrides });

describe('Content service', () => {
  it('creates drafts as DRAFT scoped to the actor organization', async () => {
    const store = repo();
    const owner = actor();
    const result = await createContentItem(
      owner,
      store,
      draft({ caption: 'Hi', platforms: ['linkedin'] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('DRAFT');
    expect(result.data.organization_id).toBe(TEST_ORG);
    expect(result.data.created_by).toBe(owner.userId);

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(
      audit.some(
        (entry) => entry.action === 'content.created' && entry.entity_id === result.data.id,
      ),
    ).toBe(true);
  });

  it('denies creation for view-only roles and writes nothing', async () => {
    const store = repo();
    const result = await createContentItem(actor({ role: 'client' }), store, draft());
    expect(result.ok).toBe(false);
    expect(await store.contentItems.list(TEST_ORG)).toEqual([]);
  });

  it('moves drafts through DRAFT <-> READY and audits updates', async () => {
    const store = repo();
    const owner = actor();
    const created = await createContentItem(owner, store, draft());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const ready = await updateContentItem(
      owner,
      store,
      created.data.id,
      updateContentSchema.parse({ status: 'READY' }),
    );
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.data.status).toBe('READY');

    const back = await updateContentItem(
      owner,
      store,
      created.data.id,
      updateContentSchema.parse({ status: 'DRAFT', caption: 'Reworked' }),
    );
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data.status).toBe('DRAFT');
    expect(back.data.caption).toBe('Reworked');

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(audit.some((entry) => entry.action === 'content.updated')).toBe(true);
  });

  it('locks status changes once an item leaves the draft lifecycle', async () => {
    const store = repo();
    const owner = actor();
    const seeded = await store.contentItems.insert({
      organization_id: TEST_ORG,
      title: 'Published piece',
      caption: null,
      body: null,
      status: 'PUBLISHED',
      platforms: [],
      media_url: null,
      created_by: owner.userId,
    });

    const locked = await updateContentItem(
      owner,
      store,
      seeded.id,
      updateContentSchema.parse({ status: 'DRAFT' }),
    );
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.error.code).toBe('CONTENT_STATUS_LOCKED');

    // Field edits are still allowed; only the lifecycle move is refused.
    const edited = await updateContentItem(
      owner,
      store,
      seeded.id,
      updateContentSchema.parse({ caption: 'Typo fix' }),
    );
    expect(edited.ok).toBe(true);
  });

  it('deletes drafts for owners but not members, and never cross-tenant', async () => {
    const store = repo();
    const owner = actor();
    const created = await createContentItem(owner, store, draft({ title: 'Doomed' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const memberDenied = await deleteContentItem(
      actor({ role: 'member' }),
      store,
      created.data.id,
    );
    expect(memberDenied.ok).toBe(false);

    const outsiderDenied = await deleteContentItem(
      actor({ organizationId: OTHER_ORG }),
      store,
      created.data.id,
    );
    expect(outsiderDenied.ok).toBe(false);

    expect(await store.contentItems.get(created.data.id, TEST_ORG)).not.toBeNull();

    const deleted = await deleteContentItem(owner, store, created.data.id);
    expect(deleted.ok).toBe(true);
    expect(await store.contentItems.get(created.data.id, TEST_ORG)).toBeNull();

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(audit.some((entry) => entry.action === 'content.deleted')).toBe(true);
  });

  it('keeps content reads, updates and lists inside the organization', async () => {
    const store = repo();
    const created = await createContentItem(actor(), store, draft({ title: 'Org A draft' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outsider = actor({ organizationId: OTHER_ORG });
    expect((await getContentItem(outsider, store, created.data.id)).ok).toBe(false);
    expect(
      (
        await updateContentItem(
          outsider,
          store,
          created.data.id,
          updateContentSchema.parse({ title: 'Hijacked' }),
        )
      ).ok,
    ).toBe(false);

    const foreignList = await listContentItems(outsider, store, contentListQuerySchema.parse({}));
    expect(foreignList.ok).toBe(true);
    if (!foreignList.ok) return;
    expect(foreignList.data.total).toBe(0);
  });

  it('filters drafts by search, status and platform with pagination', async () => {
    const store = repo();
    const owner = actor();
    await createContentItem(owner, store, draft({ title: 'LinkedIn launch', platforms: ['linkedin'] }));
    const second = await createContentItem(
      owner,
      store,
      draft({ title: 'TikTok teaser', caption: 'launch day', platforms: ['tiktok'] }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await updateContentItem(owner, store, second.data.id, updateContentSchema.parse({ status: 'READY' }));

    const searched = await listContentItems(
      owner,
      store,
      contentListQuerySchema.parse({ search: 'launch' }),
    );
    expect(searched.ok && searched.data.total).toBe(2);

    const ready = await listContentItems(owner, store, contentListQuerySchema.parse({ status: 'READY' }));
    expect(ready.ok && ready.data.total).toBe(1);

    const tiktok = await listContentItems(
      owner,
      store,
      contentListQuerySchema.parse({ platform: 'tiktok' }),
    );
    expect(tiktok.ok && tiktok.data.total).toBe(1);

    const page = await listContentItems(owner, store, contentListQuerySchema.parse({ limit: '1', offset: '1' }));
    expect(page.ok && page.data.items).toHaveLength(1);
    expect(page.ok && page.data.total).toBe(2);
  });

  it('uploads media under org-prefixed paths and serves it back', async () => {
    const store = repo();
    const storage = createMemoryMediaStorage();
    const owner = actor();

    const uploaded = await uploadMedia(owner, store, storage, {
      filename: 'hero.png',
      mimeType: 'image/png',
      bytes: PNG,
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    expect(uploaded.data.organization_id).toBe(TEST_ORG);
    expect(uploaded.data.storage_path.startsWith(`${TEST_ORG}/`)).toBe(true);
    expect(uploaded.data.kind).toBe('image');
    expect(uploaded.data.filename).toBe('hero.png');
    expect(uploaded.data.preview_url).toBe(`/api/workspace/content/media/${uploaded.data.id}/file`);

    const resolved = await resolveMediaFile(owner, store, storage, uploaded.data.id);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || resolved.data.kind !== 'bytes') return;
    expect(resolved.data.bytes).toEqual(PNG);
    expect(resolved.data.mimeType).toBe('image/png');

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(audit.some((entry) => entry.action === 'media.uploaded')).toBe(true);
  });

  it('rejects hostile uploads and unauthorized uploaders', async () => {
    const store = repo();
    const storage = createMemoryMediaStorage();

    const badMime = await uploadMedia(actor(), store, storage, {
      filename: 'run.sh',
      mimeType: 'application/x-sh',
      bytes: PNG,
    });
    expect(badMime.ok).toBe(false);

    const tooBig = await uploadMedia(actor(), store, storage, {
      filename: 'huge.png',
      mimeType: 'image/png',
      bytes: new Uint8Array(11 * 1024 * 1024),
    });
    expect(tooBig.ok).toBe(false);

    const viewerDenied = await uploadMedia(actor({ role: 'client' }), store, storage, {
      filename: 'hero.png',
      mimeType: 'image/png',
      bytes: PNG,
    });
    expect(viewerDenied.ok).toBe(false);

    expect(await store.mediaFiles.list(TEST_ORG)).toEqual([]);
  });

  it('isolates media rows and bytes by organization', async () => {
    const store = repo();
    const storage = createMemoryMediaStorage();
    const uploaded = await uploadMedia(actor(), store, storage, {
      filename: 'secret.png',
      mimeType: 'image/png',
      bytes: PNG,
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const outsider = actor({ organizationId: OTHER_ORG });
    expect((await getMedia(outsider, store, uploaded.data.id)).ok).toBe(false);
    expect((await resolveMediaFile(outsider, store, storage, uploaded.data.id)).ok).toBe(false);

    const foreignList = await listMedia(outsider, store, mediaListQuerySchema.parse({}));
    expect(foreignList.ok && foreignList.data.total).toBe(0);
  });

  it('filters media by kind and deletes rows plus bytes for owners', async () => {
    const store = repo();
    const storage = createMemoryMediaStorage();
    const owner = actor();

    const image = await uploadMedia(owner, store, storage, {
      filename: 'a.png',
      mimeType: 'image/png',
      bytes: PNG,
    });
    const doc = await uploadMedia(owner, store, storage, {
      filename: 'b.pdf',
      mimeType: 'application/pdf',
      bytes: PNG,
    });
    expect(image.ok && doc.ok).toBe(true);
    if (!image.ok || !doc.ok) return;

    const images = await listMedia(owner, store, mediaListQuerySchema.parse({ kind: 'image' }));
    expect(images.ok && images.data.total).toBe(1);

    const memberDenied = await deleteMedia(actor({ role: 'member' }), store, storage, image.data.id);
    expect(memberDenied.ok).toBe(false);

    const deleted = await deleteMedia(owner, store, storage, image.data.id);
    expect(deleted.ok).toBe(true);
    expect(await store.mediaFiles.get(image.data.id, TEST_ORG)).toBeNull();
    expect((await resolveMediaFile(owner, store, storage, image.data.id)).ok).toBe(false);

    // The other file is untouched.
    expect((await getMedia(owner, store, doc.data.id)).ok).toBe(true);
  });
});

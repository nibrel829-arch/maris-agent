import { describe, expect, it } from 'vitest';
import {
  contentIdSchema,
  contentListQuerySchema,
  createContentSchema,
  mediaIdSchema,
  mediaKindFor,
  mediaListQuerySchema,
  sanitizeFilename,
  updateContentSchema,
  validateUpload,
} from '@/server/content/validation';

describe('Content validation', () => {
  it('accepts a minimal draft payload with defaults', () => {
    const parsed = createContentSchema.parse({ title: 'Launch post' });
    expect(parsed.title).toBe('Launch post');
    expect(parsed.platforms).toEqual([]);
    expect(parsed.caption).toBeUndefined();
    expect(parsed.media_url).toBeUndefined();
  });

  it('never accepts a status or tenancy keys on create', () => {
    const parsed = createContentSchema.parse({
      title: 'Sneaky',
      status: 'PUBLISHED',
      organization_id: '00000000-0000-0000-0000-000000000002',
      created_by: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('organization_id');
    expect(parsed).not.toHaveProperty('created_by');
  });

  it('accepts the full draft field set', () => {
    const parsed = createContentSchema.parse({
      title: 'Launch post',
      caption: 'Short caption',
      body: 'Longer body text.',
      platforms: ['linkedin', 'instagram'],
      media_url: '/api/workspace/content/media/00000000-0000-0000-0000-000000000001/file',
    });
    expect(parsed.platforms).toEqual(['linkedin', 'instagram']);
  });

  it('rejects invalid draft payloads with useful messages', () => {
    expect(() => createContentSchema.parse({ title: '' })).toThrow('A title is required.');
    expect(() => createContentSchema.parse({ title: 'X', caption: 'c'.repeat(5001) })).toThrow(
      'Caption must be 5000 characters or fewer.',
    );
    expect(() => createContentSchema.parse({ title: 'X', body: 'b'.repeat(20001) })).toThrow(
      'Body must be 20000 characters or fewer.',
    );
    expect(() => createContentSchema.parse({ title: 'X', platforms: ['myspace'] })).toThrow();
    expect(() =>
      createContentSchema.parse({ title: 'X', platforms: ['tiktok', 'tiktok', 'tiktok', 'tiktok', 'tiktok', 'tiktok', 'tiktok', 'tiktok'] }),
    ).toThrow();
    expect(() => createContentSchema.parse({ title: 'X', media_url: 'ftp://x/y' })).toThrow(
      'Media URL must be a site path or an http(s) URL.',
    );
  });

  it('accepts only draft-lifecycle transitions on update', () => {
    expect(() => updateContentSchema.parse({})).toThrow('No changes supplied.');
    expect(updateContentSchema.parse({ status: 'READY' }).status).toBe('READY');
    expect(updateContentSchema.parse({ status: 'DRAFT' }).status).toBe('DRAFT');
    expect(() => updateContentSchema.parse({ status: 'PUBLISHED' })).toThrow();
    expect(() => updateContentSchema.parse({ status: 'SCHEDULED' })).toThrow();
  });

  it('coerces list queries with safe bounds', () => {
    const content = contentListQuerySchema.parse({
      search: 'launch',
      status: 'READY',
      platform: 'linkedin',
      limit: '10',
      offset: '5',
    });
    expect(content).toMatchObject({
      search: 'launch',
      status: 'READY',
      platform: 'linkedin',
      limit: 10,
      offset: 5,
    });
    expect(contentListQuerySchema.parse({})).toMatchObject({ limit: 20, offset: 0 });
    expect(() => contentListQuerySchema.parse({ status: 'ARCHIVED' })).toThrow();
    expect(() => contentListQuerySchema.parse({ platform: 'myspace' })).toThrow();
    expect(() => contentListQuerySchema.parse({ limit: '500' })).toThrow();

    const media = mediaListQuerySchema.parse({ kind: 'image', limit: '5' });
    expect(media).toMatchObject({ kind: 'image', limit: 5, offset: 0 });
    expect(mediaListQuerySchema.parse({})).toMatchObject({ limit: 12, offset: 0 });
    expect(() => mediaListQuerySchema.parse({ kind: 'hologram' })).toThrow();
  });

  it('validates content and media ids', () => {
    expect(contentIdSchema.safeParse('nope').success).toBe(false);
    expect(mediaIdSchema.safeParse('nope').success).toBe(false);
    expect(contentIdSchema.safeParse('00000000-0000-0000-0000-000000000001').success).toBe(true);
  });

  it('maps mime types to kinds and rejects the rest', () => {
    expect(mediaKindFor('image/png')).toBe('image');
    expect(mediaKindFor('video/mp4')).toBe('video');
    expect(mediaKindFor('audio/mpeg')).toBe('audio');
    expect(mediaKindFor('application/pdf')).toBe('document');
    expect(mediaKindFor('IMAGE/JPEG')).toBe('image');
    expect(mediaKindFor('application/x-sh')).toBeNull();
    expect(mediaKindFor('text/html')).toBeNull();
    expect(mediaKindFor('')).toBeNull();
  });

  it('validates uploads before any byte moves', () => {
    expect(validateUpload({ filename: '', mimeType: 'image/png', sizeBytes: 10 }).ok).toBe(false);
    expect(validateUpload({ filename: 'x.png', mimeType: 'image/png', sizeBytes: 0 })).toMatchObject({
      ok: false,
    });
    expect(
      validateUpload({ filename: 'x.png', mimeType: 'image/png', sizeBytes: 11 * 1024 * 1024 }),
    ).toMatchObject({ ok: false, message: 'Files must be 10 MB or smaller.' });
    expect(
      validateUpload({ filename: 'x.sh', mimeType: 'application/x-sh', sizeBytes: 10 }),
    ).toMatchObject({ ok: false });
    expect(validateUpload({ filename: 'x.png', mimeType: 'image/png', sizeBytes: 10 })).toEqual({
      ok: true,
    });
  });

  it('sanitizes filenames against traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a\\b\\evil.png')).toBe('evil.png');
    expect(sanitizeFilename('My Photo (1).PNG')).toBe('My-Photo-1-.PNG');
    expect(sanitizeFilename('...')).toBe('file');
    expect(sanitizeFilename('').length).toBeGreaterThan(0);
  });
});

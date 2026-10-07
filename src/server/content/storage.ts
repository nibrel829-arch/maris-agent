/**
 * Media byte storage (Phase 6).
 *
 * Two backends behind one interface:
 *  - SupabaseMediaStorage — production. Talks to the private `nibrexo-media`
 *    bucket through the caller's session, so the 0007 storage RLS policies
 *    apply (org-prefixed paths only).
 *  - MemoryMediaStorage — local development and tests ONLY. Refused in
 *    production via the same rule as the memory repository, with a bounded
 *    total size so a dev process cannot grow without limit.
 *
 * Row metadata (`media_files`) always lives in the NibrexoRepository; this
 * module only moves bytes.
 */

import { serverEnv } from '@/lib/env';
import { fail, ok, type ServiceResult } from '@/lib/result';
import { createSupabaseServerClient } from '@/server/db/supabase';
import type { NibrexoSupabaseClient } from '@/server/db/supabase';
import { MEDIA_BUCKET } from './validation';

/** Total bytes the dev-only memory backend will hold. */
export const MEMORY_STORAGE_CAP_BYTES = 50 * 1024 * 1024;

/** Signed-URL lifetime for private-bucket previews (seconds). */
export const SIGNED_URL_EXPIRES_IN = 3600;

export interface StoredBytes {
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
}

export interface MediaStorage {
  readonly backend: 'supabase' | 'memory';
  upload(path: string, data: Uint8Array, mimeType: string): Promise<void>;
  download(path: string): Promise<StoredBytes | null>;
  remove(path: string): Promise<void>;
  /**
   * Direct-download URL. Supabase returns a signed bucket URL; memory returns
   * null because bytes are served through the authorized file route instead.
   */
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string | null>;
}

export function createMemoryMediaStorage(): MediaStorage {
  const blobs = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  let totalBytes = 0;

  return {
    backend: 'memory',

    async upload(path, data, mimeType) {
      const previous = blobs.get(path);
      const nextTotal = totalBytes - (previous?.bytes.byteLength ?? 0) + data.byteLength;
      if (nextTotal > MEMORY_STORAGE_CAP_BYTES) {
        throw new Error('Local media storage is full (50 MB development cap).');
      }
      blobs.set(path, { bytes: data.slice(), mimeType });
      totalBytes = nextTotal;
    },

    async download(path) {
      const entry = blobs.get(path);
      if (!entry) return null;
      return { bytes: entry.bytes.slice(), mimeType: entry.mimeType, sizeBytes: entry.bytes.byteLength };
    },

    async remove(path) {
      const entry = blobs.get(path);
      if (entry) {
        totalBytes -= entry.bytes.byteLength;
        blobs.delete(path);
      }
    },

    async createSignedUrl() {
      return null;
    },
  };
}

export function createSupabaseMediaStorage(client: NibrexoSupabaseClient): MediaStorage {
  const bucket = () => client.storage.from(MEDIA_BUCKET);

  return {
    backend: 'supabase',

    async upload(path, data, mimeType) {
      const { error } = await bucket().upload(path, data, {
        contentType: mimeType,
        upsert: false,
      });
      if (error) throw new Error(`Media upload failed: ${error.message}`);
    },

    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error) {
        if (/not found|does not exist/i.test(error.message)) return null;
        throw new Error(`Media download failed: ${error.message}`);
      }
      const buffer = new Uint8Array(await data.arrayBuffer());
      return { bytes: buffer, mimeType: data.type || 'application/octet-stream', sizeBytes: buffer.byteLength };
    },

    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw new Error(`Media delete failed: ${error.message}`);
    },

    async createSignedUrl(path, expiresInSeconds) {
      const { data, error } = await bucket().createSignedUrl(path, expiresInSeconds);
      if (error) throw new Error(`Preview URL failed: ${error.message}`);
      return data.signedUrl;
    },
  };
}

/** Process-wide memory blob store so dev sessions share uploads across requests. */
const globalForMediaBlobs = globalThis as unknown as { __nibrexoMediaStorage?: MediaStorage };

function memoryMediaStorage(): MediaStorage {
  if (!globalForMediaBlobs.__nibrexoMediaStorage) {
    globalForMediaBlobs.__nibrexoMediaStorage = createMemoryMediaStorage();
  }
  return globalForMediaBlobs.__nibrexoMediaStorage;
}

/**
 * Byte storage bound to the current request. Mirrors the repository factory
 * rules: memory only outside production, otherwise the session-bound
 * Supabase client (RLS enforced), otherwise a structured NOT_CONFIGURED.
 */
export async function getRequestMediaStorage(): Promise<ServiceResult<MediaStorage>> {
  const env = serverEnv();

  if (env.dataBackend === 'memory') {
    return ok(memoryMediaStorage());
  }

  const client = await createSupabaseServerClient();
  if (!client) {
    return fail(
      'SUPABASE_NOT_CONFIGURED',
      'Supabase Storage is not configured. Set the Supabase environment variables, or set NIBREXO_DATA_BACKEND=memory for local development.',
      { severity: 'warning', retryable: false, errorClass: 'not_configured' },
    );
  }
  return ok(createSupabaseMediaStorage(client));
}

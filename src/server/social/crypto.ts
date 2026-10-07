/**
 * Token protection for social account connections (Phase 7).
 *
 * Provider access/refresh tokens are encrypted at rest with AES-256-GCM and a
 * server-only key (`NIBREXO_TOKEN_ENCRYPTION_KEY`). Ciphertext, IVs and hashes
 * are the only things that ever reach the database, logs or error messages —
 * plaintext tokens stay inside the service call that needs them.
 *
 * Payload format: `v1.<base64url-iv>.<base64url-ciphertext+tag>`.
 * The `v1` prefix is the key version; it is also what `credential_ref` holds
 * on `social_credentials` rows so a future rotation can tell keys apart.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import type { ManagerIssue } from '@/types/manager';

export const TOKEN_KEY_VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface TokenKeyring {
  version: typeof TOKEN_KEY_VERSION;
  key: Buffer;
}

function serverError(message: string): ManagerIssue {
  return {
    code: 'TOKEN_KEY_NOT_CONFIGURED',
    message,
    severity: 'error',
    retryable: false,
    errorClass: 'not_configured',
  };
}

/**
 * Parses a 32-byte key from hex (64 chars) or base64. Returns null for any
 * other shape rather than deriving or padding — a misconfigured key must fail
 * loudly, never silently weaken encryption.
 */
export function parseTokenKey(raw: string | null | undefined): TokenKeyring | null {
  const value = raw?.trim();
  if (!value) return null;

  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, 'hex');
  } else {
    try {
      const decoded = Buffer.from(value, 'base64');
      if (decoded.length === KEY_BYTES && value.replace(/\s/g, '').length >= 43) {
        key = decoded;
      }
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== KEY_BYTES) return null;
  return { version: TOKEN_KEY_VERSION, key };
}

let ephemeralKeyring: TokenKeyring | null = null;
let ephemeralWarned = false;

/**
 * Resolves the keyring for token encryption. Production refuses to run
 * without an explicit key. Outside production an ephemeral process key is
 * generated (tokens do not survive restarts there) so local development and
 * tests never need a real secret.
 */
export function resolveTokenKeyring(overrides?: {
  rawKey?: string | null;
  isProduction?: boolean;
}): { ok: true; keyring: TokenKeyring } | { ok: false; error: ManagerIssue } {
  const raw = overrides?.rawKey !== undefined ? overrides.rawKey : serverEnv().tokenEncryptionKey;
  const parsed = parseTokenKey(raw ?? undefined);
  if (parsed) return { ok: true, keyring: parsed };

  const production = overrides?.isProduction ?? serverEnv().isProduction;
  if (production) {
    return {
      ok: false,
      error: serverError(
        'Token encryption is not configured. Set NIBREXO_TOKEN_ENCRYPTION_KEY (32 bytes, hex or base64).',
      ),
    };
  }

  if (!ephemeralKeyring) {
    ephemeralKeyring = { version: TOKEN_KEY_VERSION, key: randomBytes(KEY_BYTES) };
  }
  if (!ephemeralWarned) {
    ephemeralWarned = true;
    console.warn(
      '[social] NIBREXO_TOKEN_ENCRYPTION_KEY is unset; using an ephemeral process key. ' +
        'Connected tokens will not survive a restart.',
    );
  }
  return { ok: true, keyring: ephemeralKeyring };
}

export function encryptToken(plaintext: string, keyring: TokenKeyring): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyring.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, tag]).toString('base64url');
  return `${keyring.version}.${iv.toString('base64url')}.${payload}`;
}

/** Returns null for unknown versions, malformed payloads and tag failures. */
export function decryptToken(payload: string, keyring: TokenKeyring): string | null {
  try {
    const [version, ivText, body] = payload.split('.');
    if (version !== keyring.version || !ivText || !body) return null;
    const iv = Buffer.from(ivText, 'base64url');
    const combined = Buffer.from(body, 'base64url');
    if (iv.length !== IV_BYTES || combined.length < 17) return null;
    const ciphertext = combined.subarray(0, combined.length - 16);
    const tag = combined.subarray(combined.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', keyring.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** 256-bit OAuth state plus its sha256 lookup hash (the hash is what is stored). */
export function newOAuthState(): { state: string; stateHash: string } {
  const state = randomBytes(32).toString('hex');
  return { state, stateHash: hashOAuthState(state) };
}

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

/**
 * Signed Content Library asset URLs for email (Phase 16 §6, hardened Phase 17).
 *
 * Private Content Library files must never become public URLs. The studio
 * therefore renders images through a per-asset, expiring, HMAC-signed route
 * instead of exposing the bucket:
 *
 *   GET /api/workspace/email/assets/<mediaId>?exp=<unix>&org=<orgId>&sig=<hex>
 *
 * Properties of this design:
 *  - the token is the credential, so a recipient's mail client (which has no
 *    Nibrexo session) can still load the image;
 *  - it is scoped to one media id and one organization — it cannot be replayed
 *    against another tenant's asset;
 *  - it expires (default 30 days, configurable) and cannot be enumerated;
 *  - the route re-reads the `media_files` row with the organization filter, so
 *    a deleted or moved asset stops resolving immediately;
 *  - no bucket path, storage key or provider credential ever appears in the
 *    URL or in the rendered email.
 *
 * Signing key resolution (first match wins, see `assetSigningSource`):
 *   1. NIBREXO_EMAIL_ASSET_SECRET           (recommended, dedicated)
 *   2. NIBREXO_TOKEN_ENCRYPTION_KEY         (shared with social token encryption)
 *   3. SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY (server-only, durable)
 *   4. outside production only: a per-process ephemeral key (dev and tests)
 *   5. production with none of the above: NO key. Links are not minted and no
 *      token verifies, so emails fall back to the colour placeholder instead of
 *      becoming forgeable or silently inconsistent across instances.
 *
 * Public values (for example NEXT_PUBLIC_SUPABASE_URL) are never used as key
 * material: anyone can read them from the browser bundle, so a key derived
 * from them would let anyone mint valid links for any tenant's media.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 180 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRY_PATTERN = /^(0|[1-9]\d{0,11})$/;

/**
 * Development-only fallback secret.
 *
 * Stored on `globalThis` under a `Symbol.for` key so that every module registry
 * in one process (Next.js dev evaluates route handlers separately from the code
 * that mints URLs) agrees on the same key.
 */
const EPHEMERAL_KEY = Symbol.for('nibrexo.email.assetSigningSecret.ephemeral');

export type AssetSigningSource =
  | 'NIBREXO_EMAIL_ASSET_SECRET'
  | 'NIBREXO_TOKEN_ENCRYPTION_KEY'
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'SUPABASE_SECRET_KEY'
  | 'ephemeral'
  | 'none';

export class AssetSigningUnavailableError extends Error {
  constructor() {
    super('No durable asset signing key is configured (set NIBREXO_EMAIL_ASSET_SECRET).');
    this.name = 'AssetSigningUnavailableError';
  }
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

function ephemeralSecret(): string {
  const store = globalThis as typeof globalThis & Record<symbol, string | undefined>;
  let value = store[EPHEMERAL_KEY];
  if (!value) {
    value = randomBytes(32).toString('hex');
    store[EPHEMERAL_KEY] = value;
  }
  return `nibrexo-email-assets:ephemeral:${value}`;
}

/** Names the key source only. Safe to expose in diagnostics. */
export function assetSigningSource(): AssetSigningSource {
  if (envValue('NIBREXO_EMAIL_ASSET_SECRET')) return 'NIBREXO_EMAIL_ASSET_SECRET';
  if (envValue('NIBREXO_TOKEN_ENCRYPTION_KEY')) return 'NIBREXO_TOKEN_ENCRYPTION_KEY';
  if (envValue('SUPABASE_SERVICE_ROLE_KEY')) return 'SUPABASE_SERVICE_ROLE_KEY';
  if (envValue('SUPABASE_SECRET_KEY')) return 'SUPABASE_SECRET_KEY';
  return isProductionRuntime() ? 'none' : 'ephemeral';
}

/**
 * Server-only signing key, or null when none is available. Never returned to
 * the browser. Read on every call (no cache) so configuration changes and
 * tests take effect immediately.
 */
export function assetSigningSecret(): string | null {
  switch (assetSigningSource()) {
    case 'NIBREXO_EMAIL_ASSET_SECRET':
      return `nibrexo-email-assets:${envValue('NIBREXO_EMAIL_ASSET_SECRET')}`;
    case 'NIBREXO_TOKEN_ENCRYPTION_KEY':
      return `nibrexo-email-assets:${envValue('NIBREXO_TOKEN_ENCRYPTION_KEY')}`;
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return `nibrexo-email-assets:${envValue('SUPABASE_SERVICE_ROLE_KEY')}`;
    case 'SUPABASE_SECRET_KEY':
      return `nibrexo-email-assets:${envValue('SUPABASE_SECRET_KEY')}`;
    case 'ephemeral':
      return ephemeralSecret();
    case 'none':
      return null;
  }
}

/** True when tokens survive a restart and are shared by every instance. */
export function hasDurableAssetSecret(): boolean {
  const source = assetSigningSource();
  return source !== 'ephemeral' && source !== 'none';
}

function signature(secret: string, mediaId: string, organizationId: string, expiresAt: number): string {
  return createHmac('sha256', secret).update(`${mediaId}.${organizationId}.${expiresAt}`).digest('hex');
}

export interface SignedAssetUrl {
  url: string;
  expiresAt: number;
}

/**
 * Builds the signed URL for one media id inside one organization.
 * Throws `AssetSigningUnavailableError` when no signing key is available; the
 * design resolver converts that into "no image URL" so the email still renders.
 */
export function buildSignedAssetUrl(options: {
  mediaId: string;
  organizationId: string;
  baseUrl: string;
  ttlSeconds?: number;
}): SignedAssetUrl {
  const secret = assetSigningSecret();
  if (!secret) throw new AssetSigningUnavailableError();
  const requested = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const ttl = Math.max(60, Math.min(requested, MAX_TTL_SECONDS));
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const sig = signature(secret, options.mediaId, options.organizationId, expiresAt);
  const base = options.baseUrl.trim().replace(/\/+$/, '');
  const path = `/api/workspace/email/assets/${encodeURIComponent(options.mediaId)}`;
  const query = `exp=${expiresAt}&org=${encodeURIComponent(options.organizationId)}&sig=${sig}`;
  return { url: `${base}${path}?${query}`, expiresAt };
}

export interface AssetTokenCheck {
  ok: boolean;
  reason: string | null;
}

/** Verifies a signed asset token without touching the database. */
export function verifyAssetToken(options: {
  mediaId: string;
  organizationId: string;
  exp: string | null;
  sig: string | null;
  now?: Date;
}): AssetTokenCheck {
  const { exp, sig } = options;
  if (!exp || !sig) return { ok: false, reason: 'missing token' };
  // Canonical decimal only: "0123", "+1" or "12abc" must not verify as a number.
  if (!EXPIRY_PATTERN.test(exp)) return { ok: false, reason: 'malformed expiry' };
  const expiresAt = Number.parseInt(exp, 10);
  const now = options.now ?? new Date();
  if (expiresAt <= Math.floor(now.getTime() / 1000)) return { ok: false, reason: 'expired' };

  const secret = assetSigningSecret();
  if (!secret) return { ok: false, reason: 'signing key not configured' };

  const expected = signature(secret, options.mediaId, options.organizationId, expiresAt);
  const provided = Buffer.from(sig, 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true, reason: null };
}

/** True when an organization id has the canonical UUID shape. */
export function isOrganizationIdShape(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Default TTL in seconds (documented in .env.example). */
export const ASSET_URL_TTL_SECONDS = DEFAULT_TTL_SECONDS;

/**
 * The validated `NIBREXO_APP_URL` origin, or null when unset or invalid.
 * Must be an absolute http(s) URL without credentials; production requires
 * https. Only the origin is kept, because asset paths are root-relative.
 */
export function configuredAppOrigin(): string | null {
  const raw = serverEnv().appUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && !isProductionRuntime()) return url.origin;
    return null;
  } catch {
    return null;
  }
}

/** Diagnostic state of `NIBREXO_APP_URL` (names only, never the value). */
export function appUrlStatus(): 'unset' | 'valid' | 'invalid' {
  const raw = serverEnv().appUrl?.trim();
  if (!raw) return 'unset';
  return configuredAppOrigin() ? 'valid' : 'invalid';
}

/**
 * Best-effort absolute origin for a request. Used to build asset URLs that a
 * mail client can resolve. A valid NIBREXO_APP_URL wins; otherwise the origin
 * of the request URL is used (on Vercel this is the real public host).
 */
export function resolveRequestOrigin(request: Request): string | null {
  const configured = configuredAppOrigin();
  if (configured) return configured;
  try {
    const url = new URL(request.url);
    if (url.origin && url.origin !== 'null') return url.origin;
  } catch {
    // fall through
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return null;
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

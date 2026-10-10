/**
 * Signed Content Library asset URLs for email (Phase 16 §6).
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
 * The signing secret is server-only. When none of the documented variables are
 * set, a per-process secret is generated: images then work inside that process
 * (local development and tests) and stop resolving after a restart, which is
 * reported rather than silently relied upon.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 180 * 24 * 60 * 60;

/**
 * Development-only fallback secret.
 *
 * The secret is stored on `globalThis` under a `Symbol.for` key rather than in
 * a module-level variable. Next.js (and any bundler that can evaluate a route
 * in more than one module registry — dev mode evaluates the route handler
 * separately from the code that minted the URL) would otherwise give each
 * registry its own `randomBytes` secret, so a URL minted by the renderer would
 * be rejected by the handler that serves it. The registry symbol keeps every
 * registry in one process agreeing on the same secret.
 */
const EPHEMERAL_KEY = Symbol.for('nibrexo.email.assetSigningSecret.ephemeral');

function ephemeralSecret(): string {
  const store = globalThis as typeof globalThis & Record<symbol, string | undefined>;
  let value = store[EPHEMERAL_KEY];
  if (!value) {
    value = randomBytes(32).toString('hex');
    store[EPHEMERAL_KEY] = value;
  }
  return `nibrexo-email-assets:ephemeral:${value}`;
}

function fallbackSecret(): string {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (serviceKey) return `nibrexo-email-assets:${serviceKey}`;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  if (url) return `nibrexo-email-assets:origin:${url}`;
  // Development fallback: stable for the life of the process only.
  return ephemeralSecret();
}

let cachedSecret: string | null = null;

/** Server-only signing secret. Never returned to the browser. */
export function assetSigningSecret(): string {
  if (!cachedSecret) {
    const configured =
      process.env.NIBREXO_EMAIL_ASSET_SECRET?.trim() ||
      process.env.NIBREXO_TOKEN_ENCRYPTION_KEY?.trim() ||
      null;
    cachedSecret = configured ? `nibrexo-email-assets:${configured}` : fallbackSecret();
  }
  return cachedSecret;
}

/** True when a durable secret is configured (tokens survive a restart). */
export function hasDurableAssetSecret(): boolean {
  return Boolean(
    process.env.NIBREXO_EMAIL_ASSET_SECRET?.trim() || process.env.NIBREXO_TOKEN_ENCRYPTION_KEY?.trim(),
  );
}

function signature(mediaId: string, organizationId: string, expiresAt: number): string {
  return createHmac('sha256', assetSigningSecret())
    .update(`${mediaId}.${organizationId}.${expiresAt}`)
    .digest('hex');
}

export interface SignedAssetUrl {
  url: string;
  expiresAt: number;
}

/** Builds the signed URL for one media id inside one organization. */
export function buildSignedAssetUrl(options: {
  mediaId: string;
  organizationId: string;
  baseUrl: string;
  ttlSeconds?: number;
}): SignedAssetUrl {
  const requested = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const ttl = Math.max(60, Math.min(requested, MAX_TTL_SECONDS));
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const sig = signature(options.mediaId, options.organizationId, expiresAt);
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
  const expiresAt = Number.parseInt(exp, 10);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed expiry' };
  const now = options.now ?? new Date();
  if (expiresAt <= Math.floor(now.getTime() / 1000)) return { ok: false, reason: 'expired' };

  const expected = signature(options.mediaId, options.organizationId, expiresAt);
  const provided = Buffer.from(sig, 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true, reason: null };
}

/** Default TTL in seconds (documented in .env.example). */
export const ASSET_URL_TTL_SECONDS = DEFAULT_TTL_SECONDS;

/**
 * Best-effort absolute origin for a request. Used to build asset URLs that a
 * mail client can resolve; falls back to the configured app URL.
 */
export function resolveRequestOrigin(request: Request): string | null {
  const configured = serverEnv().appUrl?.trim();
  if (configured) return configured.replace(/\/+$/, '');
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

/** True when the email asset route can be used with a durable secret. */
export function emailAssetRouteReady(): boolean {
  return hasDurableAssetSecret() || Boolean(serverEnv().appUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
}

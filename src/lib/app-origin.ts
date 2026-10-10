/**
 * Public application origin (`NIBREXO_APP_URL`), validated once for every
 * server-generated absolute URL: email asset links and OAuth redirects.
 *
 * Only the origin is kept (paths are root-relative), credentials are refused,
 * and production requires https. An invalid value yields null so callers fall
 * back to the request origin instead of emitting an insecure link.
 */
import { serverEnv } from '@/lib/env';

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

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


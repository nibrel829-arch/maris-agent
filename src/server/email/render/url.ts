/**
 * URL handling for the Email Studio renderer.
 *
 * Every URL that reaches a rendered email must be absolute and must use a
 * scheme an email client can act on. `javascript:`, `data:`, `vbscript:` and
 * `file:` are rejected — a rendered email is untrusted content from the
 * recipient's point of view, so nothing that can execute script is allowed.
 *
 * Template placeholders (`{{client.slug}}`) are permitted inside URLs because
 * the existing template engine resolves them before delivery; they are
 * replaced with a harmless probe value before validation.
 */

import { TEMPLATE_VARIABLE } from '@/server/email/validation';

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Replaces {{placeholders}} with a probe value so the rest can be validated. */
export function stripPlaceholders(value: string): string {
  return value.replace(TEMPLATE_VARIABLE, 'probe');
}

export function hasPlaceholder(value: string): boolean {
  TEMPLATE_VARIABLE.lastIndex = 0;
  return TEMPLATE_VARIABLE.test(value);
}

/** True when the value contains characters that must never appear in a URL. */
function hasUnsafeCharacters(value: string): boolean {
  // Control characters, backslash, and angle brackets (HTML/URL confusion).
  return /[\u0000-\u001f\u007f<>"'`\\]/.test(value);
}

export interface UrlCheck {
  ok: boolean;
  url: string | null;
  reason: string | null;
}

/**
 * Validates and normalises a URL for use inside an email document.
 * Returns the trimmed original on success so the caller keeps the exact value
 * the user typed (after placeholder resolution it will be a real URL).
 */
export function checkEmailUrl(raw: string | null | undefined): UrlCheck {
  if (raw === null || raw === undefined) return { ok: false, url: null, reason: 'missing' };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, url: null, reason: 'empty' };
  if (value.length > 2048) return { ok: false, url: null, reason: 'too long (2048 characters maximum)' };
  if (hasUnsafeCharacters(value)) {
    return { ok: false, url: null, reason: 'contains characters that are not allowed in a URL' };
  }
  if (hasPlaceholder(value)) {
    // Defer final judgement to send time, when the placeholder is resolved.
    return { ok: true, url: value, reason: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      url: null,
      reason: 'is not an absolute URL — use https://… (relative links cannot be resolved by an email client)',
    };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, url: null, reason: `uses the unsupported scheme "${parsed.protocol}"` };
  }

  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
    return { ok: false, url: null, reason: 'has no host name' };
  }

  return { ok: true, url: value, reason: null };
}

/** Convenience wrapper used by the renderer: returns a safe URL or null. */
export function safeEmailUrl(raw: string | null | undefined): string | null {
  const check = checkEmailUrl(raw);
  return check.ok ? check.url : null;
}

/** True when the URL is usable inside a rendered email. */
export function isValidEmailUrl(raw: string | null | undefined): boolean {
  return checkEmailUrl(raw).ok;
}

/**
 * Builds an absolute URL from a base origin and a path. Used for the signed
 * Content Library asset route so the browser canvas and the delivered email
 * resolve the exact same image URL.
 */
export function absoluteUrl(baseUrl: string | null | undefined, path: string): string {
  if (!baseUrl) return path;
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

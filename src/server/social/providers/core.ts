/**
 * OAuth provider core (Phase 7).
 *
 * Every provider below was verified against its current official
 * documentation in October 2026; each adapter file cites the exact reference
 * it implements. No endpoint, scope or token behaviour here is guessed:
 * anything unverifiable is reported as unsupported instead.
 *
 * Security rules for all providers:
 *  - tokens and secrets travel only in server-side request bodies/headers,
 *    never in URLs the browser sees (Meta's GET exchange is server-to-server);
 *  - error messages are truncated provider strings — request bodies, tokens
 *    and secrets are never interpolated into them;
 *  - HTTP is injectable (`ProviderHttp`) so tests never touch the real
 *    providers.
 */

import type { ConnectablePlatform } from '../validation';

export interface ProviderHttpResponse {
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface ProviderHttpInit {
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export type ProviderHttp = (url: string, init: ProviderHttpInit) => Promise<ProviderHttpResponse>;

/** One recorded outbound request (used by tests to assert on provider calls). */
export interface ProviderHttpCall {
  url: string;
  init: ProviderHttpInit;
}

export function defaultProviderHttp(timeoutMs = 15_000): ProviderHttp {
  return async (url, init) => {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: response.status,
      json: () => response.json() as Promise<unknown>,
      text: () => response.text(),
    };
  };
}

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ProviderTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Access-token lifetime in seconds, when the provider reports it. */
  expiresIn: number | null;
  /** Refresh-token lifetime in seconds, when the provider reports it. */
  refreshExpiresIn: number | null;
  /** Scopes/permissions the provider confirms as granted. */
  grantedScopes: string[];
  /** Provider-side user id when the token response carries it. */
  providerUserId: string | null;
  /** Provider-specific extras (e.g. Facebook Pages). Never contains secrets in logs. */
  extra?: unknown;
}

export interface ProviderIdentity {
  externalId: string;
  displayName: string;
}

export type ProviderErrorCode =
  | 'INVALID_GRANT'
  | 'PROVIDER_HTTP'
  | 'PROVIDER_MALFORMED'
  | 'RATE_LIMITED'
  | 'REFRESH_NOT_GRANTED';

/**
 * Safe provider failure. `message` is built only from the provider's public
 * error fields plus our own static text — never from request parameters.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(code: ProviderErrorCode, message: string, retryable = false, status: number | null = null) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export interface OAuthProvider {
  readonly platform: ConnectablePlatform;
  readonly label: string;
  /** Scopes requested at connect time (verified minimal set + publishing needs). */
  readonly scopes: string[];
  /** False when the provider documents no programmatic refresh (Meta Page flow). */
  readonly supportsRefresh: boolean;

  authorizationUrl(args: { clientId: string; redirectUri: string; state: string }): string;

  exchangeCode(args: {
    code: string;
    redirectUri: string;
    credentials: ProviderCredentials;
    http: ProviderHttp;
  }): Promise<ProviderTokenSet>;

  refreshToken(args: {
    credentials: ProviderCredentials;
    accessToken: string;
    refreshToken: string | null;
    http: ProviderHttp;
  }): Promise<ProviderTokenSet>;

  fetchIdentity(args: {
    accessToken: string;
    tokenSet: ProviderTokenSet;
    http: ProviderHttp;
  }): Promise<ProviderIdentity>;

  /** Best-effort server-side revocation. Only implemented where verified. */
  revokeToken?(args: { token: string; http: ProviderHttp }): Promise<void>;
}

export function toForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Splits a provider scope string on commas and/or whitespace. */
export function splitScopes(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Extracts the provider's public error description, truncated. Returns the
 * fallback when the payload carries nothing usable.
 */
export function providerErrorMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  if (!record) return fallback;
  const code =
    typeof record.error === 'string'
      ? record.error
      : typeof record.error_code !== 'undefined'
        ? String(record.error_code)
        : typeof record.code !== 'undefined'
          ? String(record.code)
          : '';
  const detail = record.error_description ?? record.error_message ?? record.message;
  const text = [code, typeof detail === 'string' ? detail : ''].filter(Boolean).join(': ');
  return (text || fallback).slice(0, 300);
}

export interface ParseOptions {
  platform: string;
  /** Provider-specific dead-grant detection on the parsed error payload. */
  isInvalidGrant?: (payload: unknown, status: number) => boolean;
}

/**
 * Parses a provider JSON response. Non-2xx becomes a typed ProviderError;
 * 429 is retryable, dead grants map to INVALID_GRANT so the service can mark
 * the account `reconnect_required` instead of retrying forever.
 */
export async function parseProviderJson(
  response: ProviderHttpResponse,
  options: ParseOptions,
): Promise<unknown> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 429) {
    throw new ProviderError('RATE_LIMITED', `${options.platform}: rate limited by the provider; retry later.`, true, 429);
  }
  if (response.status < 200 || response.status >= 300 || payload === null) {
    if (payload !== null && options.isInvalidGrant?.(payload, response.status)) {
      throw new ProviderError(
        'INVALID_GRANT',
        `${options.platform}: authorization expired or revoked; reconnect the account.`,
        false,
        response.status,
      );
    }
    throw new ProviderError(
      'PROVIDER_HTTP',
      `${options.platform}: request failed (${response.status}): ${providerErrorMessage(payload, 'no details')}`,
      response.status >= 500,
      response.status,
    );
  }
  return payload;
}

/** Standard OAuth 2.0 `invalid_grant` detection (Google, LinkedIn, Pinterest). */
export function isStandardInvalidGrant(payload: unknown, status: number): boolean {
  if (status !== 400 && status !== 401) return false;
  const record = asRecord(payload);
  return record?.error === 'invalid_grant';
}

export function requiredString(record: Record<string, unknown>, key: string, platform: string): string {
  const value = stringField(record, key);
  if (!value) {
    throw new ProviderError(
      'PROVIDER_MALFORMED',
      `${platform}: response is missing ${key}.`,
      false,
    );
  }
  return value;
}

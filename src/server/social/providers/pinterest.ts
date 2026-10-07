/**
 * Pinterest API v5 adapter (verified October 2026).
 *
 * Reference: developers.pinterest.com `getting-started/set-up-authentication-and-authorization`
 *  - Authorize: `https://www.pinterest.com/oauth/` (client_id, redirect_uri,
 *    response_type=code, comma/space-separated scope, state).
 *  - Token: `POST https://api.pinterest.com/v5/oauth/token` with HTTP Basic
 *    (client_id:client_secret), form-encoded. Code exchange sends
 *    `continuous_refresh=true` (required for apps created before 2025-09-25,
 *    documented-harmless otherwise) and returns the continuous refresh token.
 *  - Lifetimes: access 30 days (2592000s); continuous refresh 60 days,
 *    refreshable indefinitely; expired refresh means repeating the code flow.
 *  - Refresh: same endpoint, `grant_type=refresh_token` (+ optional scope
 *    narrowing, which we do not use — the full grant is kept).
 *  - Identity: `GET https://api.pinterest.com/v5/user_account` (Bearer),
 *    scope `user_accounts:read`; returns `{id, username, …}`.
 *  - Invalid tokens surface as HTTP 401 (API error code 2).
 *
 * Note: apps registered on/after 2026-09-14 can receive 403
 * `PINNER_DATA_ACCESS_DENIED` on board/Pin reads for non-business users. That
 * affects future publishing reads, not the identity call used here.
 */

import {
  isStandardInvalidGrant,
  numberField,
  OAuthProvider,
  parseProviderJson,
  ProviderError,
  ProviderTokenSet,
  requiredString,
  splitScopes,
  stringField,
  toForm,
} from './core';

const AUTHORIZE_URL = 'https://www.pinterest.com/oauth/';
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
const USER_ACCOUNT_URL = 'https://api.pinterest.com/v5/user_account';

export const PINTEREST_SCOPES = [
  'user_accounts:read',
  'boards:read',
  'pins:read',
  'boards:write',
  'pins:write',
] as const;

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

/** Refresh lifetime: prefer the absolute `refresh_token_expires_at` (unix s). */
function refreshExpiresIn(data: Record<string, unknown>): number | null {
  const relative = numberField(data, 'refresh_token_expires_in');
  if (relative !== null) return relative;
  const absolute = numberField(data, 'refresh_token_expires_at');
  if (absolute === null) return null;
  return Math.max(0, Math.floor(absolute - Date.now() / 1000));
}

function toTokenSet(payload: unknown): ProviderTokenSet {
  const data = (payload ?? {}) as Record<string, unknown>;
  return {
    accessToken: requiredString(data, 'access_token', 'Pinterest'),
    refreshToken: stringField(data, 'refresh_token'),
    expiresIn: numberField(data, 'expires_in'),
    refreshExpiresIn: refreshExpiresIn(data),
    grantedScopes: splitScopes(stringField(data, 'scope')),
    providerUserId: null,
  };
}

/** Pinterest documents 401 (+ API error code 2) for dead tokens. */
const isDeadGrant = (payload: unknown, status: number) =>
  status === 401 || isStandardInvalidGrant(payload, status);

export const pinterestProvider: OAuthProvider = {
  platform: 'pinterest',
  label: 'Pinterest',
  scopes: [...PINTEREST_SCOPES],
  supportsRefresh: true,

  authorizationUrl({ clientId, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: PINTEREST_SCOPES.join(','),
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri, credentials, http }) {
    const response = await http(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(credentials.clientId, credentials.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: toForm({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        continuous_refresh: 'true',
      }),
    });
    return toTokenSet(await parseProviderJson(response, { platform: 'Pinterest', isInvalidGrant: isDeadGrant }));
  },

  async refreshToken({ credentials, refreshToken, http }) {
    if (!refreshToken) {
      throw new ProviderError(
        'REFRESH_NOT_GRANTED',
        'Pinterest: no refresh token stored; reconnect the account.',
      );
    }
    const response = await http(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(credentials.clientId, credentials.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: toForm({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    return toTokenSet(await parseProviderJson(response, { platform: 'Pinterest', isInvalidGrant: isDeadGrant }));
  },

  async fetchIdentity({ accessToken, http }) {
    const response = await http(USER_ACCOUNT_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await parseProviderJson(response, {
      platform: 'Pinterest',
      isInvalidGrant: isDeadGrant,
    })) as Record<string, unknown>;
    const id = stringField(payload, 'id');
    if (!id) {
      throw new ProviderError('PROVIDER_MALFORMED', 'Pinterest: account response is missing id.');
    }
    return { externalId: id, displayName: stringField(payload, 'username') ?? id };
  },
};

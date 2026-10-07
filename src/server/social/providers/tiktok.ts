/**
 * TikTok Login Kit adapter (verified October 2026).
 *
 * References:
 *  - Login Kit authorize + token exchange: `https://www.tiktok.com/v2/auth/authorize/`
 *    and `POST https://open.tiktokapis.com/v2/oauth/token/` (client_key /
 *    client_secret, comma-separated scopes). TikTok's reference pages returned
 *    HTTP 403 to the verification fetcher, so the v2 contract is additionally
 *    cross-confirmed by four independent integrations; lifetimes and the
 *    user-info endpoint below are from TikTok's own docs.
 *  - Token lifetimes: access 24h (86400s), refresh 365d (31536000s);
 *    refresh may rotate the refresh token (developers.tiktok.com token guides).
 *  - Identity: `GET https://open.tiktokapis.com/v2/user/info/` with
 *    `fields=open_id,display_name,avatar_url` (Display API get-started guide).
 *  - Scopes: `user.info.basic` (identity, default), `video.upload` (drafts),
 *    `video.publish` (direct post). Publish scopes need TikTok app approval;
 *    until approved, requesting them fails the flow with TikTok's own error.
 */

import {
  numberField,
  OAuthProvider,
  parseProviderJson,
  ProviderError,
  ProviderIdentity,
  ProviderTokenSet,
  requiredString,
  splitScopes,
  stringField,
  toForm,
} from './core';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

export const TIKTOK_SCOPES = ['user.info.basic', 'video.upload', 'video.publish'] as const;

/** Documented lifetimes, used only when a response omits its own values. */
const ACCESS_FALLBACK_SECONDS = 86_400;
const REFRESH_FALLBACK_SECONDS = 31_536_000;

function tokenData(payload: unknown): Record<string, unknown> {
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = root.data;
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return root;
}

function toTokenSet(payload: unknown): ProviderTokenSet {
  const data = tokenData(payload);
  return {
    accessToken: requiredString(data, 'access_token', 'TikTok'),
    refreshToken: stringField(data, 'refresh_token'),
    expiresIn: numberField(data, 'expires_in') ?? ACCESS_FALLBACK_SECONDS,
    refreshExpiresIn: numberField(data, 'refresh_expires_in') ?? REFRESH_FALLBACK_SECONDS,
    grantedScopes: splitScopes(stringField(data, 'scope')),
    providerUserId: stringField(data, 'open_id'),
  };
}

const isDeadGrant = (_payload: unknown, status: number) => status === 401;

export const tiktokProvider: OAuthProvider = {
  platform: 'tiktok',
  label: 'TikTok',
  scopes: [...TIKTOK_SCOPES],
  supportsRefresh: true,

  authorizationUrl({ clientId, redirectUri, state }) {
    const params = new URLSearchParams({
      client_key: clientId,
      response_type: 'code',
      scope: TIKTOK_SCOPES.join(','),
      redirect_uri: redirectUri,
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri, credentials, http }) {
    const response = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toForm({
        client_key: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    return toTokenSet(await parseProviderJson(response, { platform: 'TikTok', isInvalidGrant: isDeadGrant }));
  },

  async refreshToken({ credentials, refreshToken, http }) {
    if (!refreshToken) {
      throw new ProviderError(
        'REFRESH_NOT_GRANTED',
        'TikTok: no refresh token stored; reconnect the account.',
      );
    }
    const response = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toForm({
        client_key: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    // Any 4xx here means the grant is dead (or revoked): reconnect, don't retry.
    return toTokenSet(
      await parseProviderJson(response, {
        platform: 'TikTok',
        isInvalidGrant: (_payload, status) => status === 400 || status === 401,
      }),
    );
  },

  async fetchIdentity({ accessToken, http }) {
    const url = `${USER_INFO_URL}?${new URLSearchParams({ fields: 'open_id,display_name,avatar_url' }).toString()}`;
    const response = await http(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await parseProviderJson(response, { platform: 'TikTok', isInvalidGrant: isDeadGrant });
    const root = (payload ?? {}) as Record<string, unknown>;
    const user = (root.data as Record<string, unknown> | undefined)?.user as
      | Record<string, unknown>
      | undefined;
    const fields = user ?? tokenData(payload);
    const openId = stringField(fields, 'open_id');
    if (!openId) {
      throw new ProviderError('PROVIDER_MALFORMED', 'TikTok: profile response is missing open_id.');
    }
    return {
      externalId: openId,
      displayName: stringField(fields, 'display_name') ?? openId,
    } satisfies ProviderIdentity;
  },
};

/**
 * YouTube (Google OAuth 2.0) adapter (verified October 2026).
 *
 * References (developers.google.com):
 *  - Web-server flow: `youtube/v3/guides/auth/server-side-web-apps`
 *    (authorize at `https://accounts.google.com/o/oauth2/v2/auth` with
 *    `access_type=offline` + `prompt=consent` for a refresh token).
 *  - Token endpoint `POST https://oauth2.googleapis.com/token` for both the
 *    code exchange and `grant_type=refresh_token`
 *    (`youtube/v3/guides/auth/installed-apps`, refresh section).
 *  - Scopes: `openid` (identity) + `https://www.googleapis.com/auth/youtube.upload`
 *    (narrowest scope allowing `videos.insert`; `videos/insert` reference).
 *  - Identity: `GET https://openidconnect.googleapis.com/v1/userinfo`
 *    (`identity/openid-connect/reference`; `sub` + `name` claims).
 *  - Revocation: `POST https://oauth2.googleapis.com/revoke` (OpenID
 *    discovery document `revocation_endpoint`). The only provider in this
 *    codebase with a verified revocation call — disconnect revokes here and
 *    wipes locally everywhere.
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

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

export const YOUTUBE_SCOPES = ['openid', YOUTUBE_UPLOAD_SCOPE] as const;

function toTokenSet(payload: unknown, previousRefreshToken: string | null = null): ProviderTokenSet {
  const data = (payload ?? {}) as Record<string, unknown>;
  return {
    accessToken: requiredString(data, 'access_token', 'YouTube'),
    // Google usually omits refresh_token on refresh: the old one stays valid.
    refreshToken: stringField(data, 'refresh_token') ?? previousRefreshToken,
    expiresIn: numberField(data, 'expires_in'),
    refreshExpiresIn: null,
    grantedScopes: splitScopes(stringField(data, 'scope')),
    providerUserId: null,
  };
}

export const youtubeProvider: OAuthProvider = {
  platform: 'youtube',
  label: 'YouTube',
  scopes: [...YOUTUBE_SCOPES],
  supportsRefresh: true,

  authorizationUrl({ clientId, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri, credentials, http }) {
    const response = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toForm({
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    return toTokenSet(await parseProviderJson(response, { platform: 'YouTube', isInvalidGrant: isStandardInvalidGrant }));
  },

  async refreshToken({ credentials, refreshToken, http }) {
    if (!refreshToken) {
      throw new ProviderError(
        'REFRESH_NOT_GRANTED',
        'YouTube: no refresh token stored; reconnect the account.',
      );
    }
    const response = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toForm({
        refresh_token: refreshToken,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    return toTokenSet(
      await parseProviderJson(response, { platform: 'YouTube', isInvalidGrant: isStandardInvalidGrant }),
      refreshToken,
    );
  },

  async fetchIdentity({ accessToken, http }) {
    const response = await http(USERINFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await parseProviderJson(response, {
      platform: 'YouTube',
      isInvalidGrant: isStandardInvalidGrant,
    })) as Record<string, unknown>;
    const sub = requiredString(payload, 'sub', 'YouTube');
    return {
      externalId: sub,
      displayName: stringField(payload, 'name') ?? stringField(payload, 'email') ?? sub,
    };
  },

  async revokeToken({ token, http }) {
    const response = await http(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toForm({ token }),
    });
    // 400 means the token is already dead — the desired end state for a
    // disconnect, so it succeeds silently. Anything else non-2xx surfaces.
    if (response.status === 400) return;
    await parseProviderJson(response, { platform: 'YouTube' });
  },
};

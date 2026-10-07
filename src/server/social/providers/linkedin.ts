/**
 * LinkedIn adapter (verified October 2026).
 *
 * References (learn.microsoft.com):
 *  - 3-legged flow `linkedin/shared/authentication/authorization-code-flow`:
 *    authorize `GET https://www.linkedin.com/oauth/v2/authorization`
 *    (response_type=code, client_id, redirect_uri, state, space-delimited
 *    scope); exchange `POST https://www.linkedin.com/oauth/v2/accessToken`
 *    form-encoded (grant_type=authorization_code, code, client_id,
 *    client_secret, redirect_uri). Codes live 30 minutes; cancellations come
 *    back as `user_cancelled_login` / `user_cancelled_authorize`.
 *  - Refresh `linkedin/shared/authentication/programmatic-refresh-tokens`:
 *    same endpoint with `grant_type=refresh_token`. Access tokens live 60
 *    days; refresh tokens live a fixed 365 days. A refresh token is returned
 *    ONLY for apps approved for programmatic refresh — without it there is
 *    nothing to refresh and the account must be reconnected at expiry.
 *  - Scopes: `openid profile email` (Sign In with LinkedIn via OpenID
 *    Connect) + `w_member_social` (Share on LinkedIn: post on the member's
 *    behalf). Organization scopes need partnership products and are not
 *    requested.
 *  - Identity: `GET https://api.linkedin.com/v2/userinfo` (OIDC userinfo;
 *    pairwise `sub` + `name`).
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

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

export const LINKEDIN_SCOPES = ['openid', 'profile', 'email', 'w_member_social'] as const;

function toTokenSet(payload: unknown): ProviderTokenSet {
  const data = (payload ?? {}) as Record<string, unknown>;
  return {
    accessToken: requiredString(data, 'access_token', 'LinkedIn'),
    refreshToken: stringField(data, 'refresh_token'),
    expiresIn: numberField(data, 'expires_in'),
    refreshExpiresIn: numberField(data, 'refresh_token_expires_in'),
    grantedScopes: splitScopes(stringField(data, 'scope')),
    providerUserId: null,
  };
}

export const linkedinProvider: OAuthProvider = {
  platform: 'linkedin',
  label: 'LinkedIn',
  scopes: [...LINKEDIN_SCOPES],
  supportsRefresh: true,

  authorizationUrl({ clientId, redirectUri, state }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: LINKEDIN_SCOPES.join(' '),
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri, credentials, http }) {
    const response = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toForm({
        grant_type: 'authorization_code',
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    return toTokenSet(
      await parseProviderJson(response, { platform: 'LinkedIn', isInvalidGrant: isStandardInvalidGrant }),
    );
  },

  async refreshToken({ credentials, refreshToken, http }) {
    if (!refreshToken) {
      // The documented outcome for apps without programmatic-refresh
      // approval: no refresh token was ever issued.
      throw new ProviderError(
        'REFRESH_NOT_GRANTED',
        'LinkedIn: no refresh token was granted for this app; reconnect the account.',
      );
    }
    const response = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toForm({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    });
    return toTokenSet(
      await parseProviderJson(response, { platform: 'LinkedIn', isInvalidGrant: isStandardInvalidGrant }),
    );
  },

  async fetchIdentity({ accessToken, http }) {
    const response = await http(USERINFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await parseProviderJson(response, {
      platform: 'LinkedIn',
      isInvalidGrant: isStandardInvalidGrant,
    })) as Record<string, unknown>;
    const sub = requiredString(payload, 'sub', 'LinkedIn');
    return { externalId: sub, displayName: stringField(payload, 'name') ?? sub };
  },
};

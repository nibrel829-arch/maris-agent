/**
 * Instagram adapter via Business Login (verified October 2026).
 *
 * Reference: developers.facebook.com `documentation/instagram-platform/instagram-api-with-instagram-login/business-login`
 * (updated 2026-03-13). Instagram Login is the recommended path: it needs no
 * linked Facebook Page.
 *  - Authorize: `https://www.instagram.com/oauth/authorize` (client_id is the
 *    Instagram App ID, redirect_uri, response_type=code, comma-separated
 *    scope, state). Codes are single-use, valid 1 hour; cancellations come
 *    back as `error=access_denied&error_reason=user_denied`.
 *  - Exchange: `POST https://api.instagram.com/oauth/access_token` as
 *    multipart form (client_id, client_secret = Instagram App Secret,
 *    grant_type=authorization_code, redirect_uri, code) → short-lived token +
 *    Instagram-scoped `user_id` + granted `permissions`.
 *  - Upgrade: `GET https://graph.instagram.com/access_token`
 *    (`grant_type=ig_exchange_token`, client_secret, short-lived token) →
 *    60-day long-lived token. Server-side only (uses the app secret).
 *  - Refresh: `GET https://graph.instagram.com/refresh_access_token`
 *    (`grant_type=ig_refresh_token`, long-lived token) → another 60 days.
 *    Requires the token to be ≥24h old, unexpired, and the account to have
 *    granted `instagram_business_basic`.
 *  - Identity: the exchange `user_id` is authoritative; the display name
 *    comes from `GET https://graph.instagram.com/me?fields=id,username`.
 *  - Scopes: `instagram_business_basic` + `instagram_business_content_publish`
 *    (professional accounts only; old `business_*` scope names were retired
 *    in January 2025).
 */

import { randomBytes } from 'node:crypto';
import {
  numberField,
  OAuthProvider,
  parseProviderJson,
  ProviderError,
  ProviderHttp,
  ProviderTokenSet,
  requiredString,
  splitScopes,
  stringField,
} from './core';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const EXCHANGE_URL = 'https://api.instagram.com/oauth/access_token';
const LONG_LIVED_URL = 'https://graph.instagram.com/access_token';
const REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
const ME_URL = 'https://graph.instagram.com/me';

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
] as const;

/** The documented exchange call is multipart form-data, so it is sent as such. */
function toMultipart(params: Record<string, string>): { body: string; boundary: string } {
  const boundary = `----nibrexo${randomBytes(16).toString('hex')}`;
  const body = Object.entries(params)
    .map(
      ([key, value]) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
    )
    .join('');
  return { body: `${body}--${boundary}--\r\n`, boundary };
}

async function postExchange(http: ProviderHttp, params: Record<string, string>): Promise<unknown> {
  const { body, boundary } = toMultipart(params);
  const response = await http(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return parseProviderJson(response, { platform: 'Instagram' });
}

/** Exchange response shape: `{data: [{access_token, user_id, permissions}]}`. */
function exchangeFields(payload: unknown): Record<string, unknown> {
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = root.data;
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    return data[0] as Record<string, unknown>;
  }
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return root;
}

const isDeadGrant = (payload: unknown, status: number) => {
  if (status !== 400 && status !== 401) return false;
  const record = (payload ?? {}) as Record<string, unknown>;
  return record.error_type === 'OAuthException' || typeof record.error_message === 'string';
};

export const instagramProvider: OAuthProvider = {
  platform: 'instagram',
  label: 'Instagram',
  scopes: [...INSTAGRAM_SCOPES],
  supportsRefresh: true,

  authorizationUrl({ clientId, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: INSTAGRAM_SCOPES.join(','),
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri, credentials, http }) {
    const fields = exchangeFields(
      await postExchange(http, {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    );
    const shortLived = requiredString(fields, 'access_token', 'Instagram');
    const providerUserId = stringField(fields, 'user_id');
    const grantedScopes = splitScopes(stringField(fields, 'permissions'));

    const upgradeUrl =
      `${LONG_LIVED_URL}?` +
      new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: credentials.clientSecret,
        access_token: shortLived,
      }).toString();
    const upgrade = (await parseProviderJson(await http(upgradeUrl, { method: 'GET' }), {
      platform: 'Instagram',
    })) as Record<string, unknown>;

    return {
      accessToken: requiredString(upgrade, 'access_token', 'Instagram'),
      refreshToken: null,
      expiresIn: numberField(upgrade, 'expires_in'),
      refreshExpiresIn: null,
      grantedScopes,
      providerUserId,
    } satisfies ProviderTokenSet;
  },

  async refreshToken({ accessToken, http }) {
    const url =
      `${REFRESH_URL}?` +
      new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken }).toString();
    const payload = (await parseProviderJson(await http(url, { method: 'GET' }), {
      platform: 'Instagram',
      isInvalidGrant: isDeadGrant,
    })) as Record<string, unknown>;
    return {
      accessToken: requiredString(payload, 'access_token', 'Instagram'),
      refreshToken: null,
      expiresIn: numberField(payload, 'expires_in'),
      refreshExpiresIn: null,
      grantedScopes: [],
      providerUserId: null,
    } satisfies ProviderTokenSet;
  },

  async fetchIdentity({ accessToken, tokenSet, http }) {
    const url =
      `${ME_URL}?` +
      new URLSearchParams({ fields: 'id,username', access_token: accessToken }).toString();
    const payload = (await parseProviderJson(await http(url, { method: 'GET' }), {
      platform: 'Instagram',
      isInvalidGrant: isDeadGrant,
    })) as Record<string, unknown>;
    const externalId = tokenSet.providerUserId ?? stringField(payload, 'id');
    if (!externalId) {
      throw new ProviderError('PROVIDER_MALFORMED', 'Instagram: cannot determine the account id.');
    }
    return { externalId, displayName: stringField(payload, 'username') ?? externalId };
  },
};

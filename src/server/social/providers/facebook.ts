/**
 * Facebook (Pages API via Facebook Login) adapter (verified October 2026).
 *
 * References (developers.facebook.com, updated 2026-06-30):
 *  - Manual login flow: `documentation/facebook-login/guides/advanced/manual-flow`
 *    — Login dialog `https://www.facebook.com/v26.0/dialog/oauth`
 *    (client_id, redirect_uri, state, comma/space-separated scope,
 *    response_type=code default); code exchange `GET
 *    https://graph.facebook.com/v26.0/oauth/access_token`
 *    (client_id, redirect_uri, client_secret, code) → short-lived user token.
 *    Cancellations come back as `error=access_denied&error_reason=user_denied`.
 *  - Long-lived tokens: `documentation/facebook-login/guides/access-tokens/get-long-lived`
 *    — short-lived → long-lived user token (~60 days) via
 *    `GET …/oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token=…`
 *    (server-side only); then long-lived Page tokens (no expiry date) via
 *    `GET …/{user-id}/accounts` with the long-lived user token.
 *  - Permissions (Pages API reference, re-verified Oct 2026):
 *    `pages_show_list`, `pages_manage_metadata`, `pages_manage_posts`,
 *    `pages_read_engagement` (read-back for verification; the previously
 *    requested `pages_manage_read_engagement` is not a real permission and
 *    was corrected in Phase 8). Publishing targets Pages only
 *    (`POST /{page-id}/feed`) — personal-profile posting does not exist.
 *
 * Connection model: a Nibrexo "Facebook account" is a Facebook Page. The
 * exchange collects the user's Pages (id, name, tasks, Page token); the
 * service auto-completes when exactly one Page grants CREATE_CONTENT and
 * otherwise asks the user to pick one. Page tokens in `extra` are memory-only
 * secrets: the service encrypts them into the state payload immediately and
 * they are never logged.
 *
 * No programmatic refresh exists for long-lived user tokens (Meta refreshes
 * SDK tokens on use; there is no server refresh grant), so
 * `supportsRefresh` is false. Page tokens themselves do not expire; a dead
 * Page connection is repaired by reconnecting.
 */

import {
  numberField,
  OAuthProvider,
  parseProviderJson,
  ProviderError,
  ProviderTokenSet,
  requiredString,
  stringField,
} from './core';

/** Latest Graph API version at verification time (Meta changelog, 2026-06-30). */
export const FACEBOOK_GRAPH_VERSION = 'v26.0';

const DIALOG_URL = `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`;
const GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;

export const FACEBOOK_PERMISSIONS = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_read_user_content',
] as const;

export interface FacebookPageCandidate {
  id: string;
  name: string;
  tasks: string[];
  /** Page access token — memory-only secret, encrypted by the service. */
  accessToken: string;
}

export interface FacebookExchangeExtra {
  userId: string;
  userName: string;
  /** Long-lived USER token — interim secret for the selection step only. */
  userToken: string;
  userTokenExpiresIn: number | null;
  pages: FacebookPageCandidate[];
}

const isDeadGrant = (payload: unknown, status: number) => {
  if (status !== 400 && status !== 401) return false;
  const record = (payload ?? {}) as Record<string, unknown>;
  const error = record.error as Record<string, unknown> | undefined;
  // Meta OAuth error code 190 = invalid/expired token.
  return typeof error === 'object' && error !== null && (error.code === 190 || error.type === 'OAuthException');
};

function pageCandidates(payload: unknown): FacebookPageCandidate[] {
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = root.data;
  if (!Array.isArray(data)) return [];
  const pages: FacebookPageCandidate[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = stringField(record, 'id');
    const accessToken = stringField(record, 'access_token');
    if (!id || !accessToken) continue;
    const tasks = Array.isArray(record.tasks)
      ? (record.tasks as unknown[]).filter((task): task is string => typeof task === 'string')
      : [];
    pages.push({ id, name: stringField(record, 'name') ?? id, tasks, accessToken });
  }
  return pages;
}

export const facebookProvider: OAuthProvider = {
  platform: 'facebook',
  label: 'Facebook',
  scopes: [...FACEBOOK_PERMISSIONS],
  supportsRefresh: false,

  authorizationUrl({ clientId, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: FACEBOOK_PERMISSIONS.join(','),
      response_type: 'code',
    });
    return `${DIALOG_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri, credentials, http }) {
    const shortUrl =
      `${GRAPH_URL}/oauth/access_token?` +
      new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        client_secret: credentials.clientSecret,
        code,
      }).toString();
    const shortResponse = (await parseProviderJson(await http(shortUrl, { method: 'GET' }), {
      platform: 'Facebook',
      isInvalidGrant: isDeadGrant,
    })) as Record<string, unknown>;
    const shortLived = requiredString(shortResponse, 'access_token', 'Facebook');

    const longUrl =
      `${GRAPH_URL}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        fb_exchange_token: shortLived,
      }).toString();
    const longResponse = (await parseProviderJson(await http(longUrl, { method: 'GET' }), {
      platform: 'Facebook',
      isInvalidGrant: isDeadGrant,
    })) as Record<string, unknown>;
    const userToken = requiredString(longResponse, 'access_token', 'Facebook');
    const userTokenExpiresIn = numberField(longResponse, 'expires_in');

    const meUrl = `${GRAPH_URL}/me?` + new URLSearchParams({ fields: 'id,name', access_token: userToken }).toString();
    const me = (await parseProviderJson(await http(meUrl, { method: 'GET' }), {
      platform: 'Facebook',
      isInvalidGrant: isDeadGrant,
    })) as Record<string, unknown>;
    const userId = requiredString(me, 'id', 'Facebook');
    const userName = stringField(me, 'name') ?? userId;

    const accountsUrl =
      `${GRAPH_URL}/${userId}/accounts?` + new URLSearchParams({ access_token: userToken }).toString();
    const accounts = await parseProviderJson(await http(accountsUrl, { method: 'GET' }), {
      platform: 'Facebook',
      isInvalidGrant: isDeadGrant,
    });

    // Read the provider's actual grant rather than assuming every requested
    // Pages permission was accepted. Inbox services gate on this exact list.
    const permissionsUrl =
      `${GRAPH_URL}/me/permissions?` +
      new URLSearchParams({ fields: 'permission,status', access_token: userToken }).toString();
    const permissionPayload = (await parseProviderJson(await http(permissionsUrl, { method: 'GET' }), {
      platform: 'Facebook',
      isInvalidGrant: isDeadGrant,
    })) as Record<string, unknown>;
    const permissionRows = Array.isArray(permissionPayload.data) ? permissionPayload.data : [];
    const grantedScopes = permissionRows.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const permission = (entry as Record<string, unknown>).permission;
      const status = (entry as Record<string, unknown>).status;
      return typeof permission === 'string' && status === 'granted' ? [permission] : [];
    });

    return {
      accessToken: userToken,
      refreshToken: null,
      expiresIn: userTokenExpiresIn,
      refreshExpiresIn: null,
      // Keep the provider's permission statuses, not just requested scopes.
      grantedScopes,
      providerUserId: userId,
      extra: {
        userId,
        userName,
        userToken,
        userTokenExpiresIn,
        pages: pageCandidates(accounts),
      } satisfies FacebookExchangeExtra,
    } satisfies ProviderTokenSet;
  },

  async refreshToken() {
    throw new ProviderError(
      'REFRESH_NOT_GRANTED',
      'Facebook: Page tokens do not expire and user tokens have no programmatic refresh; reconnect the account.',
    );
  },

  async fetchIdentity({ accessToken, tokenSet, http }) {
    const extra = tokenSet.extra as FacebookExchangeExtra | undefined;
    if (extra?.userId) {
      return { externalId: extra.userId, displayName: extra.userName };
    }
    const meUrl = `${GRAPH_URL}/me?` + new URLSearchParams({ fields: 'id,name', access_token: accessToken }).toString();
    const me = (await parseProviderJson(await http(meUrl, { method: 'GET' }), {
      platform: 'Facebook',
      isInvalidGrant: isDeadGrant,
    })) as Record<string, unknown>;
    const id = requiredString(me, 'id', 'Facebook');
    return { externalId: id, displayName: stringField(me, 'name') ?? id };
  },
};

/** Pages the app may publish to (CREATE_CONTENT task). Exported for the service. */
export function usablePages(extra: unknown): FacebookPageCandidate[] {
  const pages = (extra as Partial<FacebookExchangeExtra> | null)?.pages;
  if (!Array.isArray(pages)) return [];
  return pages.filter((page) => page.tasks.includes('CREATE_CONTENT'));
}

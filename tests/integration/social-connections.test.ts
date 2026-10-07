import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actor, repo, TEST_ORG } from '../helpers/context';
import { scriptedHttp, urlContains } from '../helpers/social-http';
import {
  completeCallback,
  disconnectAccount,
  initiateConnect,
  listAccounts,
  refreshAccount,
  selectFacebookPage,
} from '@/server/social/service';

/**
 * Phase 7 connection lifecycles through the real path:
 * authorize -> callback -> encrypted credentials -> refresh -> disconnect.
 * Provider HTTP is scripted; every URL, parameter shape and response contract
 * mirrors the verified official documentation (see providers/*.ts).
 */

const TEST_KEY = 'fedcba9876543210'.repeat(4);
const ORIGIN = 'https://app.test';

function stateFromUrl(authorizeUrl: string): string {
  return new URLSearchParams(authorizeUrl.split('?')[1]).get('state') as string;
}

beforeEach(() => {
  vi.stubEnv('NIBREXO_TOKEN_ENCRYPTION_KEY', TEST_KEY);
  vi.stubEnv('NIBREXO_TIKTOK_CLIENT_KEY', 'tk-key');
  vi.stubEnv('NIBREXO_TIKTOK_CLIENT_SECRET', 'tk-secret');
  vi.stubEnv('NIBREXO_PINTEREST_CLIENT_ID', 'p-id');
  vi.stubEnv('NIBREXO_PINTEREST_CLIENT_SECRET', 'p-secret');
  vi.stubEnv('NIBREXO_META_CLIENT_ID', 'meta-id');
  vi.stubEnv('NIBREXO_META_CLIENT_SECRET', 'meta-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Social connection lifecycles', () => {
  it('runs TikTok initiate -> connect -> refresh -> disconnect', async () => {
    const store = repo();
    const owner = actor();

    const initiated = await initiateConnect(owner, store, 'tiktok', { origin: ORIGIN });
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;

    const connected = await completeCallback(
      owner,
      store,
      'tiktok',
      { code: 'CODE', state: stateFromUrl(initiated.data.authorizeUrl) },
      {
        http: scriptedHttp([
          {
            match: urlContains('oauth/token'),
            status: 200,
            body: { access_token: 'A1', refresh_token: 'R1', expires_in: 86400, scope: 'user.info.basic', open_id: 'TT9' },
          },
          { match: urlContains('user/info'), status: 200, body: { data: { user: { open_id: 'TT9', display_name: 'Lifecycle' } } } },
        ]),
      },
    );
    expect(connected.ok).toBe(true);
    if (!connected.ok || connected.data.status !== 'connected') return;

    const refreshed = await refreshAccount(owner, store, connected.data.accountId, {
      http: scriptedHttp([
        { match: urlContains('oauth/token'), status: 200, body: { access_token: 'A2', refresh_token: 'R2', expires_in: 86400 } },
      ]),
    });
    expect(refreshed.ok).toBe(true);

    const listed = await listAccounts(owner, store);
    expect(listed.ok && listed.data.accounts[0]!.status).toBe('connected');
    expect(listed.ok && JSON.stringify(listed.data)).not.toContain('A2');

    const disconnected = await disconnectAccount(owner, store, connected.data.accountId, {
      http: scriptedHttp([]),
    });
    expect(disconnected.ok).toBe(true);
    expect(await store.socialCredentials.list(TEST_ORG)).toEqual([]);
  });

  it('runs Facebook multi-Page selection to a bound Page account', async () => {
    const store = repo();
    const owner = actor();

    const initiated = await initiateConnect(owner, store, 'facebook', { origin: ORIGIN });
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;
    const stateToken = stateFromUrl(initiated.data.authorizeUrl);

    const completed = await completeCallback(owner, store, 'facebook', { code: 'CODE', state: stateToken }, {
      http: scriptedHttp([
        { match: (url) => url.includes('/oauth/access_token') && !url.includes('grant_type'), status: 200, body: { access_token: 'S', expires_in: 1 } },
        { match: (url) => url.includes('grant_type=fb_exchange_token'), status: 200, body: { access_token: 'L', expires_in: 2 } },
        { match: (url) => url.includes('/me?'), status: 200, body: { id: 'U', name: 'Owner' } },
        {
          match: urlContains('/accounts'),
          status: 200,
          body: { data: [
            { id: 'PA', name: 'Page A', access_token: 'TOKEN-A', tasks: ['CREATE_CONTENT'] },
            { id: 'PB', name: 'Page B', access_token: 'TOKEN-B', tasks: ['CREATE_CONTENT'] },
          ] },
        },
        { match: urlContains('/permissions?'), status: 200, body: { data: [
          { permission: 'pages_show_list', status: 'granted' },
          { permission: 'pages_manage_metadata', status: 'granted' },
          { permission: 'pages_manage_posts', status: 'granted' },
          { permission: 'pages_read_engagement', status: 'granted' },
          { permission: 'pages_read_user_content', status: 'granted' },
        ] } },
      ]),
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok || completed.data.status !== 'needs_selection') return;
    expect(completed.data.pages).toHaveLength(2);

    const chosen = await selectFacebookPage(owner, store, { state: stateToken, page_id: 'PB' }, { http: scriptedHttp([]) });
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;

    const listed = await listAccounts(owner, store);
    expect(listed.ok && listed.data.accounts[0]!.external_account_id).toBe('PB');
    expect(listed.ok && listed.data.accounts[0]!.expires_at).toBeNull();

    // Facebook documents no programmatic refresh: the API says so.
    const refreshed = await refreshAccount(owner, store, chosen.data.accountId, { http: scriptedHttp([]) });
    expect(refreshed.ok).toBe(false);
    if (refreshed.ok) return;
    expect(refreshed.error.code).toBe('SOCIAL_REFRESH_UNSUPPORTED');
  });

  it('connects Pinterest with Basic auth and rejects invalid callbacks', async () => {
    const store = repo();
    const owner = actor();

    const initiated = await initiateConnect(owner, store, 'pinterest', { origin: ORIGIN });
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;

    const http = scriptedHttp([
      {
        match: urlContains('/v5/oauth/token'),
        status: 200,
        body: { access_token: 'PA', refresh_token: 'PR', expires_in: 2592000, refresh_token_expires_in: 5184000, scope: 'user_accounts:read pins:read' },
      },
      { match: urlContains('/v5/user_account'), status: 200, body: { id: 'PIN1', username: 'pinuser' } },
    ]);
    const completed = await completeCallback(
      owner,
      store,
      'pinterest',
      { code: 'CODE', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    expect(completed.ok).toBe(true);
    expect(http.calls[0]!.init.headers?.Authorization).toMatch(/^Basic /);

    // Unknown state and user-denied callbacks change nothing.
    const unknown = await completeCallback(owner, store, 'pinterest', { code: 'C', state: 'f'.repeat(64) }, { http });
    expect(unknown.ok).toBe(false);

    const second = await initiateConnect(owner, store, 'pinterest', { origin: ORIGIN });
    if (!second.ok) return;
    const denied = await completeCallback(
      owner,
      store,
      'pinterest',
      { state: stateFromUrl(second.data.authorizeUrl), error: 'access_denied', error_reason: 'user_denied' },
      { http },
    );
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe('SOCIAL_USER_DENIED');
    expect(await store.socialAccounts.list(TEST_ORG)).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import { scriptedHttp, urlContains } from '../helpers/social-http';
import {
  completeCallback,
  disconnectAccount,
  getSelectionState,
  initiateConnect,
  listAccounts,
  refreshAccount,
  selectFacebookPage,
} from '@/server/social/service';
import { decryptToken, hashOAuthState, parseTokenKey } from '@/server/social/crypto';

const TEST_KEY = '0123456789abcdef'.repeat(4);
const ORIGIN = 'https://app.test';

const TIKTOK_EXCHANGE = {
  access_token: 'ACCESS-SECRET',
  refresh_token: 'REFRESH-SECRET',
  expires_in: 86400,
  refresh_expires_in: 31536000,
  scope: 'user.info.basic',
  open_id: 'TT1',
};
const TIKTOK_PROFILE = { data: { user: { open_id: 'TT1', display_name: 'Ada TT' } } };

function tiktokScenes() {
  return [
    { match: urlContains('oauth/token'), status: 200, body: TIKTOK_EXCHANGE },
    { match: urlContains('user/info'), status: 200, body: TIKTOK_PROFILE },
  ];
}

function stateFromUrl(authorizeUrl: string): string {
  return new URLSearchParams(authorizeUrl.split('?')[1]).get('state') as string;
}

beforeEach(() => {
  vi.stubEnv('NIBREXO_TOKEN_ENCRYPTION_KEY', TEST_KEY);
  vi.stubEnv('NIBREXO_TIKTOK_CLIENT_KEY', 'tk-key');
  vi.stubEnv('NIBREXO_TIKTOK_CLIENT_SECRET', 'tk-secret');
  vi.stubEnv('NIBREXO_GOOGLE_CLIENT_ID', 'g-id');
  vi.stubEnv('NIBREXO_GOOGLE_CLIENT_SECRET', 'g-secret');
  vi.stubEnv('NIBREXO_PINTEREST_CLIENT_ID', 'p-id');
  vi.stubEnv('NIBREXO_PINTEREST_CLIENT_SECRET', 'p-secret');
  vi.stubEnv('NIBREXO_LINKEDIN_CLIENT_ID', 'li-id');
  vi.stubEnv('NIBREXO_LINKEDIN_CLIENT_SECRET', 'li-secret');
  vi.stubEnv('NIBREXO_INSTAGRAM_CLIENT_ID', 'ig-id');
  vi.stubEnv('NIBREXO_INSTAGRAM_CLIENT_SECRET', 'ig-secret');
  vi.stubEnv('NIBREXO_META_CLIENT_ID', 'meta-id');
  vi.stubEnv('NIBREXO_META_CLIENT_SECRET', 'meta-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Social connect initiation', () => {
  it('issues a state-bound authorize URL for configured platforms', async () => {
    const store = repo();
    const result = await initiateConnect(actor(), store, 'tiktok', { origin: ORIGIN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const url = new URL(result.data.authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(url.searchParams.get('client_key')).toBe('tk-key');
    expect(url.searchParams.get('state')).toHaveLength(64);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.test/api/workspace/social/callback/tiktok',
    );

    // Only the hash is stored — the raw state never touches the database.
    const states = await store.socialOauthStates.list(TEST_ORG);
    expect(states).toHaveLength(1);
    expect(states[0]!.state_hash).toBe(hashOAuthState(url.searchParams.get('state') as string));
    expect(states[0]!.requested_by).toBe(actor().userId);
  });

  it('denies view-only roles, unsupported and unconfigured platforms', async () => {
    const store = repo();

    const forbidden = await initiateConnect(actor({ role: 'client' }), store, 'tiktok', { origin: ORIGIN });
    expect(forbidden.ok).toBe(false);
    if (forbidden.ok) return;
    expect(forbidden.error.errorClass).toBe('permission');

    const unsupported = await initiateConnect(actor(), store, 'contra', { origin: ORIGIN });
    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) return;
    expect(unsupported.error.code).toBe('SOCIAL_UNSUPPORTED');

    vi.stubEnv('NIBREXO_META_CLIENT_SECRET', '');
    const unconfigured = await initiateConnect(actor(), store, 'facebook', { origin: ORIGIN });
    expect(unconfigured.ok).toBe(false);
    if (unconfigured.ok) return;
    expect(unconfigured.error.code).toBe('SOCIAL_NOT_CONFIGURED');

    expect(await store.socialOauthStates.list(TEST_ORG)).toEqual([]);
  });
});

describe('Social callback completion', () => {
  it('connects an account with encrypted credentials and an audit entry', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'tiktok', { origin: ORIGIN });
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;

    const http = scriptedHttp(tiktokScenes());
    const completed = await completeCallback(
      owner,
      store,
      'tiktok',
      { code: 'AUTH-CODE', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok || completed.data.status !== 'connected') return;

    const account = await store.socialAccounts.get(completed.data.accountId, TEST_ORG);
    expect(account?.status).toBe('connected');
    expect(account?.name).toBe('Ada TT');
    expect(account?.external_account_id).toBe('TT1');

    const credentials = await store.socialCredentials.list(TEST_ORG);
    expect(credentials).toHaveLength(1);
    const row = credentials[0]!;
    // Ciphertext at rest: decrypts with the key, never equals plaintext.
    expect(row.access_token_encrypted).not.toBe('ACCESS-SECRET');
    expect(row.refresh_token_encrypted).not.toBe('REFRESH-SECRET');
    const keyring = parseTokenKey(TEST_KEY);
    expect(keyring).not.toBeNull();
    if (!keyring || !row.access_token_encrypted || !row.refresh_token_encrypted) return;
    expect(decryptToken(row.access_token_encrypted, keyring)).toBe('ACCESS-SECRET');
    expect(decryptToken(row.refresh_token_encrypted, keyring)).toBe('REFRESH-SECRET');
    expect(row.credential_ref).toBe('v1');
    expect(row.expires_at).not.toBeNull();

    const states = await store.socialOauthStates.list(TEST_ORG);
    expect(states[0]!.used_at).not.toBeNull();

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(
      audit.some((entry) => entry.action === 'social.account.connected' && entry.entity_id === account?.id),
    ).toBe(true);
  });

  it('rejects unknown, expired, reused, foreign and cross-platform states identically', async () => {
    const store = repo();
    const owner = actor();
    const http = scriptedHttp(tiktokScenes());

    const unknown = await completeCallback(owner, store, 'tiktok', { code: 'C', state: '0'.repeat(64) }, { http });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.error.code).toBe('SOCIAL_STATE_INVALID');

    // Expired.
    await store.socialOauthStates.insert({
      organization_id: TEST_ORG,
      platform: 'tiktok',
      state_hash: hashOAuthState('e'.repeat(64)),
      redirect_uri: 'https://app.test/cb',
      requested_by: owner.userId,
      payload: null,
      expires_at: new Date(Date.now() - 1000).toISOString(),
      used_at: null,
    });
    const expired = await completeCallback(owner, store, 'tiktok', { code: 'C', state: 'e'.repeat(64) }, { http });
    expect(expired.ok).toBe(false);

    // Cross-tenant: org B cannot see or use org A's state.
    const initiated = await initiateConnect(owner, store, 'tiktok', { origin: ORIGIN });
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;
    const foreign = await completeCallback(
      actor({ organizationId: OTHER_ORG }),
      store,
      'tiktok',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    expect(foreign.ok).toBe(false);

    // Wrong platform for the state.
    const wrongPlatform = await completeCallback(
      owner,
      store,
      'youtube',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    expect(wrongPlatform.ok).toBe(false);

    // Valid completion, then replay.
    const completed = await completeCallback(
      owner,
      store,
      'tiktok',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    expect(completed.ok).toBe(true);
    const replay = await completeCallback(
      owner,
      store,
      'tiktok',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.error.code).toBe('SOCIAL_STATE_INVALID');
  });

  it('reports user cancellations and provider refusals honestly', async () => {
    const store = repo();
    const owner = actor();
    const http = scriptedHttp(tiktokScenes());

    const first = await initiateConnect(owner, store, 'tiktok', { origin: ORIGIN });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const cancelled = await completeCallback(
      owner,
      store,
      'tiktok',
      { state: stateFromUrl(first.data.authorizeUrl), error: 'access_denied', error_reason: 'user_denied' },
      { http },
    );
    expect(cancelled.ok).toBe(false);
    if (cancelled.ok) return;
    expect(cancelled.error.code).toBe('SOCIAL_USER_DENIED');
    expect(http.calls).toHaveLength(0);

    const second = await initiateConnect(owner, store, 'linkedin', { origin: ORIGIN });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const refused = await completeCallback(
      owner,
      store,
      'linkedin',
      { state: stateFromUrl(second.data.authorizeUrl), error: 'unauthorized_scope' },
      { http },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('SOCIAL_PROVIDER_DENIED');

    expect(await store.socialAccounts.list(TEST_ORG)).toEqual([]);
  });
});

describe('Facebook Page selection', () => {
  const fbScenes = (pages: unknown[]) => [
    { match: (url: string) => url.includes('/oauth/access_token') && !url.includes('grant_type'), status: 200, body: { access_token: 'SHORT', expires_in: 3600 } },
    { match: (url: string) => url.includes('grant_type=fb_exchange_token'), status: 200, body: { access_token: 'LONG-USER-SECRET', expires_in: 5183944 } },
    { match: (url: string) => url.includes('/me?'), status: 200, body: { id: 'U1', name: 'Ada FB' } },
    { match: urlContains('/accounts'), status: 200, body: { data: pages } },
  ];

  it('auto-completes a single usable Page', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'facebook', { origin: ORIGIN });
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;

    const http = scriptedHttp(
      fbScenes([{ id: 'P1', name: 'Shop', access_token: 'PAGE-SECRET', tasks: ['CREATE_CONTENT'] }]),
    );
    const completed = await completeCallback(
      owner,
      store,
      'facebook',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok || completed.data.status !== 'connected') return;

    const account = await store.socialAccounts.get(completed.data.accountId, TEST_ORG);
    expect(account?.external_account_id).toBe('P1');
    const credentials = await store.socialCredentials.list(TEST_ORG);
    expect(credentials[0]!.expires_at).toBeNull();
    expect(credentials[0]!.access_token_encrypted).not.toBe('PAGE-SECRET');
  });

  it('asks for a Page choice when several qualify, keeping tokens encrypted', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'facebook', { origin: ORIGIN });
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;
    const stateToken = stateFromUrl(initiated.data.authorizeUrl);

    const http = scriptedHttp(
      fbScenes([
        { id: 'P1', name: 'Shop', access_token: 'PAGE-SECRET-1', tasks: ['CREATE_CONTENT'] },
        { id: 'P2', name: 'Blog', access_token: 'PAGE-SECRET-2', tasks: ['ANALYZE', 'CREATE_CONTENT'] },
        { id: 'P3', name: 'View only', access_token: 'PAGE-SECRET-3', tasks: ['ANALYZE'] },
      ]),
    );
    const completed = await completeCallback(owner, store, 'facebook', { code: 'C', state: stateToken }, { http });
    expect(completed.ok).toBe(true);
    if (!completed.ok || completed.data.status !== 'needs_selection') return;
    expect(completed.data.pages.map((page) => page.id)).toEqual(['P1', 'P2']);
    expect(JSON.stringify(completed.data)).not.toContain('PAGE-SECRET');

    // Interim payload holds ciphertext only.
    const states = await store.socialOauthStates.list(TEST_ORG);
    expect(states[0]!.used_at).toBeNull();
    expect(JSON.stringify(states[0]!.payload)).not.toContain('PAGE-SECRET');

    const selection = await getSelectionState(owner, store, stateToken);
    expect(selection?.pages).toHaveLength(2);
    expect(JSON.stringify(selection)).not.toContain('PAGE-SECRET');

    const chosen = await selectFacebookPage(owner, store, { state: stateToken, page_id: 'P2' }, { http });
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    const account = await store.socialAccounts.get(chosen.data.accountId, TEST_ORG);
    expect(account?.external_account_id).toBe('P2');
    expect(account?.name).toBe('Blog');

    // The state is spent: no second selection, no cross-tenant selection.
    expect((await selectFacebookPage(owner, store, { state: stateToken, page_id: 'P1' }, { http })).ok).toBe(false);
    expect(
      (await selectFacebookPage(actor({ organizationId: OTHER_ORG }), store, { state: stateToken, page_id: 'P1' }, { http })).ok,
    ).toBe(false);
  });

  it('refuses Pages without content permission and empty results', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'facebook', { origin: ORIGIN });
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;
    const stateToken = stateFromUrl(initiated.data.authorizeUrl);

    const http = scriptedHttp(fbScenes([{ id: 'P9', name: 'Nope', access_token: 'X', tasks: ['ANALYZE'] }]));
    const completed = await completeCallback(owner, store, 'facebook', { code: 'C', state: stateToken }, { http });
    expect(completed.ok).toBe(false);
    if (completed.ok) return;
    expect(completed.error.code).toBe('SOCIAL_FACEBOOK_NO_PAGE');
  });
});

describe('Social token refresh', () => {
  it('rotates tokens and audits the refresh', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'tiktok', { origin: ORIGIN });
    if (!initiated.ok) throw new Error('initiate failed');
    const completed = await completeCallback(
      owner,
      store,
      'tiktok',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http: scriptedHttp(tiktokScenes()) },
    );
    if (!completed.ok || completed.data.status !== 'connected') throw new Error('connect failed');

    const http = scriptedHttp([
      { match: urlContains('oauth/token'), status: 200, body: { access_token: 'ACCESS-NEW', refresh_token: 'REFRESH-NEW', expires_in: 86400 } },
    ]);
    const refreshed = await refreshAccount(owner, store, completed.data.accountId, { http });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.data.status).toBe('connected');
    expect(JSON.stringify(refreshed.data)).not.toContain('ACCESS-NEW');

    const keyring = parseTokenKey(TEST_KEY);
    const credentials = await store.socialCredentials.list(TEST_ORG);
    const stored = credentials[0]!;
    expect(keyring && stored?.access_token_encrypted).toBeTruthy();
    if (!keyring || !stored?.access_token_encrypted) return;
    expect(decryptToken(stored.access_token_encrypted, keyring)).toBe('ACCESS-NEW');

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(audit.some((entry) => entry.action === 'social.account.refreshed')).toBe(true);
  });

  it('marks reconnect_required on dead grants without deleting credentials', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'tiktok', { origin: ORIGIN });
    if (!initiated.ok) throw new Error('initiate failed');
    const completed = await completeCallback(
      owner,
      store,
      'tiktok',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http: scriptedHttp(tiktokScenes()) },
    );
    if (!completed.ok || completed.data.status !== 'connected') throw new Error('connect failed');

    const http = scriptedHttp([{ match: urlContains('oauth/token'), status: 401, body: { error_code: 1 } }]);
    const refreshed = await refreshAccount(owner, store, completed.data.accountId, { http });
    expect(refreshed.ok).toBe(false);
    if (refreshed.ok) return;
    expect(refreshed.error.code).toBe('SOCIAL_REAUTH_REQUIRED');

    const account = await store.socialAccounts.get(completed.data.accountId, TEST_ORG);
    expect(account?.status).toBe('reconnect_required');
    expect(account?.last_error).toContain('reconnect');
    expect(await store.socialCredentials.list(TEST_ORG)).toHaveLength(1);
  });

  it('reports unsupported refresh honestly and denies viewers', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'facebook', { origin: ORIGIN });
    if (!initiated.ok) throw new Error('initiate failed');
    const http = scriptedHttp([
      { match: (url: string) => url.includes('/oauth/access_token') && !url.includes('grant_type'), status: 200, body: { access_token: 'S', expires_in: 1 } },
      { match: (url: string) => url.includes('grant_type=fb_exchange_token'), status: 200, body: { access_token: 'L', expires_in: 2 } },
      { match: (url: string) => url.includes('/me?'), status: 200, body: { id: 'U', name: 'U' } },
      { match: urlContains('/accounts'), status: 200, body: { data: [{ id: 'P', name: 'P', access_token: 'PT', tasks: ['CREATE_CONTENT'] }] } },
    ]);
    const completed = await completeCallback(
      owner,
      store,
      'facebook',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    if (!completed.ok || completed.data.status !== 'connected') throw new Error('connect failed');

    const refreshed = await refreshAccount(owner, store, completed.data.accountId, { http });
    expect(refreshed.ok).toBe(false);
    if (refreshed.ok) return;
    expect(refreshed.error.code).toBe('SOCIAL_REFRESH_UNSUPPORTED');

    const viewer = await refreshAccount(actor({ role: 'client' }), store, completed.data.accountId, { http });
    expect(viewer.ok).toBe(false);
  });
});

describe('Social disconnect and list', () => {
  it('revokes where verified, wipes tokens and audits', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'youtube', { origin: ORIGIN });
    if (!initiated.ok) throw new Error('initiate failed');
    const http = scriptedHttp([
      { match: urlContains('oauth2.googleapis.com/token'), status: 200, body: { access_token: 'YA', refresh_token: 'YR', expires_in: 3600, scope: 'openid' } },
      { match: urlContains('userinfo'), status: 200, body: { sub: 'G1', name: 'Ada G' } },
    ]);
    const completed = await completeCallback(
      owner,
      store,
      'youtube',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http },
    );
    if (!completed.ok || completed.data.status !== 'connected') throw new Error('connect failed');

    // Members cannot disconnect (social.delete is owner-only).
    const memberDenied = await disconnectAccount(actor({ role: 'member' }), store, completed.data.accountId, { http });
    expect(memberDenied.ok).toBe(false);
    expect(await store.socialCredentials.list(TEST_ORG)).toHaveLength(1);

    const revokeHttp = scriptedHttp([{ match: urlContains('/revoke'), status: 200, body: {} }]);
    const disconnected = await disconnectAccount(owner, store, completed.data.accountId, { http: revokeHttp });
    expect(disconnected.ok).toBe(true);
    expect(revokeHttp.calls.some((call) => call.url.includes('/revoke'))).toBe(true);
    expect(await store.socialCredentials.list(TEST_ORG)).toEqual([]);

    const account = await store.socialAccounts.get(completed.data.accountId, TEST_ORG);
    expect(account?.status).toBe('disconnected');

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(audit.some((entry) => entry.action === 'social.account.disconnected')).toBe(true);
  });

  it('lists redacted account views with tenant isolation', async () => {
    const store = repo();
    const owner = actor();
    const initiated = await initiateConnect(owner, store, 'tiktok', { origin: ORIGIN });
    if (!initiated.ok) throw new Error('initiate failed');
    await completeCallback(
      owner,
      store,
      'tiktok',
      { code: 'C', state: stateFromUrl(initiated.data.authorizeUrl) },
      { http: scriptedHttp(tiktokScenes()) },
    );

    const listed = await listAccounts(owner, store);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.accounts).toHaveLength(1);
    const view = listed.data.accounts[0]!;
    expect(view).toBeDefined();
    if (!view) return;
    expect('access_token_encrypted' in view).toBe(false);
    expect('refresh_token_encrypted' in view).toBe(false);
    expect(view.has_refresh_token).toBe(true);
    expect(JSON.stringify(listed.data)).not.toContain('ACCESS-SECRET');
    expect(JSON.stringify(listed.data)).not.toContain('REFRESH-SECRET');
    expect(listed.data.providers).toHaveLength(7);

    const foreign = await listAccounts(actor({ organizationId: OTHER_ORG }), store);
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    expect(foreign.data.accounts).toEqual([]);

    const viewer = await listAccounts(actor({ role: 'client' }), store);
    expect(viewer.ok).toBe(false);
  });
});

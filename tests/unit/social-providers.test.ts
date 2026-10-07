import { describe, expect, it } from 'vitest';
import {
  CONNECTION_SUPPORT,
  getOAuthProvider,
  ProviderError,
} from '@/server/social/providers';
import { facebookProvider } from '@/server/social/providers/facebook';
import { instagramProvider } from '@/server/social/providers/instagram';
import { linkedinProvider } from '@/server/social/providers/linkedin';
import { pinterestProvider } from '@/server/social/providers/pinterest';
import { tiktokProvider } from '@/server/social/providers/tiktok';
import { youtubeProvider } from '@/server/social/providers/youtube';
import { formBody, scriptedHttp, urlContains } from '../helpers/social-http';

const CREDS = { clientId: 'CID', clientSecret: 'CSECRET' };
const REDIRECT = 'https://app.test/api/workspace/social/callback/tiktok';

async function rejectsWith(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error('Expected a ProviderError.');
}

describe('OAuth provider registry', () => {
  it('exposes six adapters and leaves Contra unsupported', () => {
    for (const platform of ['tiktok', 'youtube', 'pinterest', 'linkedin', 'instagram', 'facebook'] as const) {
      const provider = getOAuthProvider(platform);
      expect(provider?.platform).toBe(platform);
      expect(provider?.scopes.length).toBeGreaterThan(0);
      expect(CONNECTION_SUPPORT[platform].connectable).toBe(true);
    }
    expect(getOAuthProvider('contra')).toBeNull();
    expect(CONNECTION_SUPPORT.contra.connectable).toBe(false);
    expect(CONNECTION_SUPPORT.facebook.refresh).toBe('unsupported');
    expect(CONNECTION_SUPPORT.linkedin.refresh).toBe('conditional');
  });
});

describe('TikTok provider', () => {
  it('builds the Login Kit authorize URL with client_key and scopes', () => {
    const url = tiktokProvider.authorizationUrl({ clientId: 'KEY', redirectUri: REDIRECT, state: 'S' });
    expect(url.startsWith('https://www.tiktok.com/v2/auth/authorize/?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('client_key')).toBe('KEY');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('user.info.basic,video.upload,video.publish');
    expect(params.get('state')).toBe('S');
  });

  it('exchanges codes and parses data-wrapped or flat responses', async () => {
    for (const body of [
      { data: { access_token: 'A', refresh_token: 'R', expires_in: 100, refresh_expires_in: 200, scope: 'user.info.basic', open_id: 'OID' } },
      { access_token: 'A', refresh_token: 'R', expires_in: 100, refresh_expires_in: 200, scope: 'user.info.basic', open_id: 'OID' },
    ]) {
      const http = scriptedHttp([{ match: urlContains('oauth/token'), status: 200, body }]);
      const tokens = await tiktokProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http });
      expect(tokens.accessToken).toBe('A');
      expect(tokens.refreshToken).toBe('R');
      expect(tokens.providerUserId).toBe('OID');
      expect(tokens.grantedScopes).toEqual(['user.info.basic']);
      const sent = formBody(http.calls[0]!.init);
      expect(sent.get('client_key')).toBe('CID');
      expect(sent.get('grant_type')).toBe('authorization_code');
    }
  });

  it('refreshes with rotation and requires a stored refresh token', async () => {
    const http = scriptedHttp([
      { match: urlContains('oauth/token'), status: 200, body: { access_token: 'A2', refresh_token: 'R2', expires_in: 100 } },
    ]);
    const tokens = await tiktokProvider.refreshToken({ credentials: CREDS, accessToken: 'A', refreshToken: 'R', http });
    expect(tokens.accessToken).toBe('A2');
    expect(tokens.refreshToken).toBe('R2');
    expect(formBody(http.calls[0]!.init).get('grant_type')).toBe('refresh_token');

    const error = await rejectsWith(
      tiktokProvider.refreshToken({ credentials: CREDS, accessToken: 'A', refreshToken: null, http }),
    );
    expect(error.code).toBe('REFRESH_NOT_GRANTED');
  });

  it('fetches the profile and maps failures safely', async () => {
    const http = scriptedHttp([
      { match: urlContains('user/info'), status: 200, body: { data: { user: { open_id: 'OID', display_name: 'Ada' } } } },
    ]);
    const identity = await tiktokProvider.fetchIdentity({
      accessToken: 'A',
      tokenSet: { accessToken: 'A', refreshToken: null, expiresIn: null, refreshExpiresIn: null, grantedScopes: [], providerUserId: null },
      http,
    });
    expect(identity).toEqual({ externalId: 'OID', displayName: 'Ada' });
    expect(http.calls[0]!.init.headers?.Authorization).toBe('Bearer A');

    const dead = scriptedHttp([{ match: urlContains('user/info'), status: 401, body: { error_code: 10002 } }]);
    const invalid = await rejectsWith(
      tiktokProvider.fetchIdentity({
        accessToken: 'BAD',
        tokenSet: { accessToken: 'BAD', refreshToken: null, expiresIn: null, refreshExpiresIn: null, grantedScopes: [], providerUserId: null },
        http: dead,
      }),
    );
    expect(invalid.code).toBe('INVALID_GRANT');
    expect(invalid.retryable).toBe(false);
  });
});

describe('YouTube provider', () => {
  it('requests offline access with the narrow upload scope', () => {
    const url = youtubeProvider.authorizationUrl({ clientId: 'CID', redirectUri: REDIRECT, state: 'S' });
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
    expect(params.get('scope')).toBe('openid https://www.googleapis.com/auth/youtube.upload');
  });

  it('keeps the previous refresh token when Google omits a new one', async () => {
    const http = scriptedHttp([
      { match: urlContains('oauth2.googleapis.com/token'), status: 200, body: { access_token: 'A2', expires_in: 3600, scope: 'openid' } },
    ]);
    const tokens = await youtubeProvider.refreshToken({ credentials: CREDS, accessToken: 'A', refreshToken: 'OLD', http });
    expect(tokens.accessToken).toBe('A2');
    expect(tokens.refreshToken).toBe('OLD');
  });

  it('detects invalid_grant and revokes idempotently', async () => {
    const http = scriptedHttp([
      { match: urlContains('oauth2.googleapis.com/token'), status: 400, body: { error: 'invalid_grant', error_description: 'Token expired' } },
    ]);
    const error = await rejectsWith(
      youtubeProvider.refreshToken({ credentials: CREDS, accessToken: 'A', refreshToken: 'DEAD', http }),
    );
    expect(error.code).toBe('INVALID_GRANT');

    const revoke = scriptedHttp([{ match: urlContains('/revoke'), status: 400, body: {} }]);
    await expect(youtubeProvider.revokeToken?.({ token: 'A', http: revoke })).resolves.toBeUndefined();

    const revokeFail = scriptedHttp([{ match: urlContains('/revoke'), status: 500, body: {} }]);
    const failed = await rejectsWith(youtubeProvider.revokeToken?.({ token: 'A', http: revokeFail }) ?? Promise.resolve());
    expect(failed.code).toBe('PROVIDER_HTTP');
    expect(failed.retryable).toBe(true);
  });
});

describe('Pinterest provider', () => {
  it('uses Basic auth and requests continuous refresh', async () => {
    const http = scriptedHttp([
      {
        match: urlContains('/v5/oauth/token'),
        status: 200,
        body: { access_token: 'A', refresh_token: 'R', expires_in: 2592000, refresh_token_expires_in: 5184000, scope: 'boards:read pins:read' },
      },
    ]);
    const tokens = await pinterestProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http });
    expect(tokens.grantedScopes).toEqual(['boards:read', 'pins:read']);
    expect(tokens.refreshExpiresIn).toBe(5184000);
    expect(http.calls[0]!.init.headers?.Authorization).toBe(
      `Basic ${Buffer.from('CID:CSECRET', 'utf8').toString('base64')}`,
    );
    expect(formBody(http.calls[0]!.init).get('continuous_refresh')).toBe('true');
  });

  it('treats 401 as a dead grant and reads the user account', async () => {
    const http = scriptedHttp([
      { match: urlContains('/v5/user_account'), status: 200, body: { id: '999', username: 'ada' } },
    ]);
    const identity = await pinterestProvider.fetchIdentity({
      accessToken: 'A',
      tokenSet: { accessToken: 'A', refreshToken: null, expiresIn: null, refreshExpiresIn: null, grantedScopes: [], providerUserId: null },
      http,
    });
    expect(identity).toEqual({ externalId: '999', displayName: 'ada' });

    const dead = scriptedHttp([{ match: urlContains('/v5/user_account'), status: 401, body: { code: 2 } }]);
    const error = await rejectsWith(
      pinterestProvider.fetchIdentity({
        accessToken: 'BAD',
        tokenSet: { accessToken: 'BAD', refreshToken: null, expiresIn: null, refreshExpiresIn: null, grantedScopes: [], providerUserId: null },
        http: dead,
      }),
    );
    expect(error.code).toBe('INVALID_GRANT');
  });
});

describe('LinkedIn provider', () => {
  it('exchanges with client credentials in the body and flags missing refresh', async () => {
    const http = scriptedHttp([
      { match: urlContains('/oauth/v2/accessToken'), status: 200, body: { access_token: 'A', expires_in: 5184000, scope: 'openid w_member_social' } },
    ]);
    const tokens = await linkedinProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http });
    expect(tokens.accessToken).toBe('A');
    expect(tokens.refreshToken).toBeNull();
    const sent = formBody(http.calls[0]!.init);
    expect(sent.get('client_id')).toBe('CID');
    expect(sent.get('client_secret')).toBe('CSECRET');

    const error = await rejectsWith(
      linkedinProvider.refreshToken({ credentials: CREDS, accessToken: 'A', refreshToken: null, http }),
    );
    expect(error.code).toBe('REFRESH_NOT_GRANTED');
  });
});

describe('Instagram provider', () => {
  it('runs code -> short-lived -> long-lived with multipart exchange', async () => {
    const http = scriptedHttp([
      {
        match: urlContains('api.instagram.com/oauth/access_token'),
        status: 200,
        body: { data: [{ access_token: 'SHORT', user_id: 'IG1', permissions: 'instagram_business_basic,instagram_business_content_publish' }] },
      },
      { match: urlContains('graph.instagram.com/access_token'), status: 200, body: { access_token: 'LONG', expires_in: 5183944 } },
    ]);
    const tokens = await instagramProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http });
    expect(tokens.accessToken).toBe('LONG');
    expect(tokens.providerUserId).toBe('IG1');
    expect(tokens.grantedScopes).toEqual(['instagram_business_basic', 'instagram_business_content_publish']);
    expect(http.calls[0]!.init.headers?.['Content-Type']).toContain('multipart/form-data');
    expect(http.calls[1]!.url).toContain('grant_type=ig_exchange_token');
  });

  it('refreshes long-lived tokens and names accounts from /me', async () => {
    const http = scriptedHttp([
      { match: urlContains('/refresh_access_token'), status: 200, body: { access_token: 'LONG2', expires_in: 5183944 } },
      { match: (url) => url.includes('/me?'), status: 200, body: { id: 'IG1', username: 'ada.ig' } },
    ]);
    const tokens = await instagramProvider.refreshToken({ credentials: CREDS, accessToken: 'LONG', refreshToken: null, http });
    expect(tokens.accessToken).toBe('LONG2');

    const identity = await instagramProvider.fetchIdentity({
      accessToken: 'LONG2',
      tokenSet: { accessToken: 'LONG2', refreshToken: null, expiresIn: null, refreshExpiresIn: null, grantedScopes: [], providerUserId: 'IG1' },
      http,
    });
    expect(identity).toEqual({ externalId: 'IG1', displayName: 'ada.ig' });
  });
});

describe('Facebook provider', () => {
  it('collects Pages through short -> long-lived -> accounts', async () => {
    const http = scriptedHttp([
      { match: (url) => url.includes('/oauth/access_token') && !url.includes('grant_type'), status: 200, body: { access_token: 'SHORT', expires_in: 3600 } },
      { match: (url) => url.includes('grant_type=fb_exchange_token'), status: 200, body: { access_token: 'LONGUSER', expires_in: 5183944 } },
      { match: (url) => url.includes('/me?'), status: 200, body: { id: 'U1', name: 'Ada' } },
      {
        match: urlContains('/accounts'),
        status: 200,
        body: { data: [{ id: 'P1', name: 'Shop', access_token: 'PAGE1', tasks: ['CREATE_CONTENT'] }] },
      },
    ]);
    const tokens = await facebookProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http });
    expect(tokens.accessToken).toBe('LONGUSER');
    expect(tokens.providerUserId).toBe('U1');
    const extra = tokens.extra as { userName: string; pages: Array<{ id: string }> };
    expect(extra.userName).toBe('Ada');
    expect(extra.pages.map((page) => page.id)).toEqual(['P1']);
    expect(facebookProvider.supportsRefresh).toBe(false);

    const error = await rejectsWith(
      facebookProvider.refreshToken({ credentials: CREDS, accessToken: 'X', refreshToken: null, http }),
    );
    expect(error.code).toBe('REFRESH_NOT_GRANTED');
  });

  it('maps Meta OAuth errors to dead grants', async () => {
    const http = scriptedHttp([
      { match: urlContains('/oauth/access_token'), status: 400, body: { error: { code: 190, type: 'OAuthException', message: 'Expired' } } },
    ]);
    const error = await rejectsWith(
      facebookProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http }),
    );
    expect(error.code).toBe('INVALID_GRANT');
  });
});

describe('Provider error hygiene', () => {
  it('truncates provider messages and classifies rate limits', async () => {
    const http = scriptedHttp([
      { match: urlContains('oauth/token'), status: 503, body: { error: 'x', error_description: 'y'.repeat(1000) } },
    ]);
    const error = await rejectsWith(
      tiktokProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http }),
    );
    expect(error.code).toBe('PROVIDER_HTTP');
    expect(error.message.length).toBeLessThanOrEqual(340);
    expect(error.retryable).toBe(true);

    const limited = scriptedHttp([{ match: urlContains('oauth/token'), status: 429, body: {} }]);
    const rate = await rejectsWith(
      tiktokProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http: limited }),
    );
    expect(rate.code).toBe('RATE_LIMITED');
    expect(rate.retryable).toBe(true);
  });

  it('rejects malformed token responses without secrets in the message', async () => {
    const http = scriptedHttp([{ match: urlContains('oauth2.googleapis.com/token'), status: 200, body: { expires_in: 1 } }]);
    const error = await rejectsWith(
      youtubeProvider.exchangeCode({ code: 'C', redirectUri: REDIRECT, credentials: CREDS, http }),
    );
    expect(error.code).toBe('PROVIDER_MALFORMED');
    expect(error.message).not.toContain('CSECRET');
  });
});

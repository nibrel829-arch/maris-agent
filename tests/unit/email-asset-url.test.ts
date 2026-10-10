import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSET_URL_TTL_SECONDS,
  assetSigningSecret,
  buildSignedAssetUrl,
  resolveRequestOrigin,
  verifyAssetToken,
} from '@/server/email/asset-url';
import { createAssetUrlResolver } from '@/server/email/design-service';

const MEDIA_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-000000000002';
const OTHER_MEDIA = '22222222-2222-2222-2222-222222222222';

function signed(mediaId = MEDIA_ID, organizationId = ORG_ID, ttlSeconds?: number) {
  return buildSignedAssetUrl({
    mediaId,
    organizationId,
    baseUrl: 'https://os.nibrexo.test',
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
  });
}

function params(url: string) {
  const query = new URL(url).searchParams;
  return {
    exp: query.get('exp'),
    org: query.get('org'),
    sig: query.get('sig'),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Signed Content Library asset URLs', () => {
  it('builds an absolute URL that carries an expiring signature', () => {
    const result = signed();
    expect(result.url).toMatch(/^https:\/\/os\.nibrexo\.test\/api\/workspace\/email\/assets\//);
    expect(result.url).toContain(MEDIA_ID);
    expect(result.url).toContain('exp=');
    expect(result.url).toContain('org=');
    expect(result.url).toContain('sig=');
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(ASSET_URL_TTL_SECONDS).toBe(60 * 60 * 24 * 30);
  });

  it('verifies a signature it issued', () => {
    const result = signed();
    const { exp, org, sig } = params(result.url);
    const verified = verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp, sig });
    expect(verified.ok).toBe(true);
    expect(verified.reason).toBeNull();
    expect(org).toBe(ORG_ID);
  });

  it('rejects a token for another organization', () => {
    const { exp, sig } = params(signed().url);
    const verified = verifyAssetToken({ mediaId: MEDIA_ID, organizationId: OTHER_ORG, exp, sig });
    expect(verified.ok).toBe(false);
    expect(verified.reason).toMatch(/mismatch/i);
  });

  it('rejects a token for another asset', () => {
    const { exp, sig } = params(signed().url);
    expect(verifyAssetToken({ mediaId: OTHER_MEDIA, organizationId: ORG_ID, exp, sig }).ok).toBe(false);
  });

  it('rejects a tampered, truncated or missing signature', () => {
    const { exp, org, sig } = params(signed().url);
    const forged = `${sig?.slice(0, -2)}xy`;
    expect(verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp, sig: forged }).ok).toBe(false);
    expect(verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp, sig: null }).ok).toBe(false);
    expect(verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp: null, sig }).ok).toBe(false);
    expect(verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp: 'not-a-number', sig }).ok).toBe(false);
    expect(verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp: org, sig }).ok).toBe(false);
  });

  it('rejects an expired token', () => {
    const { exp, sig } = params(signed().url);
    const future = new Date((Number(exp) + 3600) * 1000);
    const verified = verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp, sig, now: future });
    expect(verified.ok).toBe(false);
    expect(verified.reason).toMatch(/expired/i);
  });

  it('honours a custom TTL', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = signed(MEDIA_ID, ORG_ID, 3600);
    expect(result.expiresAt).toBeGreaterThanOrEqual(now + 3590);
    expect(result.expiresAt).toBeLessThanOrEqual(now + 3610);
  });

  it('has a stable signing secret per process', () => {
    expect(assetSigningSecret()?.length ?? 0).toBeGreaterThanOrEqual(32);
    expect(assetSigningSecret()).toBe(assetSigningSecret());
  });

  it('shares the ephemeral secret across module registries in one process', async () => {
    // Next.js dev evaluates a route handler in a different module registry from
    // the code that minted the URL. Both must agree on the secret, otherwise a
    // freshly compiled route rejects links the renderer just produced.
    vi.stubEnv('NODE_ENV', 'test');
    for (const name of ['NIBREXO_EMAIL_ASSET_SECRET', 'NIBREXO_TOKEN_ENCRYPTION_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']) {
      vi.stubEnv(name, '');
    }
    const first = (await import('@/server/email/asset-url')).assetSigningSecret();
    vi.resetModules();
    const second = (await import('@/server/email/asset-url')).assetSigningSecret();
    vi.unstubAllEnvs();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('derives the request origin from headers, ignoring the local host when proxied', () => {
    const request = new Request('https://os.nibrexo.test/api/workspace/email/assets/x', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'os.nibrexo.test', host: '127.0.0.1:3000' },
    });
    expect(resolveRequestOrigin(request)).toBe('https://os.nibrexo.test');
  });

  it('returns null when no base URL is known, so nothing is silently public', () => {
    const resolver = createAssetUrlResolver(ORG_ID, { baseUrl: null });
    expect(resolver(MEDIA_ID)).toBeNull();
  });

  it('produces different signatures for different organizations', () => {
    expect(signed(MEDIA_ID, ORG_ID).url).not.toBe(signed(MEDIA_ID, OTHER_ORG).url);
  });
});

/**
 * Phase 17 regression tests: email asset signing key, expiry, origin and the
 * byte-serving security headers.
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MEDIA_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-000000000002';
const SIGNING_VARS = [
  'NIBREXO_EMAIL_ASSET_SECRET',
  'NIBREXO_TOKEN_ENCRYPTION_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'NIBREXO_APP_URL',
];

function clearSigningEnv(): void {
  for (const name of SIGNING_VARS) vi.stubEnv(name, '');
}

async function loadAssetModule() {
  vi.resetModules();
  return import('@/server/email/asset-url');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('asset signing key resolution (Phase 17)', () => {
  it('never derives a signing key from the public Supabase URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    const assets = await loadAssetModule();

    expect(assets.assetSigningSource()).toBe('none');
    expect(assets.assetSigningSecret()).toBeNull();
    expect(assets.hasDurableAssetSecret()).toBe(false);
  });

  it('rejects a link forged with the old public-URL-derived key', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    const assets = await loadAssetModule();

    // The pre-Phase-17 key formula, computable by anyone who reads the bundle.
    const publicKey = 'nibrexo-email-assets:origin:https://abc.supabase.co';
    const exp = String(Math.floor(Date.now() / 1000) + 3600);
    const forged = createHmac('sha256', publicKey).update(`${MEDIA_ID}.${ORG_ID}.${exp}`).digest('hex');

    const check = assets.verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp, sig: forged });
    expect(check.ok).toBe(false);
  });

  it('refuses to mint a link in production without a durable key', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    const assets = await loadAssetModule();

    expect(() =>
      assets.buildSignedAssetUrl({ mediaId: MEDIA_ID, organizationId: ORG_ID, baseUrl: 'https://os.nibrexo.test' }),
    ).toThrow(assets.AssetSigningUnavailableError);
  });

  it('uses the dedicated secret first and reports only its name', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    vi.stubEnv('NIBREXO_EMAIL_ASSET_SECRET', 'dedicated-secret-value-0123456789abcdef');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-value');
    const assets = await loadAssetModule();

    expect(assets.assetSigningSource()).toBe('NIBREXO_EMAIL_ASSET_SECRET');
    expect(assets.hasDurableAssetSecret()).toBe(true);
    const signed = assets.buildSignedAssetUrl({ mediaId: MEDIA_ID, organizationId: ORG_ID, baseUrl: 'https://os.nibrexo.test' });
    const query = new URL(signed.url).searchParams;
    expect(assets.verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp: query.get('exp'), sig: query.get('sig') }).ok).toBe(true);
    expect(JSON.stringify(assets)).not.toContain('dedicated-secret-value');
  });

  it('treats the service-role key as a durable server-only fallback', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-value');
    const assets = await loadAssetModule();

    expect(assets.assetSigningSource()).toBe('SUPABASE_SERVICE_ROLE_KEY');
    expect(assets.hasDurableAssetSecret()).toBe(true);
  });

  it('keeps the per-process ephemeral key outside production only', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    clearSigningEnv();
    const assets = await loadAssetModule();

    expect(assets.assetSigningSource()).toBe('ephemeral');
    expect(assets.hasDurableAssetSecret()).toBe(false);
    expect(assets.assetSigningSecret()).not.toBeNull();
  });
});

describe('asset token expiry and organization shape', () => {
  it('accepts only canonical decimal expiries', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NIBREXO_EMAIL_ASSET_SECRET', 'expiry-test-secret-0123456789abcdef0123');
    const assets = await loadAssetModule();
    const signed = assets.buildSignedAssetUrl({ mediaId: MEDIA_ID, organizationId: ORG_ID, baseUrl: 'https://x.test' });
    const query = new URL(signed.url).searchParams;
    const sig = query.get('sig');
    const exp = query.get('exp') ?? '';

    expect(assets.verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp, sig }).ok).toBe(true);
    expect(assets.verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp: `0${exp}`, sig }).ok).toBe(false);
    expect(assets.verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp: `+${exp}`, sig }).ok).toBe(false);
    expect(assets.verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp: `${exp}abc`, sig }).ok).toBe(false);
    expect(assets.verifyAssetToken({ mediaId: MEDIA_ID, organizationId: ORG_ID, exp: ' ' + exp, sig }).ok).toBe(false);
  });

  it('validates the organization id shape', async () => {
    const assets = await loadAssetModule();
    expect(assets.isOrganizationIdShape(ORG_ID)).toBe(true);
    expect(assets.isOrganizationIdShape(OTHER_ORG)).toBe(true);
    expect(assets.isOrganizationIdShape('not-a-uuid')).toBe(false);
    expect(assets.isOrganizationIdShape(`${ORG_ID}&x=1`)).toBe(false);
  });
});

describe('public origin for asset links', () => {
  it('uses a valid https NIBREXO_APP_URL origin and drops any path', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    vi.stubEnv('NIBREXO_APP_URL', 'https://os.nibrexo.test/some/path/');
    const assets = await loadAssetModule();
    const request = new Request('https://internal.example/api/x');

    expect(assets.appUrlStatus()).toBe('valid');
    expect(assets.resolveRequestOrigin(request)).toBe('https://os.nibrexo.test');
  });

  it('rejects a non-https origin in production and falls back to the request origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    vi.stubEnv('NIBREXO_APP_URL', 'http://os.nibrexo.test');
    const assets = await loadAssetModule();
    const request = new Request('https://os.nibrexo.test/api/x');

    expect(assets.appUrlStatus()).toBe('invalid');
    expect(assets.resolveRequestOrigin(request)).toBe('https://os.nibrexo.test');
  });

  it('rejects credentials embedded in NIBREXO_APP_URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    vi.stubEnv('NIBREXO_APP_URL', 'https://user:pass@os.nibrexo.test');
    const assets = await loadAssetModule();

    expect(assets.appUrlStatus()).toBe('invalid');
  });

  it('reports an unset NIBREXO_APP_URL as unset', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    clearSigningEnv();
    const assets = await loadAssetModule();
    expect(assets.appUrlStatus()).toBe('unset');
  });
});

describe('design resolver in production without a key', () => {
  it('emits no image URL instead of an unverifiable or public link', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    vi.resetModules();
    const { createAssetUrlResolver } = await import('@/server/email/design-service');

    const resolver = createAssetUrlResolver(ORG_ID, { baseUrl: 'https://os.nibrexo.test' });
    expect(resolver(MEDIA_ID)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Route-level behaviour                                                       */
/* -------------------------------------------------------------------------- */

const jobRepoGet = vi.fn();
const requestRepoGet = vi.fn();
const download = vi.fn();
const getJobRepository = vi.fn();
const getRequestRepository = vi.fn();
const getRequestMediaStorage = vi.fn();
const getJobMediaStorage = vi.fn();
const resolveActor = vi.fn();
const resolveMediaFile = vi.fn();

vi.mock('@/server/db', () => ({ getJobRepository, getRequestRepository }));
vi.mock('@/server/content/storage', () => ({ getRequestMediaStorage, getJobMediaStorage }));
vi.mock('@/server/content/service', () => ({
  filenameFromStoragePath: (path: string) => path.split('/').pop() ?? 'file',
  resolveMediaFile,
}));
vi.mock('@/server/auth/actor', () => ({ resolveActor }));

describe('signed asset route', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    clearSigningEnv();
    vi.stubEnv('NIBREXO_EMAIL_ASSET_SECRET', 'route-test-secret-0123456789abcdef0123456789');
    jobRepoGet.mockReset();
    requestRepoGet.mockReset();
    download.mockReset();
    getJobRepository.mockReset().mockReturnValue({
      ok: true,
      data: { mediaFiles: { get: jobRepoGet } },
    });
    getRequestRepository.mockReset().mockResolvedValue({
      ok: true,
      data: { mediaFiles: { get: requestRepoGet } },
    });
    getRequestMediaStorage.mockReset().mockResolvedValue({ ok: true, data: { download } });
    getJobMediaStorage.mockReset().mockResolvedValue({ ok: true, data: { download } });
  });

  async function signedRequest(mediaId = MEDIA_ID, organizationId = ORG_ID) {
    const assets = await loadAssetModule();
    const signed = assets.buildSignedAssetUrl({
      mediaId,
      organizationId,
      baseUrl: 'https://os.nibrexo.test',
    });
    return new Request(signed.url);
  }

  it('serves a valid token with the sandbox and no-sniff headers', async () => {
    const { GET } = await import('@/app/api/workspace/email/assets/[mediaId]/route');
    jobRepoGet.mockResolvedValue({ storage_path: `${ORG_ID}/logo.svg` });
    download.mockResolvedValue({ bytes: new Uint8Array([60, 115, 118, 103]), mimeType: 'image/svg+xml' });

    const response = await GET(await signedRequest(), { params: Promise.resolve({ mediaId: MEDIA_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    // The row is read with the organization filter from the verified token.
    expect(jobRepoGet).toHaveBeenCalledWith(MEDIA_ID, ORG_ID);
    // Regression: a recipient has no session, so the bytes must come from the
    // server-only storage client, never the session-bound one (RLS would deny).
    expect(getJobMediaStorage).toHaveBeenCalledTimes(1);
    expect(getRequestMediaStorage).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith(`${ORG_ID}/logo.svg`);
  });

  it('returns not found, not a storage error, when the bytes are missing', async () => {
    const { GET } = await import('@/app/api/workspace/email/assets/[mediaId]/route');
    jobRepoGet.mockResolvedValue({ storage_path: `${ORG_ID}/gone.png` });
    download.mockResolvedValue(null);

    const response = await GET(await signedRequest(), { params: Promise.resolve({ mediaId: MEDIA_ID }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    // The error never echoes the storage path.
    expect(JSON.stringify(body)).not.toContain(ORG_ID);
  });

  it('rejects a token presented against another organization', async () => {
    const { GET } = await import('@/app/api/workspace/email/assets/[mediaId]/route');
    const url = new URL((await signedRequest(MEDIA_ID, ORG_ID)).url);
    url.searchParams.set('org', OTHER_ORG);

    const response = await GET(new Request(url), { params: Promise.resolve({ mediaId: MEDIA_ID }) });

    expect(response.status).toBe(403);
    expect(jobRepoGet).not.toHaveBeenCalled();
  });

  it('rejects a malformed organization parameter before verification', async () => {
    const { GET } = await import('@/app/api/workspace/email/assets/[mediaId]/route');
    const url = new URL((await signedRequest()).url);
    url.searchParams.set('org', 'x&sig=1');

    const response = await GET(new Request(url), { params: Promise.resolve({ mediaId: MEDIA_ID }) });

    expect(response.status).toBe(400);
  });

  it('refuses every request when no durable key is configured in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    clearSigningEnv();
    const { GET } = await import('@/app/api/workspace/email/assets/[mediaId]/route');
    const assets = await loadAssetModule();
    // A token minted under a different key must not verify.
    const otherKey = createHmac('sha256', 'nibrexo-email-assets:other-key')
      .update(`${MEDIA_ID}.${ORG_ID}.${Math.floor(Date.now() / 1000) + 600}`)
      .digest('hex');
    const exp = String(Math.floor(Date.now() / 1000) + 600);
    const url = `https://os.nibrexo.test/api/workspace/email/assets/${MEDIA_ID}?exp=${exp}&org=${ORG_ID}&sig=${otherKey}`;
    expect(assets.assetSigningSource()).toBe('none');

    const response = await GET(new Request(url), { params: Promise.resolve({ mediaId: MEDIA_ID }) });
    expect(response.status).toBe(403);
  });
});

describe('content media file route', () => {
  it('sandboxes bytes served from the application origin', async () => {
    vi.resetModules();
    resolveActor.mockResolvedValue({ ok: true, data: { organizationId: ORG_ID, userId: 'u', role: 'owner' } });
    getRequestRepository.mockResolvedValue({ ok: true, data: {} });
    getRequestMediaStorage.mockResolvedValue({ ok: true, data: {} });
    resolveMediaFile.mockResolvedValue({
      ok: true,
      data: {
        kind: 'bytes',
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/svg+xml',
        filename: 'x.svg',
      },
    });
    const { GET } = await import('@/app/api/workspace/content/media/[id]/file/route');

    const response = await GET(new Request(`https://os.nibrexo.test/api/workspace/content/media/${MEDIA_ID}/file`), {
      params: Promise.resolve({ id: MEDIA_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

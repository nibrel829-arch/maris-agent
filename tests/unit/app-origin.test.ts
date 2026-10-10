/**
 * Phase 18 regression tests: the public origin used for email asset links and
 * social OAuth redirects must be https in production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  const origin = await import('@/lib/app-origin');
  const social = await import('@/server/social/service');
  return { origin, social };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('configuredAppOrigin', () => {
  it('keeps only the origin of a valid https NIBREXO_APP_URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NIBREXO_APP_URL', 'https://os.nibrexo.test/some/path/');
    const { origin } = await load();
    expect(origin.configuredAppOrigin()).toBe('https://os.nibrexo.test');
    expect(origin.appUrlStatus()).toBe('valid');
  });

  it('refuses http in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NIBREXO_APP_URL', 'http://os.nibrexo.test');
    const { origin } = await load();
    expect(origin.configuredAppOrigin()).toBeNull();
    expect(origin.appUrlStatus()).toBe('invalid');
  });

  it('allows http outside production for local development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NIBREXO_APP_URL', 'http://localhost:3000');
    const { origin } = await load();
    expect(origin.configuredAppOrigin()).toBe('http://localhost:3000');
  });

  it('refuses credentials embedded in the URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NIBREXO_APP_URL', 'https://user:pw@os.nibrexo.test');
    const { origin } = await load();
    expect(origin.configuredAppOrigin()).toBeNull();
  });
});

describe('social OAuth redirect URI', () => {
  it('uses the validated https origin when configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NIBREXO_APP_URL', 'https://os.nibrexo.test');
    const { social } = await load();
    expect(social.buildRedirectUri('facebook' as never, 'https://elsewhere.test')).toBe(
      'https://os.nibrexo.test/api/workspace/social/callback/facebook',
    );
  });

  it('ignores an http NIBREXO_APP_URL in production and uses the https request origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NIBREXO_APP_URL', 'http://os.nibrexo.test');
    const { social } = await load();
    const uri = social.buildRedirectUri('facebook' as never, 'https://request.test');
    expect(uri.startsWith('https://request.test/')).toBe(true);
    expect(uri).not.toMatch(/^http:/);
  });

  it('refuses an http request origin in production rather than emitting an insecure redirect', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NIBREXO_APP_URL', '');
    const { social } = await load();
    expect(() => social.buildRedirectUri('facebook' as never, 'http://request.test')).toThrow(
      /https in production/,
    );
  });

  it('allows an http origin in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NIBREXO_APP_URL', '');
    const { social } = await load();
    expect(social.buildRedirectUri('facebook' as never, 'http://localhost:3000')).toBe(
      'http://localhost:3000/api/workspace/social/callback/facebook',
    );
  });
});

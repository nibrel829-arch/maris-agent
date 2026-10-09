import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('environment data backend boundary', () => {
  it('never selects the in-memory repository in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NIBREXO_DATA_BACKEND', 'memory');
    const { serverEnv } = await import('@/lib/env');

    expect(serverEnv().dataBackend).toBe('supabase');
  });

  it('only permits memory when explicitly requested outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NIBREXO_DATA_BACKEND', 'memory');
    const { serverEnv } = await import('@/lib/env');

    expect(serverEnv().dataBackend).toBe('memory');
  });

  it('requires both public Supabase values before reporting Supabase configured', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    const { publicEnv } = await import('@/lib/env');

    expect(publicEnv().supabaseConfigured).toBe(false);
  });

  it('accepts the current public publishable-key name used by the Supabase integration', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    const { publicEnv } = await import('@/lib/env');

    expect(publicEnv().supabaseConfigured).toBe(true);
    expect(publicEnv().supabasePublicKeySource).toBe('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });

  it('does not treat a Cloudflare token as an enabled image runtime', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NIBREXO_IMAGE_PROVIDER', 'cloudflare');
    vi.stubEnv('NIBREXO_LOCAL_IMAGE_URL', '');
    vi.stubEnv('NIBREXO_IMAGE_ENGINE_URL', '');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-test');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token-test');
    const { serverEnv } = await import('@/lib/env');
    expect(serverEnv().imageGenerationConfigured).toBe(false);

    vi.stubEnv('NIBREXO_IMAGE_ENGINE_URL', 'http://127.0.0.1:8788');
    expect(serverEnv().imageGenerationConfigured).toBe(true);
    expect(serverEnv().imageEngineUrl).toBe('http://127.0.0.1:8788/');
  });

  it('accepts the current server-only secret key name for privileged jobs', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-server-secret');
    const { serverEnv } = await import('@/lib/env');

    expect(serverEnv().supabaseServiceKeySource).toBe('SUPABASE_SECRET_KEY');
    expect(serverEnv().supabaseServiceRoleKey).toBe('test-server-secret');
  });
});

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

  it('accepts the current server-only secret key name for privileged jobs', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-server-secret');
    const { serverEnv } = await import('@/lib/env');

    expect(serverEnv().supabaseServiceKeySource).toBe('SUPABASE_SECRET_KEY');
    expect(serverEnv().supabaseServiceRoleKey).toBe('test-server-secret');
  });
});

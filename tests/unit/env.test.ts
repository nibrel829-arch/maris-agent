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
    const { publicEnv } = await import('@/lib/env');

    expect(publicEnv().supabaseConfigured).toBe(false);
  });
});

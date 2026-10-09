import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpretToolOutput, listCapabilities } from '@/server/manager/capability-registry';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('capability registry', () => {
  it('marks Arena image generation unsupported and Google Vids assisted', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    const { listCapabilities: load } = await import('@/server/manager/capability-registry');
    const records = load();
    expect(records.find((record) => record.id === 'image.arena')?.status).toBe('unsupported');
    expect(records.find((record) => record.id === 'image.openai')?.status).toBe('unsupported');
    expect(records.find((record) => record.id === 'video.google_vids')?.status).toBe('assisted');
    expect(records.find((record) => record.id === 'image.generate')?.status).toBe('needs_configuration');
    expect(records.find((record) => record.id === 'research.free')?.status).toBe('available');
    expect(records.find((record) => record.id === 'research.web')?.status).toBe('needs_configuration');
    expect(records.find((record) => record.id === 'research.deepseek')?.status).toBe('needs_configuration');
    expect(records.find((record) => record.id === 'content.library')?.status).toBe('available');
  });

  it('reports configured providers as available without echoing secrets', async () => {
    const secret = 'sk-test-secret-should-not-leak';
    vi.stubEnv('OPENAI_API_KEY', secret);
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-test-secret');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-test-secret');
    vi.stubEnv('NIBREXO_ALLOW_PAID_SYNTHESIS', '0');
    vi.stubEnv('NIBREXO_ALLOW_PAID_SEARCH', '0');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cloudflare-test-secret');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-test');
    const { listCapabilities: load } = await import('@/server/manager/capability-registry');
    const serialized = JSON.stringify(load());
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('deepseek-test-secret');
    expect(serialized).not.toContain('brave-test-secret');
    expect(serialized).not.toContain('cloudflare-test-secret');
    expect(serialized).toContain('available');
    expect(serialized).toContain('CLOUDFLARE_API_TOKEN');
    expect(serialized).not.toContain('Paid synthesis is explicitly allowed');
    const image = load().find((record) => record.id === 'image.generate');
    expect(image?.status).toBe('needs_configuration');
    expect(image?.statusDetail).toMatch(/token alone/i);
  });

  it('treats an unexecuted assisted or unconfigured tool result as blocked', () => {
    expect(
      interpretToolOutput({ capabilityStatus: 'needs_configuration', executed: false, message: 'Missing key' }).blocked,
    ).toBe(true);
    expect(interpretToolOutput({ capabilityStatus: 'assisted', executed: false, message: 'Do it in Vids' }).blocked).toBe(
      true,
    );
    expect(interpretToolOutput({ capabilityStatus: 'assisted', executed: true, message: 'Draft saved' }).blocked).toBe(
      false,
    );
    expect(interpretToolOutput({ capabilityStatus: 'quota_exhausted', executed: false, message: 'Quota used' }).issue?.code).toBe(
      'QUOTA_EXHAUSTED',
    );
    expect(interpretToolOutput({ brief: { id: 'x' } }).blocked).toBe(false);
  });

  it('lists an implementation path and operations for every capability', () => {
    for (const record of listCapabilities()) {
      expect(record.implementation.length).toBeGreaterThan(3);
      expect(record.limitations.length).toBeGreaterThan(0);
      expect(record.evidence.length).toBeGreaterThan(10);
      expect(['available', 'needs_configuration', 'assisted', 'unsupported']).toContain(record.status);
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailProvider } from '@/server/integrations/email/provider';
import { getSocialAdapter, listAdapters } from '@/server/integrations/social/adapter';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('honest integration states', () => {
  it('reports an unverified social publish as unsupported rather than successful', async () => {
    const outcome = await getSocialAdapter('linkedin').publish({
      organizationId: '00000000-0000-0000-0000-000000000001',
      accountId: '00000000-0000-0000-0000-000000000002',
      contentId: '00000000-0000-0000-0000-000000000003',
      platform: 'linkedin',
      caption: 'A prepared post',
      mediaUrl: null,
      idempotencyKey: 'integration-test',
    });

    expect(outcome.status).toBe('unsupported');
    if (outcome.status !== 'unsupported') throw new Error('Expected unsupported social outcome.');
    expect(outcome.reason).toMatch(/not implemented/i);
    expect(listAdapters().every((adapter) => !adapter.configured)).toBe(true);
  });

  it('reports an absent email provider as not configured rather than sending', async () => {
    vi.stubEnv('NIBREXO_EMAIL_PROVIDER', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('NIBREXO_EMAIL_FROM', '');
    const outcome = await createEmailProvider().send({
      organizationId: '00000000-0000-0000-0000-000000000001',
      to: 'clinic@example.com',
      subject: 'Follow-up',
      html: '<p>Hello</p>',
      text: 'Hello',
      idempotencyKey: 'integration-test',
    });

    expect(outcome.status).toBe('not_configured');
  });
});

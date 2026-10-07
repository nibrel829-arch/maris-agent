import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailProvider } from '@/server/integrations/email/provider';
import { getSocialAdapter, listAdapters } from '@/server/integrations/social/adapter';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('honest integration states', () => {
  it('reports an unconfigured execution environment as not_configured rather than successful', async () => {
    const outcome = await getSocialAdapter('linkedin').publish({
      organizationId: '00000000-0000-0000-0000-000000000001',
      accountId: '00000000-0000-0000-0000-000000000002',
      contentId: '00000000-0000-0000-0000-000000000003',
      platform: 'linkedin',
      caption: 'A prepared post',
      mediaUrl: null,
      idempotencyKey: 'integration-test',
    });

    expect(outcome.status).toBe('not_configured');
    if (outcome.status !== 'not_configured') throw new Error('Expected not_configured social outcome.');
    expect(outcome.reason).toMatch(/not configured/i);
  });

  it('reports the Contra publishing capability as false (no public publishing API)', async () => {
    const outcome = await getSocialAdapter('contra').publish({
      organizationId: '00000000-0000-0000-0000-000000000001',
      accountId: '00000000-0000-0000-0000-000000000002',
      contentId: '00000000-0000-0000-0000-000000000003',
      platform: 'contra',
      caption: 'A prepared post',
      mediaUrl: null,
      idempotencyKey: 'integration-test-contra',
    });

    expect(outcome.status).toBe('not_configured');
    expect(listAdapters().find((adapter) => adapter.platform === 'contra')?.capabilities.publish).toBe(false);
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

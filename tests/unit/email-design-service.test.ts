import { describe, expect, it } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import {
  createDesign,
  deleteBrandSection,
  deleteDesign,
  duplicateDesign,
  getBrandProfile,
  getDesign,
  listDesigns,
  promoteDesignToTemplate,
  renderDesign,
  renderDraftDesign,
  saveBrandSection,
  sendDesignTestEmail,
  updateBrandProfile,
  updateDesign,
} from '@/server/email/design-service';
import { getStarterTemplate } from '@/server/email/starter-templates';
import { brandProfileSchema } from '@/server/email/design-validation';
import type { EmailProvider } from '@/server/integrations/email/provider';
import { createBlock, emptyDesignDocument } from '@/features/email/studio/block-defaults';
import { DEFAULT_EMAIL_BRAND_PROFILE, DEFAULT_EMAIL_BRAND_TOKENS } from '@/types/email-design';

const launch = getStarterTemplate('starter-product-launch');

if (!launch) throw new Error('starter-product-launch must exist');

function simpleDocument(unsubscribeUrl = 'https://nibrexo.test/unsubscribe') {
  const base = emptyDesignDocument(DEFAULT_EMAIL_BRAND_PROFILE);
  base.blocks = [
    createBlock('hero', { brand: base.brand, profile: null }),
    createBlock('footer', { brand: base.brand, profile: null }),
  ];
  const hero = base.blocks[0];
  if (hero?.type === 'hero') {
    hero.props.headline = 'Hello there';
    hero.props.cta = { label: 'Open', url: 'https://nibrexo.test/open' };
  }
  const footer = base.blocks[1];
  if (footer?.type === 'footer') {
    footer.props.companyName = 'Nibrexo Ltd';
    footer.props.unsubscribeUrl = unsubscribeUrl;
  }
  return base;
}

function fakeProvider(mode: 'sent' | 'failed' | 'not_configured' = 'sent') {
  const calls: Array<{ to: string; subject: string; html: string; idempotencyKey: string }> = [];
  const provider: EmailProvider = {
    name: 'resend',
    isConfigured: () => mode !== 'not_configured',
    async send(email) {
      calls.push(email);
      if (mode === 'sent') {
        return { status: 'sent', provider: 'resend', providerMessageId: 're_test_123' };
      }
      if (mode === 'not_configured') {
        return { status: 'not_configured', reason: 'No email provider is configured.' };
      }
      return { status: 'failed', reason: 'Provider rejected the message', retryable: false };
    },
  };
  return { provider, calls };
}

describe('Email design studio service', () => {
  it('creates a design as a draft scoped to the actor organization', async () => {
    const store = repo();
    const owner = actor();
    const result = await createDesign(owner, store, {
      name: 'Launch email',
      category: 'campaign',
      subject: 'Introducing {{product.name}}',
      design: simpleDocument(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.organization_id).toBe(TEST_ORG);
    expect(result.data.status).toBe('draft');
    expect(result.data.source).toBe('studio');
    expect(result.data.design.blocks.length).toBe(2);

    const audit = await store.activityLogs.list(TEST_ORG);
    expect(audit.some((row) => row.action === 'email.design.created' && row.entity_id === result.data.id)).toBe(true);
  });

  it('rejects an invalid design document', async () => {
    const store = repo();
    const result = await createDesign(actor(), store, {
      name: 'Broken',
      category: 'test',
      subject: 'Broken',
      design: { blocks: [{ id: 'x', type: 'nope' }] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DESIGN_INVALID');
  });

  it('keeps designs invisible across organizations', async () => {
    const store = repo();
    const created = await createDesign(actor(), store, {
      name: 'Private',
      category: 'campaign',
      subject: 'Private',
      design: simpleDocument(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outsider = actor({ organizationId: OTHER_ORG });
    expect((await getDesign(outsider, store, created.data.id)).ok).toBe(false);
    expect((await updateDesign(outsider, store, created.data.id, { name: 'Stolen' })).ok).toBe(false);
    expect((await deleteDesign(outsider, store, created.data.id)).ok).toBe(false);

    const listed = await listDesigns(outsider, store, { limit: 20, offset: 0 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.total).toBe(0);
  });

  it('updates, duplicates and deletes a design', async () => {
    const store = repo();
    const owner = actor();
    const created = await createDesign(owner, store, {
      name: 'Original',
      category: 'campaign',
      subject: 'Original',
      design: simpleDocument(),
    });
    if (!created.ok) throw new Error('create failed');

    const renamed = await updateDesign(owner, store, created.data.id, {
      name: 'Renamed',
      status: 'active',
    });
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.data.name).toBe('Renamed');
      expect(renamed.data.status).toBe('active');
    }

    const copy = await duplicateDesign(owner, store, created.data.id, 'Original (copy)');
    expect(copy.ok).toBe(true);
    if (copy.ok) {
      expect(copy.data.id).not.toBe(created.data.id);
      expect(copy.data.status).toBe('draft');
      expect(copy.data.design.blocks.length).toBe(created.data.design.blocks.length);
    }

    const removed = await deleteDesign(owner, store, created.data.id);
    expect(removed.ok).toBe(true);
    expect((await getDesign(owner, store, created.data.id)).ok).toBe(false);
  });

  it('renders a stored design through the signed asset resolver', async () => {
    const store = repo();
    const owner = actor();
    const document = simpleDocument();
    const mediaId = '33333333-3333-3333-3333-333333333333';
    const hero = document.blocks[0];
    if (hero?.type === 'hero') hero.props.image = { mediaId, url: null, alt: 'Hero' };

    const created = await createDesign(owner, store, {
      name: 'Render me',
      category: 'campaign',
      subject: 'Render me',
      design: document,
    });
    if (!created.ok) throw new Error('create failed');

    const rendered = await renderDesign(owner, store, created.data.id, {
      baseUrl: 'https://os.nibrexo.test',
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.data.html).toContain(`/api/workspace/email/assets/${mediaId}`);
    expect(rendered.data.html).toContain('sig=');
    expect(rendered.data.validation.ok).toBe(true);
    expect(rendered.data.text).toContain('Unsubscribe');
  });

  it('renders an unsaved document without persisting anything', async () => {
    const store = repo();
    const owner = actor();
    const rendered = renderDraftDesign(
      owner,
      { design: simpleDocument(), subject: 'Draft preview' },
      { baseUrl: 'https://os.nibrexo.test' },
    );

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.data.subject).toBe('Draft preview');
    expect(rendered.data.html).toContain('<!DOCTYPE html>');

    const listed = await listDesigns(owner, store, { limit: 20, offset: 0 });
    expect(listed.ok && listed.data.total).toBe(0);
  });

  it('promotes a design into the existing email_templates table as a draft', async () => {
    const store = repo();
    const owner = actor();
    const created = await createDesign(owner, store, {
      name: 'Promote me',
      category: 'campaign',
      subject: 'Promote me',
      design: simpleDocument(),
    });
    if (!created.ok) throw new Error('create failed');

    const promoted = await promoteDesignToTemplate(owner, store, created.data.id, {});
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;

    expect(promoted.data.template.organization_id).toBe(TEST_ORG);
    expect(promoted.data.template.status).toBe('draft');
    expect(promoted.data.template.body).toContain('<!DOCTYPE html>');
    expect(promoted.data.template.body.length).toBeGreaterThan(500);
    expect(promoted.data.design.template_id).toBe(promoted.data.template.id);

    // Only active templates are selectable for sending, so a promoted draft is
    // not usable for a campaign until it is explicitly activated.
    const active = (await store.emailTemplates.list(TEST_ORG)).filter(
      (template) => (template.status ?? 'active') === 'active',
    );
    expect(active.some((template) => template.id === promoted.data.template.id)).toBe(false);

    // Re-promoting updates the same template instead of creating a second one.
    const again = await promoteDesignToTemplate(owner, store, created.data.id, {});
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.template.id).toBe(promoted.data.template.id);
  });

  it('refuses to promote a design with blocking validation errors', async () => {
    const store = repo();
    const owner = actor();
    const created = await createDesign(owner, store, {
      name: 'No unsubscribe',
      category: 'campaign',
      subject: 'No unsubscribe',
      design: simpleDocument(''),
    });
    if (!created.ok) throw new Error('create failed');

    const promoted = await promoteDesignToTemplate(owner, store, created.data.id, {});
    expect(promoted.ok).toBe(false);
    if (promoted.ok) return;
    expect(promoted.error.code).toBe('EMAIL_DESIGN_INVALID');
  });

  it('sends a test email through the existing provider and records the outcome', async () => {
    const store = repo();
    const owner = actor();
    const created = await createDesign(owner, store, {
      name: 'Test send',
      category: 'campaign',
      subject: 'Test send',
      design: simpleDocument(),
    });
    if (!created.ok) throw new Error('create failed');

    const { provider, calls } = fakeProvider('sent');
    const result = await sendDesignTestEmail(
      owner,
      store,
      created.data.id,
      { to: 'designer@nibrexo.test', variables: {} },
      { providerOverride: provider, baseUrl: 'https://os.nibrexo.test' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('SENT');
    expect(result.data.providerMessageId).toBe('re_test_123');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.html).toContain('<!DOCTYPE html>');
    expect(calls[0]?.subject).toContain('[Test]');

    const logs = await store.emailLogs.list(TEST_ORG);
    expect(logs.some((log) => log.to_email === 'designer@nibrexo.test' && log.status === 'SENT')).toBe(true);

    // Idempotent per (design, recipient): the same test address is not sent twice.
    const second = await sendDesignTestEmail(
      owner,
      store,
      created.data.id,
      { to: 'designer@nibrexo.test', variables: {} },
      { providerOverride: provider, baseUrl: 'https://os.nibrexo.test' },
    );
    expect(second.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('reports a failed test send without pretending it worked', async () => {
    const store = repo();
    const owner = actor();
    const created = await createDesign(owner, store, {
      name: 'Test fail',
      category: 'campaign',
      subject: 'Test fail',
      design: simpleDocument(),
    });
    if (!created.ok) throw new Error('create failed');

    const { provider } = fakeProvider('failed');
    const result = await sendDesignTestEmail(
      owner,
      store,
      created.data.id,
      { to: 'designer@nibrexo.test', variables: {} },
      { providerOverride: provider },
    );
    // The service reports the provider outcome; it never fabricates a success.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMAIL_SEND_FAILED');
    expect(result.error.message).toMatch(/Provider rejected/);

    const logs = await store.emailLogs.list(TEST_ORG);
    expect(logs.some((log) => log.to_email === 'designer@nibrexo.test' && log.status === 'FAILED')).toBe(true);
  });

  it('requires send permission for a test email', async () => {
    const store = repo();
    const owner = actor();
    const created = await createDesign(owner, store, {
      name: 'No permission',
      category: 'campaign',
      subject: 'No permission',
      design: simpleDocument(),
    });
    if (!created.ok) throw new Error('create failed');

    const member = actor({ role: 'member' });
    const result = await sendDesignTestEmail(member, store, created.data.id, { to: 'x@nibrexo.test', variables: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('Brand & design system', () => {
  const brandInput = brandProfileSchema.parse({
    brandName: 'Nibrexo',
    logo: { mediaId: null, url: null, alt: 'Nibrexo logo' },
    colors: { primary: '#123456' },
  });

  it('defaults to the documented brand profile when nothing is saved', async () => {
    const store = repo();
    const result = await getBrandProfile(actor(), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recordId).toBeNull();
    expect(result.data.profile.brandName).toBe(DEFAULT_EMAIL_BRAND_PROFILE.brandName);
  });

  it('lets an owner save the organization brand profile', async () => {
    const store = repo();
    const saved = await updateBrandProfile(actor(), store, brandInput);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.profile.brandName).toBe('Nibrexo');
    expect(saved.data.profile.colors.primary).toBe('#123456');

    const reread = await getBrandProfile(actor(), store);
    expect(reread.ok && reread.data.profile.colors.primary).toBe('#123456');
  });

  it('rejects a brand change from a member', async () => {
    const store = repo();
    const result = await updateBrandProfile(actor({ role: 'member' }), store, brandInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  it('stores reusable sections and deletes them again', async () => {
    const store = repo();
    const owner = actor();
    const section = createBlock('promo', { brand: DEFAULT_EMAIL_BRAND_TOKENS, profile: null });

    const saved = await saveBrandSection(owner, store, { name: 'Winter promo', block: section });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.name).toBe('Winter promo');
    expect(saved.data.block.type).toBe('promo');
    const sectionId = saved.data.id;

    const reread = await getBrandProfile(owner, store);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.data.profile.savedSections).toHaveLength(1);
    expect(reread.data.profile.savedSections[0]?.name).toBe('Winter promo');

    const removed = await deleteBrandSection(owner, store, sectionId);
    expect(removed.ok).toBe(true);

    const afterDelete = await getBrandProfile(owner, store);
    expect(afterDelete.ok && afterDelete.data.profile.savedSections).toHaveLength(0);
  });

  it('keeps the brand profile inside one organization', async () => {
    const store = repo();
    await updateBrandProfile(actor(), store, brandInput);
    const outsider = await getBrandProfile(actor({ organizationId: OTHER_ORG }), store);
    expect(outsider.ok).toBe(true);
    if (!outsider.ok) return;
    expect(outsider.data.recordId).toBeNull();
  });

  it('seeds a new design from the saved starter library', async () => {
    const store = repo();
    const created = await createDesign(actor(), store, {
      name: 'From starter',
      category: launch.category,
      subject: launch.subject,
      design: launch.design,
      source: 'starter',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.source).toBe('starter');
    expect(created.data.design.blocks.length).toBe(launch.design.blocks.length);
  });
});

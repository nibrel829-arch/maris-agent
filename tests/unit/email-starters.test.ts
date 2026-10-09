import { describe, expect, it } from 'vitest';
import { renderEmail } from '@/server/email/render';
import { STARTER_TEMPLATES, getStarterTemplate, starterVariables } from '@/server/email/starter-templates';
import { EMAIL_BLOCK_TYPES } from '@/types/email-design';

const resolver = (id: string) => `https://studio.nibrexo.test/assets/${id}`;

describe('Email studio starter templates', () => {
  it('ships the six documented, fully editable starters', () => {
    expect(STARTER_TEMPLATES.map((template) => template.id)).toEqual([
      'starter-welcome',
      'starter-newsletter',
      'starter-product-launch',
      'starter-promo',
      'starter-announcement',
      'starter-client-update',
    ]);
    for (const template of STARTER_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(3);
      expect(template.description.length).toBeGreaterThan(20);
      expect(template.subject.length).toBeGreaterThan(3);
      expect(template.design.blocks.length).toBeGreaterThan(2);
    }
  });

  it('renders every starter without blocking issues (they are real designs, not screenshots)', () => {
    for (const template of STARTER_TEMPLATES) {
      const rendered = renderEmail(template.design, { resolveAssetUrl: resolver });
      expect(rendered.validation.errors, template.id).toEqual([]);
      expect(rendered.html).toContain('<!DOCTYPE html>');
      expect(rendered.html).not.toMatch(/<script/i);
      expect(rendered.text.length).toBeGreaterThan(80);
      // A preheader is always present.
      expect(rendered.preheader.length).toBeGreaterThan(3);
    }
  });

  it('gives every marketing starter a footer with an unsubscribe destination', () => {
    for (const template of STARTER_TEMPLATES) {
      const footer = template.design.blocks.find((block) => block.type === 'footer');
      expect(footer, template.id).toBeDefined();
      if (!footer || footer.type !== 'footer') continue;
      expect(footer.props.unsubscribeUrl.length, template.id).toBeGreaterThan(0);
      expect(footer.props.unsubscribeLabel.length, template.id).toBeGreaterThan(0);
    }
  });

  it('uses only block types the builder can edit', () => {
    for (const template of STARTER_TEMPLATES) {
      for (const block of template.design.blocks) {
        expect(EMAIL_BLOCK_TYPES).toContain(block.type);
      }
    }
  });

  it('includes a video thumbnail, a product catalogue and a CTA in the launch starter', () => {
    const launch = getStarterTemplate('starter-product-launch');
    expect(launch).toBeDefined();
    if (!launch) return;
    const types = launch.design.blocks.map((block) => block.type);
    expect(types).toContain('header');
    expect(types).toContain('banner');
    expect(types).toContain('products');
    expect(types).toContain('video');
    expect(types).toContain('button');
    expect(types).toContain('footer');
  });

  it('reports the variables a starter expects so the preview can be pre-filled', () => {
    const variables = starterVariables(getStarterTemplate('starter-product-launch')!);
    expect(variables).toContain('product.name');
    expect(variables).toContain('organization.name');
    // The unsubscribe URL defers the recipient address to send time.
    expect(variables).toContain('contact.email');
  });

  it('resolves a starter by id and rejects an unknown id', () => {
    expect(getStarterTemplate('starter-welcome')?.id).toBe('starter-welcome');
    expect(getStarterTemplate('starter-does-not-exist')).toBeUndefined();
  });

  it('leaves placeholder destinations that validation flags before a campaign', () => {
    const launch = renderEmail(getStarterTemplate('starter-product-launch')!.design, { resolveAssetUrl: resolver });
    const deferred = launch.validation.info.filter((issue) => issue.code === 'LINK_DEFERRED');
    expect(deferred.length).toBeGreaterThan(0);
    // Images are intentionally empty until the user picks Content Library assets.
    const emptyImages = launch.validation.warnings.filter((issue) => issue.code === 'IMAGE_EMPTY');
    expect(emptyImages.length).toBeGreaterThan(0);
    expect(launch.validation.ok).toBe(true);
  });
});

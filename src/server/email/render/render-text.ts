/**
 * Email Studio — plain-text alternative renderer.
 *
 * Every HTML email must ship a text alternative: some clients (and some
 * recipients) prefer it, and a missing text part hurts deliverability. The
 * projection is deterministic: links become `label — url`, images become their
 * alt text, and the unsubscribe instruction is always present when the design
 * has a footer with an unsubscribe URL.
 */

import type { EmailBlock, EmailDesignDocument } from '@/types/email-design';
import { textFromHtml } from './sanitize';

const RULE = '—'.repeat(28);

function linkLine(label: string, url: string): string {
  if (!url) return label;
  return `${label} — ${url}`;
}

function blockToText(block: EmailBlock): string[] {
  const lines: string[] = [];
  const imageAlt = (image: { mediaId: string | null; url: string | null; alt: string }): string | null =>
    image.alt || null;

  switch (block.type) {
    case 'header': {
      const p = block.props;
      if (p.brandName) lines.push(p.brandName.toUpperCase());
      const logo = imageAlt(p.logo);
      if (logo) lines.push(`[${logo}]`);
      for (const link of p.navLinks) {
        if (link.label || link.url) lines.push(linkLine(link.label, link.url));
      }
      break;
    }
    case 'hero': {
      const p = block.props;
      if (p.headline) lines.push(p.headline);
      if (p.description) lines.push(p.description);
      if (p.cta) lines.push(linkLine(p.cta.label, p.cta.url));
      break;
    }
    case 'banner': {
      const p = block.props;
      const alt = imageAlt(p.image);
      if (alt) lines.push(`[${alt}]`);
      if (p.url) lines.push(linkLine('Open link', p.url));
      break;
    }
    case 'video': {
      const p = block.props;
      if (p.title) lines.push(p.title);
      if (p.description) lines.push(p.description);
      if (p.videoUrl) lines.push(linkLine(p.ctaLabel || 'Watch the video', p.videoUrl));
      break;
    }
    case 'products': {
      const p = block.props;
      if (p.items.length === 0) break;
      lines.push('PRODUCTS');
      for (const item of p.items) {
        const alt = imageAlt(item.image);
        if (alt) lines.push(`[${alt}]`);
        const title = [item.title, p.showPrice && item.price ? item.price : ''].filter(Boolean).join(' — ');
        lines.push(title || '(untitled product)');
        if (item.description) lines.push(`  ${item.description}`);
        if (item.url) lines.push(`  ${linkLine(item.ctaLabel || 'View', item.url)}`);
      }
      break;
    }
    case 'gallery': {
      const p = block.props;
      if (p.items.length === 0) break;
      lines.push('GALLERY');
      for (const item of p.items) {
        const alt = imageAlt(item.image);
        lines.push(`[${alt || item.title || 'image'}]`);
        if (item.url) lines.push(`  ${item.url}`);
      }
      break;
    }
    case 'promo': {
      const p = block.props;
      if (p.badge) lines.push(p.badge.toUpperCase());
      if (p.eyebrow) lines.push(p.eyebrow);
      if (p.headline) lines.push(p.headline);
      if (p.description) lines.push(p.description);
      if (p.cta) lines.push(linkLine(p.cta.label, p.cta.url));
      break;
    }
    case 'text': {
      const p = block.props;
      if (p.heading) lines.push(p.heading);
      const body = textFromHtml(p.html);
      if (body) lines.push(body);
      break;
    }
    case 'button': {
      const p = block.props;
      lines.push(linkLine(p.label, p.url));
      break;
    }
    case 'social': {
      const p = block.props;
      for (const link of p.links) {
        if (link.url) lines.push(linkLine(link.platform, link.url));
      }
      break;
    }
    case 'spacer':
    case 'divider':
      break;
    case 'background': {
      const p = block.props;
      if (p.heading) lines.push(p.heading);
      if (p.text) lines.push(p.text);
      break;
    }
    case 'footer': {
      const p = block.props;
      lines.push(RULE);
      if (p.companyName) lines.push(p.companyName);
      if (p.addressLine) lines.push(p.addressLine);
      const contact = [p.contactEmail, p.contactPhone].filter(Boolean).join(' · ');
      if (contact) lines.push(contact);
      if (p.legalText) lines.push(p.legalText);
      if (p.preferencesUrl) lines.push(linkLine('Email preferences', p.preferencesUrl));
      if (p.unsubscribeUrl) lines.push(linkLine(p.unsubscribeLabel || 'Unsubscribe', p.unsubscribeUrl));
      for (const link of p.socialLinks) {
        if (link.url) lines.push(linkLine(link.platform, link.url));
      }
      break;
    }
    default:
      break;
  }
  return lines;
}

/** Builds the plain-text alternative for a design document. */
export function renderEmailText(design: EmailDesignDocument, subject: string, preheader: string): string {
  const parts: string[] = [];
  // The preheader is usually the subject repeated; only print it when it adds
  // something the subject does not already say.
  if (preheader && preheader.trim() !== subject.trim()) parts.push(preheader);
  if (subject) parts.push(subject);

  for (const block of design.blocks) {
    const lines = blockToText(block);
    if (lines.length > 0) parts.push(lines.join('\n'));
  }

  const text = parts.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim();
  return text.length > 0 ? `${text}\n` : '';
}

/**
 * Block factory for the visual builder (client-safe, no server imports).
 *
 * New blocks are seeded with brand defaults so a dropped component already
 * looks like the organization's email rather than a grey placeholder. The same
 * factory is used by the studio and by the Manager's block builders, which
 * keeps both on one definition of "a sensible default".
 */

import {
  EMAIL_DESIGN_VERSION,
  type EmailBlock,
  type EmailBlockType,
  type EmailBrandProfile,
  type EmailBrandTokens,
  type EmailDesignDocument,
} from '@/types/email-design';

let counter = 0;

export function createBlockId(prefix = 'blk'): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

export interface BlockDefaults {
  brand: EmailBrandTokens;
  profile?: Pick<EmailBrandProfile, 'brandName' | 'headerDefaults' | 'footerDefaults'> | null;
}

const FALLBACK_BRAND_NAME = 'Your company';

function colors(brand: EmailBrandTokens) {
  return {
    primary: brand.colors.primary,
    secondary: brand.colors.secondary,
    surface: brand.colors.surface,
    background: brand.colors.background,
  };
}

export function createBlock(type: EmailBlockType, defaults: BlockDefaults): EmailBlock {
  const brand = defaults.brand;
  const profile = defaults.profile ?? null;
  const brandName = profile?.brandName?.trim() || FALLBACK_BRAND_NAME;
  const id = createBlockId(type);

  switch (type) {
    case 'header':
      return {
        id,
        type: 'header',
        props: {
          brandName: profile?.headerDefaults?.brandName?.trim() || brandName,
          logo: profile?.headerDefaults?.logo ?? { mediaId: null, url: null, alt: '' },
          navLinks: profile?.headerDefaults?.navLinks ?? [],
          showNav: profile?.headerDefaults?.showNav ?? true,
          alignment: 'center',
          backgroundColor: null,
          textColor: null,
        },
      };
    case 'hero':
      return {
        id,
        type: 'hero',
        props: {
          image: { mediaId: null, url: null, alt: 'Hero image' },
          headline: 'A clear, benefit-led headline',
          description: 'One or two sentences explaining the value, in plain language.',
          cta: { label: 'Get started', url: 'https://example.com' },
          overlay: true,
          textColor: null,
          backgroundColor: null,
        },
      };
    case 'banner':
      return {
        id,
        type: 'banner',
        props: {
          image: { mediaId: null, url: null, alt: 'Campaign banner' },
          url: 'https://example.com',
          height: 240,
          backgroundColor: colors(brand).background,
        },
      };
    case 'video':
      return {
        id,
        type: 'video',
        props: {
          thumbnail: { mediaId: null, url: null, alt: 'Video thumbnail' },
          videoUrl: 'https://example.com/video',
          title: 'Watch the video',
          description: 'The thumbnail opens the video in a browser.',
          ctaLabel: 'Watch the video',
          showPlayButton: true,
        },
      };
    case 'products':
      return {
        id,
        type: 'products',
        props: {
          columns: 3,
          items: [
            {
              id: createBlockId('item'),
              image: { mediaId: null, url: null, alt: 'Product image' },
              title: 'Product one',
              description: 'Short description of the product.',
              price: '',
              url: 'https://example.com/product',
              ctaLabel: 'View product',
            },
          ],
          backgroundColor: null,
          showPrice: true,
        },
      };
    case 'gallery':
      return {
        id,
        type: 'gallery',
        props: {
          columns: 2,
          items: [
            {
              id: createBlockId('item'),
              image: { mediaId: null, url: null, alt: 'Gallery image' },
              title: 'Item one',
              url: 'https://example.com/item',
            },
          ],
          backgroundColor: null,
        },
      };
    case 'promo':
      return {
        id,
        type: 'promo',
        props: {
          eyebrow: 'Limited time',
          headline: 'Your offer headline',
          description: 'Explain the offer, the deadline and what to do next.',
          badge: 'New',
          image: { mediaId: null, url: null, alt: 'Promotional image' },
          cta: { label: 'Shop now', url: 'https://example.com/offer' },
          backgroundColor: brand.colors.primary,
          textColor: '#ffffff',
        },
      };
    case 'text':
      return {
        id,
        type: 'text',
        props: {
          heading: 'Section heading',
          headingLevel: 2,
          html: '<p>Write your message here. You can use <strong>bold</strong>, <em>italic</em>, lists and <a href="https://example.com">links</a>.</p>',
          alignment: 'left',
          color: null,
          fontSize: brand.typography.baseSize,
        },
      };
    case 'button':
      return {
        id,
        type: 'button',
        props: {
          label: 'Click me',
          url: 'https://example.com',
          backgroundColor: null,
          textColor: null,
          radius: brand.button.radius,
          align: 'center',
          fullWidth: false,
        },
      };
    case 'social':
      return {
        id,
        type: 'social',
        props: {
          links: [
            { platform: 'linkedin', url: 'https://www.linkedin.com/company/example' },
            { platform: 'instagram', url: 'https://www.instagram.com/example' },
          ],
          align: 'center',
          iconColor: null,
          size: 32,
        },
      };
    case 'spacer':
      return { id, type: 'spacer', props: { height: 24, backgroundColor: null } };
    case 'divider':
      return { id, type: 'divider', props: { color: null, thickness: 1, width: 100 } };
    case 'background':
      return {
        id,
        type: 'background',
        props: {
          backgroundColor: brand.colors.background,
          image: { mediaId: null, url: null, alt: '' },
          padding: 32,
          heading: '',
          text: '',
          textColor: null,
        },
      };
    case 'footer': {
      const footer = profile?.footerDefaults;
      return {
        id,
        type: 'footer',
        props: {
          companyName: footer?.companyName?.trim() || brandName,
          addressLine: footer?.addressLine ?? '',
          contactEmail: footer?.contactEmail ?? '',
          contactPhone: footer?.contactPhone ?? '',
          preferencesUrl: footer?.preferencesUrl ?? '',
          unsubscribeUrl: footer?.unsubscribeUrl ?? '',
          unsubscribeLabel: 'Unsubscribe',
          legalText: footer?.legalText ?? '',
          showSocial: true,
          socialLinks: footer?.socialLinks ?? [],
          backgroundColor: null,
          textColor: null,
        },
      };
    }
    default:
      return { id, type: 'spacer', props: { height: 24, backgroundColor: null } };
  }
}

/** Deep clone helper that keeps block ids stable. */
export function cloneBlock(block: EmailBlock): EmailBlock {
  return JSON.parse(JSON.stringify({ ...block, id: createBlockId(block.type) })) as EmailBlock;
}

/**
 * A brand-seeded empty document. Lives here (not in the service) so both the
 * browser and the server share one definition of "a new design".
 */
export function emptyDesignDocument(brand: EmailBrandProfile): EmailDesignDocument {
  return {
    version: EMAIL_DESIGN_VERSION,
    blocks: [],
    brand: {
      colors: { ...brand.colors },
      typography: { ...brand.typography },
      button: { ...brand.button },
    },
    settings: {
      width: 600,
      backgroundColor: brand.colors.background,
      surfaceColor: brand.colors.surface,
      fontFamily: brand.typography.bodyFont,
      preheader: '',
    },
  };
}

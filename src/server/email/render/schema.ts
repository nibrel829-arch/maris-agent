/**
 * Zod schema for the Email Studio design document.
 *
 * One schema is used for three entry points — the browser builder, the
 * Manager tools and the API — so a malformed design can never reach the
 * renderer or the database. Defaults are applied here rather than in the UI so
 * a Manager-generated design that omits optional styling still renders with
 * brand defaults.
 */

import { z } from 'zod';
import {
  DEFAULT_EMAIL_BRAND_PROFILE,
  DEFAULT_EMAIL_BRAND_TOKENS,
  type EmailBlockType,
  type EmailBrandProfile,
  type EmailDesignDocument,
} from '@/types/email-design';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FONT_STACK = /^[a-zA-Z0-9 ,'"\-.]{1,160}$/;

/** Colours are either null (inherit from brand) or a hex value. */
const colorOrNull = z
  .string()
  .trim()
  .max(32)
  .refine((value) => HEX_COLOR.test(value), 'Colours must be hex values such as #2b5cff.')
  .nullable()
  .default(null);

const requiredColor = z
  .string()
  .trim()
  .max(32)
  .refine((value) => HEX_COLOR.test(value), 'Colours must be hex values such as #2b5cff.');

const alignment = z.enum(['left', 'center', 'right']).default('left');
const headingLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) as unknown as z.ZodType<1 | 2 | 3>;
const columns = z.coerce.number().int().min(1).max(4).default(2) as unknown as z.ZodType<1 | 2 | 3 | 4>;

export const emailImageSchema = z.object({
  mediaId: z.string().uuid().nullable().default(null),
  url: z.string().trim().max(2048).nullable().default(null),
  alt: z.string().trim().max(300).default(''),
});

export const emailLinkSchema = z.object({
  label: z.string().trim().max(120).default(''),
  url: z.string().trim().max(2048).default(''),
});

export const emailCtaSchema = z.object({
  label: z.string().trim().max(120).default(''),
  url: z.string().trim().max(2048).default(''),
});

export const emailProductCardSchema = z.object({
  id: z.string().trim().min(1).max(80),
  image: emailImageSchema,
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(600).default(''),
  price: z.string().trim().max(60).default(''),
  url: z.string().trim().max(2048).default(''),
  ctaLabel: z.string().trim().max(120).default('View'),
});

export const emailGalleryItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  image: emailImageSchema,
  title: z.string().trim().max(200).default(''),
  url: z.string().trim().max(2048).default(''),
});

export const emailSocialPlatform = z.enum([
  'facebook',
  'instagram',
  'linkedin',
  'x',
  'youtube',
  'tiktok',
  'pinterest',
  'whatsapp',
  'website',
] as const);

export const emailSocialLinkSchema = z.object({
  platform: emailSocialPlatform,
  url: z.string().trim().max(2048).default(''),
});

const blockId = z.string().trim().min(1).max(80);

const headerSchema = z.object({
  id: blockId,
  type: z.literal('header'),
  props: z.object({
    brandName: z.string().trim().max(120).default(''),
    logo: emailImageSchema,
    navLinks: z.array(emailLinkSchema).max(8).default([]),
    showNav: z.boolean().default(true),
    alignment,
    backgroundColor: colorOrNull,
    textColor: colorOrNull,
  }),
});

const heroSchema = z.object({
  id: blockId,
  type: z.literal('hero'),
  props: z.object({
    image: emailImageSchema,
    headline: z.string().trim().max(200).default(''),
    description: z.string().trim().max(600).default(''),
    cta: emailCtaSchema.nullable().default(null),
    overlay: z.boolean().default(true),
    textColor: colorOrNull,
    backgroundColor: colorOrNull,
  }),
});

const bannerSchema = z.object({
  id: blockId,
  type: z.literal('banner'),
  props: z.object({
    image: emailImageSchema,
    url: z.string().trim().max(2048).default(''),
    height: z.coerce.number().int().min(60).max(800).default(240),
    backgroundColor: colorOrNull,
  }),
});

const videoSchema = z.object({
  id: blockId,
  type: z.literal('video'),
  props: z.object({
    thumbnail: emailImageSchema,
    videoUrl: z.string().trim().max(2048).default(''),
    title: z.string().trim().max(200).default(''),
    description: z.string().trim().max(600).default(''),
    ctaLabel: z.string().trim().max(120).default('Watch the video'),
    showPlayButton: z.boolean().default(true),
  }),
});

const productsSchema = z.object({
  id: blockId,
  type: z.literal('products'),
  props: z.object({
    columns,
    items: z.array(emailProductCardSchema).max(12).default([]),
    backgroundColor: colorOrNull,
    showPrice: z.boolean().default(true),
  }),
});

const gallerySchema = z.object({
  id: blockId,
  type: z.literal('gallery'),
  props: z.object({
    columns,
    items: z.array(emailGalleryItemSchema).max(12).default([]),
    backgroundColor: colorOrNull,
  }),
});

const promoSchema = z.object({
  id: blockId,
  type: z.literal('promo'),
  props: z.object({
    eyebrow: z.string().trim().max(120).default(''),
    headline: z.string().trim().max(200).default(''),
    description: z.string().trim().max(600).default(''),
    badge: z.string().trim().max(60).default(''),
    image: emailImageSchema,
    cta: emailCtaSchema.nullable().default(null),
    backgroundColor: colorOrNull,
    textColor: colorOrNull,
  }),
});

const textSchema = z.object({
  id: blockId,
  type: z.literal('text'),
  props: z.object({
    heading: z.string().trim().max(200).default(''),
    headingLevel,
    html: z.string().max(20000).default(''),
    alignment,
    color: colorOrNull,
    fontSize: z.coerce.number().int().min(11).max(24).default(16),
  }),
});

const buttonSchema = z.object({
  id: blockId,
  type: z.literal('button'),
  props: z.object({
    label: z.string().trim().max(120).default(''),
    url: z.string().trim().max(2048).default(''),
    backgroundColor: colorOrNull,
    textColor: colorOrNull,
    radius: z.coerce.number().int().min(0).max(40).default(8),
    align: alignment,
    fullWidth: z.boolean().default(false),
  }),
});

const socialSchema = z.object({
  id: blockId,
  type: z.literal('social'),
  props: z.object({
    links: z.array(emailSocialLinkSchema).max(10).default([]),
    align: alignment,
    iconColor: colorOrNull,
    size: z.coerce.number().int().min(16).max(48).default(32),
  }),
});

const spacerSchema = z.object({
  id: blockId,
  type: z.literal('spacer'),
  props: z.object({
    height: z.coerce.number().int().min(4).max(200).default(24),
    backgroundColor: colorOrNull,
  }),
});

const dividerSchema = z.object({
  id: blockId,
  type: z.literal('divider'),
  props: z.object({
    color: colorOrNull,
    thickness: z.coerce.number().int().min(1).max(8).default(1),
    width: z.coerce.number().int().min(20).max(100).default(100),
  }),
});

const backgroundSchema = z.object({
  id: blockId,
  type: z.literal('background'),
  props: z.object({
    backgroundColor: colorOrNull,
    image: emailImageSchema,
    padding: z.coerce.number().int().min(0).max(80).default(32),
    heading: z.string().trim().max(200).default(''),
    text: z.string().trim().max(1200).default(''),
    textColor: colorOrNull,
  }),
});

const footerSchema = z.object({
  id: blockId,
  type: z.literal('footer'),
  props: z.object({
    companyName: z.string().trim().max(160).default(''),
    addressLine: z.string().trim().max(300).default(''),
    contactEmail: z.string().trim().max(160).default(''),
    contactPhone: z.string().trim().max(60).default(''),
    preferencesUrl: z.string().trim().max(2048).default(''),
    unsubscribeUrl: z.string().trim().max(2048).default(''),
    unsubscribeLabel: z.string().trim().max(120).default('Unsubscribe'),
    legalText: z.string().trim().max(600).default(''),
    showSocial: z.boolean().default(true),
    socialLinks: z.array(emailSocialLinkSchema).max(10).default([]),
    backgroundColor: colorOrNull,
    textColor: colorOrNull,
  }),
});

export const emailBlockSchema = z.discriminatedUnion('type', [
  headerSchema,
  heroSchema,
  bannerSchema,
  videoSchema,
  productsSchema,
  gallerySchema,
  promoSchema,
  textSchema,
  buttonSchema,
  socialSchema,
  spacerSchema,
  dividerSchema,
  backgroundSchema,
  footerSchema,
]);

export const emailBrandColorsSchema = z.object({
  primary: requiredColor,
  secondary: requiredColor,
  accent: requiredColor,
  background: requiredColor,
  surface: requiredColor,
  text: requiredColor,
  muted: requiredColor,
  link: requiredColor,
  buttonBackground: requiredColor,
  buttonText: requiredColor,
});

export const emailBrandTokensSchema = z.object({
  colors: emailBrandColorsSchema,
  typography: z.object({
    headingFont: z.string().trim().max(160).refine((v) => FONT_STACK.test(v), 'Font stack is not valid.'),
    bodyFont: z.string().trim().max(160).refine((v) => FONT_STACK.test(v), 'Font stack is not valid.'),
    baseSize: z.coerce.number().int().min(12).max(20),
  }),
  button: z.object({
    radius: z.coerce.number().int().min(0).max(40),
    uppercase: z.boolean(),
    fontWeight: z.enum(['normal', 'bold']),
  }),
});

export const emailDesignSettingsSchema = z.object({
  width: z.coerce.number().int().min(320).max(800).default(600),
  backgroundColor: requiredColor.default(DEFAULT_EMAIL_BRAND_TOKENS.colors.background),
  surfaceColor: requiredColor.default(DEFAULT_EMAIL_BRAND_TOKENS.colors.surface),
  fontFamily: z
    .string()
    .trim()
    .max(160)
    .refine((v) => FONT_STACK.test(v), 'Font stack is not valid.')
    .default(DEFAULT_EMAIL_BRAND_TOKENS.typography.bodyFont),
  preheader: z.string().trim().max(300).default(''),
});

export const emailDesignDocumentSchema = z.object({
  version: z.coerce.number().int().min(1).max(100).default(1),
  blocks: z.array(emailBlockSchema).max(60).default([]),
  brand: emailBrandTokensSchema.default(DEFAULT_EMAIL_BRAND_TOKENS),
  // `settings` is optional so a Manager- or API-supplied document that omits
  // canvas settings still renders with the documented defaults.
  settings: emailDesignSettingsSchema.default({
    width: 600,
    backgroundColor: DEFAULT_EMAIL_BRAND_TOKENS.colors.background,
    surfaceColor: DEFAULT_EMAIL_BRAND_TOKENS.colors.surface,
    fontFamily: DEFAULT_EMAIL_BRAND_TOKENS.typography.bodyFont,
    preheader: '',
  }),
});

export const emailBrandProfileSchema = z.object({
  brandName: z.string().trim().max(120).default(DEFAULT_EMAIL_BRAND_PROFILE.brandName),
  logo: emailImageSchema,
  colors: emailBrandColorsSchema,
  typography: emailBrandTokensSchema.shape.typography,
  button: emailBrandTokensSchema.shape.button,
  headerDefaults: z.object({
    brandName: z.string().trim().max(120).default(''),
    logo: emailImageSchema,
    navLinks: z.array(emailLinkSchema).max(8).default([]),
    showNav: z.boolean().default(false),
  }),
  footerDefaults: z.object({
    companyName: z.string().trim().max(160).default(''),
    addressLine: z.string().trim().max(300).default(''),
    contactEmail: z.string().trim().max(160).default(''),
    contactPhone: z.string().trim().max(60).default(''),
    preferencesUrl: z.string().trim().max(2048).default(''),
    unsubscribeUrl: z.string().trim().max(2048).default(''),
    legalText: z.string().trim().max(600).default(''),
    socialLinks: z.array(emailSocialLinkSchema).max(10).default([]),
  }),
  savedSections: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        name: z.string().trim().max(120),
        block: emailBlockSchema,
      }),
    )
    .max(40)
    .default([]),
});

export interface DesignParseResult {
  ok: boolean;
  document: EmailDesignDocument | null;
  errors: string[];
}

/** Parses unknown JSON into a validated design document. */
export function parseDesignDocument(value: unknown): DesignParseResult {
  const parsed = emailDesignDocumentSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, document: parsed.data as unknown as EmailDesignDocument, errors: [] };
  }
  return {
    ok: false,
    document: null,
    errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'design'}: ${issue.message}`),
  };
}

/** Parses unknown JSON into a validated brand profile. */
export function parseBrandProfile(
  value: unknown,
): { ok: true; profile: EmailBrandProfile } | { ok: false; errors: string[] } {
  const parsed = emailBrandProfileSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, profile: parsed.data as unknown as EmailBrandProfile };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'brand'}: ${issue.message}`),
  };
}

export const BLOCK_TYPE_LABELS: Record<EmailBlockType, string> = {
  header: 'Header',
  hero: 'Hero banner',
  banner: 'Image banner',
  video: 'Video',
  products: 'Product catalogue',
  gallery: 'Image gallery',
  promo: 'Promotional section',
  text: 'Text',
  button: 'Button',
  social: 'Social links',
  spacer: 'Spacer',
  divider: 'Divider',
  background: 'Background section',
  footer: 'Footer',
};

export const BLOCK_TYPE_DESCRIPTIONS: Record<EmailBlockType, string> = {
  header: 'Company logo, brand name and navigation links.',
  hero: 'Full-width image, headline, description and CTA button.',
  banner: 'Promotional artwork, campaign graphics or product visuals.',
  video: 'Clickable video thumbnail that opens the video in a browser.',
  products: 'Product cards in multiple columns with images, prices and CTAs.',
  gallery: 'Multiple products or portfolio items in a grid.',
  promo: 'Offers, launches, announcements and featured products.',
  text: 'Rich text with headings, lists and links.',
  button: 'Customisable label, destination, colour and style.',
  social: 'Supported social platform icons and URLs.',
  spacer: 'Vertical space between sections.',
  divider: 'Horizontal rule between sections.',
  background: 'Coloured or image background section.',
  footer: 'Company details, contact information, preferences and unsubscribe.',
};

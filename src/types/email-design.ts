/**
 * Nibrexo Email Studio — shared design document types (Phase 16).
 *
 * These types are the single contract between the visual builder (browser),
 * the renderer (server), the Manager tools and the database. They contain no
 * framework or Node APIs so they can be imported from client components,
 * route handlers, tools and tests alike.
 *
 * Rules encoded here (PDF #10, PDF #12 §16, Phase 16 spec):
 *  - Every user-supplied string is *data*, never markup. The renderer escapes
 *    it and the text block is the only place a small, sanitised HTML subset is
 *    accepted.
 *  - Every URL is validated against an explicit scheme allow-list before it
 *    can reach the rendered document (`javascript:` and `data:` are rejected).
 *  - Images reference the existing Content Library by media id; external URLs
 *    are allowed but must pass the same validation.
 */

export const EMAIL_DESIGN_VERSION = 1;


export type EmailSocialPlatform =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'pinterest'
  | 'whatsapp'
  | 'website';

export const EMAIL_SOCIAL_PLATFORMS: readonly EmailSocialPlatform[] = [
  'facebook',
  'instagram',
  'linkedin',
  'x',
  'youtube',
  'tiktok',
  'pinterest',
  'whatsapp',
  'website',
];

/** An image is either a Content Library asset (preferred) or an external URL. */
export interface EmailImage {
  mediaId: string | null;
  url: string | null;
  /** Required for accessibility and for clients that block images. */
  alt: string;
}

export interface EmailLink {
  label: string;
  url: string;
}

export interface EmailCta {
  label: string;
  url: string;
}

export interface EmailProductCard {
  id: string;
  image: EmailImage;
  title: string;
  description: string;
  price: string;
  url: string;
  ctaLabel: string;
}

export interface EmailGalleryItem {
  id: string;
  image: EmailImage;
  title: string;
  url: string;
}

export interface EmailSocialLink {
  platform: EmailSocialPlatform;
  url: string;
}

/* -------------------------------------------------------------------------- */
/* Block properties                                                            */
/* -------------------------------------------------------------------------- */

export type EmailAlignment = 'left' | 'center' | 'right';
export type EmailColumns = 1 | 2 | 3 | 4;

export interface HeaderBlockProps {
  brandName: string;
  logo: EmailImage;
  navLinks: EmailLink[];
  showNav: boolean;
  alignment: EmailAlignment;
  backgroundColor: string | null;
  textColor: string | null;
}

export interface HeroBlockProps {
  image: EmailImage;
  headline: string;
  description: string;
  cta: EmailCta | null;
  overlay: boolean;
  textColor: string | null;
  backgroundColor: string | null;
}

export interface BannerBlockProps {
  image: EmailImage;
  url: string;
  height: number;
  backgroundColor: string | null;
}

export interface VideoBlockProps {
  thumbnail: EmailImage;
  videoUrl: string;
  title: string;
  description: string;
  ctaLabel: string;
  /** Honest capability note rendered with the block: email clients cannot be
   *  assumed to play inline video, so the thumbnail is a link to the video. */
  showPlayButton: boolean;
}

export interface ProductsBlockProps {
  columns: EmailColumns;
  items: EmailProductCard[];
  backgroundColor: string | null;
  showPrice: boolean;
}

export interface GalleryBlockProps {
  columns: EmailColumns;
  items: EmailGalleryItem[];
  backgroundColor: string | null;
}

export interface PromoBlockProps {
  eyebrow: string;
  headline: string;
  description: string;
  badge: string;
  image: EmailImage;
  cta: EmailCta | null;
  backgroundColor: string | null;
  textColor: string | null;
}

export interface TextBlockProps {
  heading: string;
  headingLevel: 1 | 2 | 3;
  /** Sanitised HTML subset (b/strong/i/em/u/a/ul/ol/li/p/br/h1-h4). */
  html: string;
  alignment: EmailAlignment;
  color: string | null;
  fontSize: number;
}

export interface ButtonBlockProps {
  label: string;
  url: string;
  backgroundColor: string | null;
  textColor: string | null;
  radius: number;
  align: EmailAlignment;
  fullWidth: boolean;
}

export interface SocialBlockProps {
  links: EmailSocialLink[];
  align: EmailAlignment;
  iconColor: string | null;
  size: number;
}

export interface SpacerBlockProps {
  height: number;
  backgroundColor: string | null;
}

export interface DividerBlockProps {
  color: string | null;
  thickness: number;
  width: number;
}

export interface BackgroundBlockProps {
  backgroundColor: string | null;
  image: EmailImage;
  padding: number;
  /** Optional content carried by the band. */
  heading: string;
  text: string;
  textColor: string | null;
}

export interface FooterBlockProps {
  companyName: string;
  addressLine: string;
  contactEmail: string;
  contactPhone: string;
  preferencesUrl: string;
  unsubscribeUrl: string;
  unsubscribeLabel: string;
  legalText: string;
  showSocial: boolean;
  socialLinks: EmailSocialLink[];
  backgroundColor: string | null;
  textColor: string | null;
}

/**
 * A block is a discriminated union on `type`, so `switch (block.type)` narrows
 * `block.props` to the exact property shape in the renderer, the properties
 * panel and the Manager's block builders.
 */
export type EmailBlock =
  | { id: string; type: 'header'; props: HeaderBlockProps }
  | { id: string; type: 'hero'; props: HeroBlockProps }
  | { id: string; type: 'banner'; props: BannerBlockProps }
  | { id: string; type: 'video'; props: VideoBlockProps }
  | { id: string; type: 'products'; props: ProductsBlockProps }
  | { id: string; type: 'gallery'; props: GalleryBlockProps }
  | { id: string; type: 'promo'; props: PromoBlockProps }
  | { id: string; type: 'text'; props: TextBlockProps }
  | { id: string; type: 'button'; props: ButtonBlockProps }
  | { id: string; type: 'social'; props: SocialBlockProps }
  | { id: string; type: 'spacer'; props: SpacerBlockProps }
  | { id: string; type: 'divider'; props: DividerBlockProps }
  | { id: string; type: 'background'; props: BackgroundBlockProps }
  | { id: string; type: 'footer'; props: FooterBlockProps };

export type EmailBlockType = EmailBlock['type'];

export const EMAIL_BLOCK_TYPES: readonly EmailBlockType[] = [
  'header',
  'hero',
  'banner',
  'video',
  'products',
  'gallery',
  'promo',
  'text',
  'button',
  'social',
  'spacer',
  'divider',
  'background',
  'footer',
];

/** Union of every block property shape (generic tooling). */
export type EmailBlockProps = EmailBlock['props'];

/* -------------------------------------------------------------------------- */
/* Brand + document                                                            */
/* -------------------------------------------------------------------------- */

export interface EmailBrandColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  link: string;
  buttonBackground: string;
  buttonText: string;
}

export interface EmailBrandTypography {
  headingFont: string;
  bodyFont: string;
  baseSize: number;
}

export interface EmailBrandButton {
  radius: number;
  uppercase: boolean;
  fontWeight: 'normal' | 'bold';
}

export interface EmailBrandTokens {
  colors: EmailBrandColors;
  typography: EmailBrandTypography;
  button: EmailBrandButton;
}

/** Defaults applied when a new block is dropped onto the canvas. */
export interface EmailHeaderDefaults {
  brandName: string;
  logo: EmailImage;
  navLinks: EmailLink[];
  showNav: boolean;
}

export interface EmailFooterDefaults {
  companyName: string;
  addressLine: string;
  contactEmail: string;
  contactPhone: string;
  preferencesUrl: string;
  unsubscribeUrl: string;
  legalText: string;
  socialLinks: EmailSocialLink[];
}

export interface EmailSavedSection {
  id: string;
  name: string;
  block: EmailBlock;
}

/** Organization-level brand + design system (persisted, one row per org). */
export interface EmailBrandProfile {
  brandName: string;
  logo: EmailImage;
  colors: EmailBrandColors;
  typography: EmailBrandTypography;
  button: EmailBrandButton;
  headerDefaults: EmailHeaderDefaults;
  footerDefaults: EmailFooterDefaults;
  savedSections: EmailSavedSection[];
}

export interface EmailDesignSettings {
  /** Canvas width in pixels (email safe maximum 800, recommended 600). */
  width: number;
  backgroundColor: string;
  surfaceColor: string;
  fontFamily: string;
  preheader: string;
}

export interface EmailDesignDocument {
  version: number;
  blocks: EmailBlock[];
  brand: EmailBrandTokens;
  settings: EmailDesignSettings;
}

export type EmailDesignStatus = 'draft' | 'active' | 'archived';
export type EmailDesignSource = 'studio' | 'manager' | 'starter' | 'template';

/** Persisted design row (mirrors the `email_designs` table). */
export interface EmailDesign {
  id: string;
  organization_id: string;
  name: string;
  category: string;
  subject: string;
  design: EmailDesignDocument;
  status: EmailDesignStatus;
  source: EmailDesignSource;
  /** Set when the design was promoted into the existing `email_templates` table. */
  template_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Persisted brand row (mirrors `email_brand_profiles`, one per organization). */
export interface EmailBrandProfileRecord {
  id: string;
  organization_id: string;
  brand: EmailBrandProfile;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Validation + rendering results                                              */
/* -------------------------------------------------------------------------- */

export type EmailValidationSeverity = 'error' | 'warning' | 'info';

export interface EmailValidationIssue {
  code: string;
  severity: EmailValidationSeverity;
  message: string;
  blockId: string | null;
}

export interface EmailValidationReport {
  ok: boolean;
  errors: EmailValidationIssue[];
  warnings: EmailValidationIssue[];
  info: EmailValidationIssue[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  preheader: string;
  /** Unresolved {{variables}} that would be sent literally. */
  unresolvedVariables: string[];
  validation: EmailValidationReport;
}

export const DEFAULT_EMAIL_BRAND_TOKENS: EmailBrandTokens = {
  colors: {
    primary: '#2b5cff',
    secondary: '#0f172a',
    accent: '#14b8a6',
    background: '#eef2f9',
    surface: '#ffffff',
    text: '#1f2937',
    muted: '#6b7280',
    link: '#2b5cff',
    buttonBackground: '#2b5cff',
    buttonText: '#ffffff',
  },
  typography: {
    headingFont: 'Inter, Helvetica, Arial, sans-serif',
    bodyFont: 'Inter, Helvetica, Arial, sans-serif',
    baseSize: 16,
  },
  button: {
    radius: 8,
    uppercase: false,
    fontWeight: 'bold',
  },
};

export const DEFAULT_EMAIL_BRAND_PROFILE: EmailBrandProfile = {
  brandName: 'Nibrexo',
  logo: { mediaId: null, url: null, alt: '' },
  colors: DEFAULT_EMAIL_BRAND_TOKENS.colors,
  typography: DEFAULT_EMAIL_BRAND_TOKENS.typography,
  button: DEFAULT_EMAIL_BRAND_TOKENS.button,
  headerDefaults: {
    brandName: 'Nibrexo',
    logo: { mediaId: null, url: null, alt: '' },
    navLinks: [],
    showNav: false,
  },
  footerDefaults: {
    companyName: 'Nibrexo Ltd',
    addressLine: '',
    contactEmail: '',
    contactPhone: '',
    preferencesUrl: '',
    unsubscribeUrl: '',
    legalText: '',
    socialLinks: [],
  },
  savedSections: [],
};

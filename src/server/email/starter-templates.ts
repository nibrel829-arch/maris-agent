/**
 * Email Studio — polished starter templates (Phase 16 §4).
 *
 * These are *designs*, not screenshots: every starter is a complete, editable
 * `EmailDesignDocument` made of the same blocks the builder edits, so a user
 * (or the Manager) can open one, replace the copy, pick Content Library assets
 * and save it as a real draft.
 *
 * Placeholder destinations (`https://example.com/...`) are intentional and are
 * reported by validation as informational links that must be replaced before a
 * campaign is sent. Nothing here is sent automatically.
 */

import {
  DEFAULT_EMAIL_BRAND_TOKENS,
  EMAIL_DESIGN_VERSION,
  type EmailBlock,
  type EmailDesignDocument,
  type EmailProductCard,
  type EmailGalleryItem,
} from '@/types/email-design';

export interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  subject: string;
  design: EmailDesignDocument;
}

function block<T extends EmailBlock>(value: T): T {
  return value;
}

function product(id: string, title: string, description: string, price: string): EmailProductCard {
  return {
    id,
    image: { mediaId: null, url: null, alt: `${title} — product image` },
    title,
    description,
    price,
    url: 'https://example.com/products',
    ctaLabel: 'View product',
  };
}

function galleryItem(id: string, title: string): EmailGalleryItem {
  return {
    id,
    image: { mediaId: null, url: null, alt: `${title} — image` },
    title,
    url: 'https://example.com/portfolio',
  };
}

function document(blocks: EmailBlock[], preheader: string): EmailDesignDocument {
  return {
    version: EMAIL_DESIGN_VERSION,
    blocks,
    brand: DEFAULT_EMAIL_BRAND_TOKENS,
    settings: {
      width: 600,
      backgroundColor: DEFAULT_EMAIL_BRAND_TOKENS.colors.background,
      surfaceColor: DEFAULT_EMAIL_BRAND_TOKENS.colors.surface,
      fontFamily: DEFAULT_EMAIL_BRAND_TOKENS.typography.bodyFont,
      preheader,
    },
  };
}

const BRAND_NAV = [
  { label: 'Home', url: 'https://example.com' },
  { label: 'Services', url: 'https://example.com/services' },
  { label: 'Contact', url: 'https://example.com/contact' },
];

const FOOTER_SOCIAL = [
  { platform: 'linkedin' as const, url: 'https://www.linkedin.com/company/example' },
  { platform: 'instagram' as const, url: 'https://www.instagram.com/example' },
];

/* -------------------------------------------------------------------------- */
/* 1. Welcome email                                                            */
/* -------------------------------------------------------------------------- */

const welcome: StarterTemplate = {
  id: 'starter-welcome',
  name: 'Welcome email',
  description: 'A warm first impression: brand header, hero, welcome copy, next steps and standard footer.',
  category: 'onboarding',
  subject: 'Welcome to {{organization.name}} — here is what happens next',
  design: document(
    [
      block({
        id: 'header',
        type: 'header',
        props: {
          brandName: '{{organization.name}}',
          logo: { mediaId: null, url: null, alt: '{{organization.name}} logo' },
          navLinks: BRAND_NAV,
          showNav: true,
          alignment: 'center',
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'hero',
        type: 'hero',
        props: {
          image: { mediaId: null, url: null, alt: 'Welcome banner' },
          headline: 'Welcome aboard',
          description:
            'Thank you for joining {{organization.name}}. This short message explains what to expect from us and how to get the most out of your account.',
          cta: { label: 'Set up your account', url: 'https://example.com/getting-started' },
          overlay: true,
          textColor: null,
          backgroundColor: null,
        },
      }),
      block({
        id: 'next-steps',
        type: 'text',
        props: {
          heading: 'Your first three steps',
          headingLevel: 2,
          html: '<p>We have prepared everything you need to get started:</p><ul><li>Confirm your profile details</li><li>Book your onboarding call</li><li>Explore the resources library</li></ul>',
          alignment: 'left',
          color: null,
          fontSize: 16,
        },
      }),
      block({
        id: 'cta',
        type: 'button',
        props: {
          label: 'Book your onboarding call',
          url: 'https://example.com/onboarding',
          backgroundColor: null,
          textColor: null,
          radius: 8,
          align: 'center',
          fullWidth: false,
        },
      }),
      block({
        id: 'social',
        type: 'social',
        props: { links: FOOTER_SOCIAL, align: 'center', iconColor: null, size: 32 },
      }),
      block({
        id: 'footer',
        type: 'footer',
        props: {
          companyName: '{{organization.name}}',
          addressLine: 'Registered office address',
          contactEmail: 'hello@example.com',
          contactPhone: '+44 20 7946 0000',
          preferencesUrl: 'https://example.com/preferences?email={{contact.email}}',
          unsubscribeUrl: 'https://example.com/unsubscribe?email={{contact.email}}',
          unsubscribeLabel: 'Unsubscribe',
          legalText: 'You are receiving this email because you created an account with {{organization.name}}.',
          showSocial: true,
          socialLinks: FOOTER_SOCIAL,
          backgroundColor: null,
          textColor: null,
        },
      }),
    ],
    'Welcome — here is what happens next.',
  ),
};

/* -------------------------------------------------------------------------- */
/* 2. Newsletter                                                               */
/* -------------------------------------------------------------------------- */

const newsletter: StarterTemplate = {
  id: 'starter-newsletter',
  name: 'Newsletter',
  description: 'Monthly update layout: featured story, editorial copy, a two-item gallery and a divider.',
  category: 'newsletter',
  subject: '{{newsletter.month}} update from {{organization.name}}',
  design: document(
    [
      block({
        id: 'header',
        type: 'header',
        props: {
          brandName: '{{organization.name}}',
          logo: { mediaId: null, url: null, alt: '{{organization.name}} logo' },
          navLinks: BRAND_NAV,
          showNav: true,
          alignment: 'center',
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'featured',
        type: 'promo',
        props: {
          eyebrow: 'Featured this month',
          headline: 'What we learned building for our clients',
          description:
            'A short editorial on the changes that made the biggest difference this month, with the numbers behind them.',
          badge: 'Featured',
          image: { mediaId: null, url: null, alt: 'Featured story artwork' },
          cta: { label: 'Read the story', url: 'https://example.com/blog' },
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'intro',
        type: 'text',
        props: {
          heading: 'Hello {{contact.first_name}},',
          headingLevel: 2,
          html: '<p>Here is the monthly round-up from the {{organization.name}} team — product news, client stories and one practical tip you can use today.</p>',
          alignment: 'left',
          color: null,
          fontSize: 16,
        },
      }),
      block({
        id: 'divider',
        type: 'divider',
        props: { color: null, thickness: 1, width: 100 },
      }),
      block({
        id: 'highlights',
        type: 'gallery',
        props: {
          columns: 2,
          items: [galleryItem('g1', 'Client story'), galleryItem('g2', 'Product update')],
          backgroundColor: null,
        },
      }),
      block({
        id: 'cta',
        type: 'button',
        props: {
          label: 'Read more on the blog',
          url: 'https://example.com/blog',
          backgroundColor: null,
          textColor: null,
          radius: 8,
          align: 'center',
          fullWidth: false,
        },
      }),
      block({
        id: 'footer',
        type: 'footer',
        props: {
          companyName: '{{organization.name}}',
          addressLine: 'Registered office address',
          contactEmail: 'news@example.com',
          contactPhone: '+44 20 7946 0000',
          preferencesUrl: 'https://example.com/preferences?email={{contact.email}}',
          unsubscribeUrl: 'https://example.com/unsubscribe?email={{contact.email}}',
          unsubscribeLabel: 'Unsubscribe',
          legalText: 'You are receiving this newsletter because you subscribed at example.com.',
          showSocial: true,
          socialLinks: FOOTER_SOCIAL,
          backgroundColor: null,
          textColor: null,
        },
      }),
    ],
    'The monthly round-up: product news, client stories and one practical tip.',
  ),
};

/* -------------------------------------------------------------------------- */
/* 3. Product launch                                                           */
/* -------------------------------------------------------------------------- */

const productLaunch: StarterTemplate = {
  id: 'starter-product-launch',
  name: 'Product launch',
  description:
    'Premium launch email: brand header, full-width banner, launch section, three product cards, video thumbnail, CTA and standard footer.',
  category: 'launch',
  subject: 'Introducing {{product.name}} — available now',
  design: document(
    [
      block({
        id: 'header',
        type: 'header',
        props: {
          brandName: '{{organization.name}}',
          logo: { mediaId: null, url: null, alt: '{{organization.name}} logo' },
          navLinks: BRAND_NAV,
          showNav: true,
          alignment: 'center',
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'banner',
        type: 'banner',
        props: {
          image: { mediaId: null, url: null, alt: '{{product.name}} launch banner' },
          url: 'https://example.com/launch',
          height: 280,
          backgroundColor: null,
        },
      }),
      block({
        id: 'launch',
        type: 'promo',
        props: {
          eyebrow: 'New launch',
          headline: 'Meet {{product.name}}',
          description:
            'Built from what our clients asked for most: faster setup, clearer reporting and the same team behind it.',
          badge: 'Just launched',
          image: { mediaId: null, url: null, alt: '{{product.name}} product shot' },
          cta: { label: 'See what is new', url: 'https://example.com/launch' },
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'cards',
        type: 'products',
        props: {
          columns: 3,
          items: [
            product('p1', 'Starter', 'Everything a small team needs to get going.', '£29/mo'),
            product('p2', 'Growth', 'Automation and reporting for scaling teams.', '£79/mo'),
            product('p3', 'Scale', 'Priority support and advanced controls.', '£199/mo'),
          ],
          backgroundColor: null,
          showPrice: true,
        },
      }),
      block({
        id: 'video',
        type: 'video',
        props: {
          thumbnail: { mediaId: null, url: null, alt: 'Product walkthrough thumbnail' },
          videoUrl: 'https://example.com/watch/product-tour',
          title: 'Watch the 2-minute tour',
          description: 'See {{product.name}} in action, from setup to first report.',
          ctaLabel: 'Watch the video',
          showPlayButton: true,
        },
      }),
      block({
        id: 'cta',
        type: 'button',
        props: {
          label: 'Start your free trial',
          url: 'https://example.com/trial',
          backgroundColor: null,
          textColor: null,
          radius: 8,
          align: 'center',
          fullWidth: false,
        },
      }),
      block({
        id: 'footer',
        type: 'footer',
        props: {
          companyName: '{{organization.name}}',
          addressLine: 'Registered office address',
          contactEmail: 'sales@example.com',
          contactPhone: '+44 20 7946 0000',
          preferencesUrl: 'https://example.com/preferences?email={{contact.email}}',
          unsubscribeUrl: 'https://example.com/unsubscribe?email={{contact.email}}',
          unsubscribeLabel: 'Unsubscribe',
          legalText: 'You are receiving this product announcement because you asked for updates from {{organization.name}}.',
          showSocial: true,
          socialLinks: FOOTER_SOCIAL,
          backgroundColor: null,
          textColor: null,
        },
      }),
    ],
    'Introducing {{product.name}} — available now.',
  ),
};

/* -------------------------------------------------------------------------- */
/* 4. Promotional campaign                                                     */
/* -------------------------------------------------------------------------- */

const promotional: StarterTemplate = {
  id: 'starter-promo',
  name: 'Promotional campaign',
  description: 'Offer-led layout: campaign banner, offer section with badge, featured products and CTA.',
  category: 'promotion',
  subject: '{{offer.headline}} — ends {{offer.deadline}}',
  design: document(
    [
      block({
        id: 'header',
        type: 'header',
        props: {
          brandName: '{{organization.name}}',
          logo: { mediaId: null, url: null, alt: '{{organization.name}} logo' },
          navLinks: BRAND_NAV,
          showNav: true,
          alignment: 'center',
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'banner',
        type: 'banner',
        props: {
          image: { mediaId: null, url: null, alt: 'Seasonal campaign artwork' },
          url: 'https://example.com/offer',
          height: 240,
          backgroundColor: null,
        },
      }),
      block({
        id: 'offer',
        type: 'promo',
        props: {
          eyebrow: 'Limited time',
          headline: '{{offer.headline}}',
          description: 'Use the code below at checkout. Applies to all plans until {{offer.deadline}}.',
          badge: '{{offer.discount}}',
          image: { mediaId: null, url: null, alt: 'Featured product' },
          cta: { label: 'Shop the offer', url: 'https://example.com/offer' },
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'featured',
        type: 'products',
        props: {
          columns: 2,
          items: [
            product('p1', 'Best seller', 'Our most popular plan, now with onboarding included.', '£59/mo'),
            product('p2', 'Team bundle', 'Everything in Growth, for up to ten seats.', '£149/mo'),
          ],
          backgroundColor: null,
          showPrice: true,
        },
      }),
      block({
        id: 'cta',
        type: 'button',
        props: {
          label: 'Claim the offer',
          url: 'https://example.com/offer',
          backgroundColor: null,
          textColor: null,
          radius: 8,
          align: 'center',
          fullWidth: false,
        },
      }),
      block({
        id: 'footer',
        type: 'footer',
        props: {
          companyName: '{{organization.name}}',
          addressLine: 'Registered office address',
          contactEmail: 'offers@example.com',
          contactPhone: '+44 20 7946 0000',
          preferencesUrl: 'https://example.com/preferences?email={{contact.email}}',
          unsubscribeUrl: 'https://example.com/unsubscribe?email={{contact.email}}',
          unsubscribeLabel: 'Unsubscribe',
          legalText: 'Marketing email from {{organization.name}}. Offer ends {{offer.deadline}}.',
          showSocial: true,
          socialLinks: FOOTER_SOCIAL,
          backgroundColor: null,
          textColor: null,
        },
      }),
    ],
    '{{offer.headline}} — ends {{offer.deadline}}.',
  ),
};

/* -------------------------------------------------------------------------- */
/* 5. Announcement                                                             */
/* -------------------------------------------------------------------------- */

const announcement: StarterTemplate = {
  id: 'starter-announcement',
  name: 'Announcement',
  description: 'Short company announcement with a headline, supporting copy, a single CTA and the standard footer.',
  category: 'announcement',
  subject: 'An announcement from {{organization.name}}',
  design: document(
    [
      block({
        id: 'header',
        type: 'header',
        props: {
          brandName: '{{organization.name}}',
          logo: { mediaId: null, url: null, alt: '{{organization.name}} logo' },
          navLinks: BRAND_NAV,
          showNav: true,
          alignment: 'center',
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'hero',
        type: 'hero',
        props: {
          image: { mediaId: null, url: null, alt: 'Announcement artwork' },
          headline: '{{announcement.headline}}',
          description: '{{announcement.summary}}',
          cta: { label: 'Read the full announcement', url: 'https://example.com/announcement' },
          overlay: true,
          textColor: null,
          backgroundColor: null,
        },
      }),
      block({
        id: 'body',
        type: 'text',
        props: {
          heading: 'What this means for you',
          headingLevel: 2,
          html: '<p>{{announcement.detail}}</p><p>If you have any questions, reply to this email and the team will help.</p>',
          alignment: 'left',
          color: null,
          fontSize: 16,
        },
      }),
      block({
        id: 'cta',
        type: 'button',
        props: {
          label: 'Read the full announcement',
          url: 'https://example.com/announcement',
          backgroundColor: null,
          textColor: null,
          radius: 8,
          align: 'center',
          fullWidth: false,
        },
      }),
      block({
        id: 'footer',
        type: 'footer',
        props: {
          companyName: '{{organization.name}}',
          addressLine: 'Registered office address',
          contactEmail: 'hello@example.com',
          contactPhone: '+44 20 7946 0000',
          preferencesUrl: 'https://example.com/preferences?email={{contact.email}}',
          unsubscribeUrl: 'https://example.com/unsubscribe?email={{contact.email}}',
          unsubscribeLabel: 'Unsubscribe',
          legalText: 'Service announcement from {{organization.name}}.',
          showSocial: true,
          socialLinks: FOOTER_SOCIAL,
          backgroundColor: null,
          textColor: null,
        },
      }),
    ],
    '{{announcement.summary}}',
  ),
};

/* -------------------------------------------------------------------------- */
/* 6. Client update                                                            */
/* -------------------------------------------------------------------------- */

const clientUpdate: StarterTemplate = {
  id: 'starter-client-update',
  name: 'Client update',
  description: 'Progress update for an existing client: status copy, deliverables gallery and next-steps CTA.',
  category: 'client-update',
  subject: '{{client.company}} — your {{project.name}} update',
  design: document(
    [
      block({
        id: 'header',
        type: 'header',
        props: {
          brandName: '{{organization.name}}',
          logo: { mediaId: null, url: null, alt: '{{organization.name}} logo' },
          navLinks: BRAND_NAV,
          showNav: false,
          alignment: 'left',
          backgroundColor: null,
          textColor: null,
        },
      }),
      block({
        id: 'intro',
        type: 'text',
        props: {
          heading: 'Hi {{client.first_name}},',
          headingLevel: 2,
          html: '<p>Here is where {{project.name}} stands this week, what is next, and anything we need from you.</p>',
          alignment: 'left',
          color: null,
          fontSize: 16,
        },
      }),
      block({
        id: 'progress',
        type: 'text',
        props: {
          heading: 'Progress this week',
          headingLevel: 3,
          html: '<ul><li>Completed: {{progress.completed}}</li><li>In progress: {{progress.in_progress}}</li><li>Next: {{progress.next}}</li></ul>',
          alignment: 'left',
          color: null,
          fontSize: 15,
        },
      }),
      block({
        id: 'deliverables',
        type: 'gallery',
        props: {
          columns: 2,
          items: [galleryItem('d1', 'Deliverable one'), galleryItem('d2', 'Deliverable two')],
          backgroundColor: null,
        },
      }),
      block({
        id: 'cta',
        type: 'button',
        props: {
          label: 'Review and approve',
          url: 'https://example.com/review',
          backgroundColor: null,
          textColor: null,
          radius: 8,
          align: 'center',
          fullWidth: false,
        },
      }),
      block({
        id: 'footer',
        type: 'footer',
        props: {
          companyName: '{{organization.name}}',
          addressLine: 'Registered office address',
          contactEmail: 'projects@example.com',
          contactPhone: '+44 20 7946 0000',
          preferencesUrl: 'https://example.com/preferences?email={{contact.email}}',
          unsubscribeUrl: 'https://example.com/unsubscribe?email={{contact.email}}',
          unsubscribeLabel: 'Unsubscribe',
          legalText: 'Project update for {{client.company}} from {{organization.name}}.',
          showSocial: false,
          socialLinks: [],
          backgroundColor: null,
          textColor: null,
        },
      }),
    ],
    'Your {{project.name}} update — progress, deliverables and next steps.',
  ),
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  welcome,
  newsletter,
  productLaunch,
  promotional,
  announcement,
  clientUpdate,
];

export function getStarterTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((template) => template.id === id);
}

/** Variable names referenced by a starter, used to pre-fill the preview panel. */
export function starterVariables(template: StarterTemplate): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
        if (match[1]) found.add(match[1]);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(walk);
  };
  walk(template.design);
  walk(template.subject);
  return [...found].sort();
}

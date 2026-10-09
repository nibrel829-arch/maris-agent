/**
 * Email Studio — design validation.
 *
 * Checks the things that break real emails before they are sent:
 *  - broken or unsafe links (wrong scheme, relative URL, empty destination),
 *  - missing images and missing alt text,
 *  - missing unsubscribe / preferences links where a marketing email needs
 *    them,
 *  - empty designs and empty call-to-action destinations.
 *
 * The result is a report, never a throw: the studio shows it beside the canvas
 * so the user can fix issues while designing. Errors block a test send;
 * warnings and info are advisory.
 */

import type {
  EmailBlock,
  EmailDesignDocument,
  EmailValidationIssue,
  EmailValidationReport,
} from '@/types/email-design';
import { hasPlaceholder } from './url';

function issue(
  code: string,
  severity: EmailValidationIssue['severity'],
  message: string,
  blockId: string | null = null,
): EmailValidationIssue {
  return { code, severity, message, blockId };
}

function checkUrl(
  raw: string,
  label: string,
  blockId: string,
  issues: EmailValidationIssue[],
  { required = false }: { required?: boolean } = {},
): void {
  const value = raw.trim();
  if (value.length === 0) {
    if (required) {
      issues.push(
        issue('LINK_EMPTY', 'error', `${label} has no destination URL. Add a link or remove the call to action.`, blockId),
      );
    }
    return;
  }
  if (hasPlaceholder(value)) {
    issues.push(
      issue(
        'LINK_DEFERRED',
        'info',
        `${label} contains a {{variable}} that is resolved at send time: ${value}`,
        blockId,
      ),
    );
    return;
  }
  if (/^javascript:/i.test(value) || /^data:/i.test(value) || /^vbscript:/i.test(value)) {
    issues.push(
      issue('LINK_UNSAFE', 'error', `${label} uses a scheme that email clients block: ${value}`, blockId),
    );
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issues.push(
      issue(
        'LINK_INVALID',
        'error',
        `${label} is not a valid absolute URL (use https://…): ${value}`,
        blockId,
      ),
    );
    return;
  }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
    issues.push(issue('LINK_UNSAFE', 'error', `${label} uses the unsupported scheme ${parsed.protocol}.`, blockId));
    return;
  }
  if (parsed.protocol === 'http:') {
    issues.push(
      issue('LINK_INSECURE', 'warning', `${label} uses http:// — most clients and recipients prefer https://.`, blockId),
    );
  }
}

function checkImage(
  image: { mediaId: string | null; url: string | null; alt: string },
  label: string,
  blockId: string,
  issues: EmailValidationIssue[],
  { required = false }: { required?: boolean } = {},
): void {
  const hasSource = Boolean(image.mediaId || (image.url ?? '').trim());
  if (!hasSource) {
    if (required) {
      issues.push(
        issue('IMAGE_EMPTY', 'warning', `${label} has no image. Choose an asset from the Content Library or add a URL.`, blockId),
      );
    }
    return;
  }
  const url = (image.url ?? '').trim();
  if (url) {
    if (/^javascript:/i.test(url) || /^data:/i.test(url)) {
      issues.push(issue('IMAGE_UNSAFE', 'error', `${label} URL uses a blocked scheme: ${url}`, blockId));
    } else if (!hasPlaceholder(url)) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          issues.push(issue('IMAGE_UNSAFE', 'error', `${label} URL must use http or https: ${url}`, blockId));
        }
      } catch {
        issues.push(issue('IMAGE_INVALID', 'error', `${label} URL is not a valid absolute URL: ${url}`, blockId));
      }
    }
  }
  if (!image.alt.trim()) {
    issues.push(
      issue(
        'ALT_MISSING',
        'warning',
        `${label} has no alt text. Recipients who block images (many corporate clients do) will see nothing.`,
        blockId,
      ),
    );
  }
}

function checkBlock(block: EmailBlock, issues: EmailValidationIssue[]): void {
  switch (block.type) {
    case 'header': {
      const p = block.props;
      checkImage(p.logo, 'Header logo', block.id, issues);
      if (!p.brandName.trim() && !p.logo.mediaId && !p.logo.url) {
        issues.push(issue('BRAND_MISSING', 'warning', 'The header has neither a brand name nor a logo.', block.id));
      }
      for (const link of p.navLinks) checkUrl(link.url, `Navigation link "${link.label || 'unnamed'}"`, block.id, issues);
      break;
    }
    case 'hero': {
      const p = block.props;
      checkImage(p.image, 'Hero image', block.id, issues, { required: true });
      if (p.cta) checkUrl(p.cta.url, 'Hero button', block.id, issues, { required: true });
      break;
    }
    case 'banner': {
      const p = block.props;
      checkImage(p.image, 'Banner image', block.id, issues, { required: true });
      if (p.url) checkUrl(p.url, 'Banner link', block.id, issues, { required: true });
      break;
    }
    case 'video': {
      const p = block.props;
      checkImage(p.thumbnail, 'Video thumbnail', block.id, issues, { required: true });
      checkUrl(p.videoUrl, 'Video link', block.id, issues, { required: true });
      issues.push(
        issue(
          'VIDEO_LINK_ONLY',
          'info',
          'Video blocks render as a clickable thumbnail that opens the video in a browser. Inline playback is not assumed in any email client.',
          block.id,
        ),
      );
      break;
    }
    case 'products': {
      const p = block.props;
      if (p.items.length === 0) {
        issues.push(issue('PRODUCTS_EMPTY', 'warning', 'The product catalogue has no products yet.', block.id));
      }
      for (const [index, item] of p.items.entries()) {
        checkImage(item.image, `Product ${index + 1} image`, block.id, issues);
        if (item.url) checkUrl(item.url, `Product ${index + 1} link`, block.id, issues, { required: true });
        if (!item.title.trim()) {
          issues.push(issue('PRODUCT_TITLE_MISSING', 'warning', `Product ${index + 1} has no title.`, block.id));
        }
      }
      break;
    }
    case 'gallery': {
      const p = block.props;
      if (p.items.length === 0) {
        issues.push(issue('GALLERY_EMPTY', 'warning', 'The image gallery has no items yet.', block.id));
      }
      for (const [index, item] of p.items.entries()) {
        checkImage(item.image, `Gallery item ${index + 1}`, block.id, issues);
        if (item.url) checkUrl(item.url, `Gallery item ${index + 1} link`, block.id, issues, { required: true });
      }
      break;
    }
    case 'promo': {
      const p = block.props;
      checkImage(p.image, 'Promotional image', block.id, issues);
      if (p.cta) checkUrl(p.cta.url, 'Promotional button', block.id, issues, { required: true });
      break;
    }
    case 'text': {
      const p = block.props;
      if (!p.heading.trim() && !p.html.trim()) {
        issues.push(issue('TEXT_EMPTY', 'warning', 'The text block is empty.', block.id));
      }
      break;
    }
    case 'button': {
      const p = block.props;
      if (!p.label.trim()) {
        issues.push(issue('BUTTON_LABEL_MISSING', 'warning', 'The button has no label.', block.id));
      }
      checkUrl(p.url, 'Button', block.id, issues, { required: true });
      break;
    }
    case 'social': {
      const p = block.props;
      if (p.links.length === 0) {
        issues.push(issue('SOCIAL_EMPTY', 'warning', 'The social block has no links yet.', block.id));
      }
      for (const link of p.links) checkUrl(link.url, `${link.platform} link`, block.id, issues, { required: true });
      break;
    }
    case 'background':
      checkImage(block.props.image, 'Background image', block.id, issues);
      break;
    case 'footer': {
      const p = block.props;
      if (!p.unsubscribeUrl.trim()) {
        issues.push(
          issue(
            'UNSUBSCRIBE_MISSING',
            'error',
            'The footer has no unsubscribe link. Marketing emails must include a working opt-out.',
            block.id,
          ),
        );
      } else {
        checkUrl(p.unsubscribeUrl, 'Unsubscribe link', block.id, issues, { required: true });
      }
      if (!p.preferencesUrl.trim()) {
        issues.push(
          issue('PREFERENCES_MISSING', 'warning', 'The footer has no email preferences link.', block.id),
        );
      } else {
        checkUrl(p.preferencesUrl, 'Preferences link', block.id, issues);
      }
      if (!p.companyName.trim()) {
        issues.push(issue('FOOTER_COMPANY_MISSING', 'warning', 'The footer has no company name.', block.id));
      }
      for (const link of p.socialLinks) checkUrl(link.url, `${link.platform} link`, block.id, issues, { required: true });
      break;
    }
    default:
      break;
  }
}

/** Validates a design document and returns a structured report. */
export function validateDesign(design: EmailDesignDocument): EmailValidationReport {
  const issues: EmailValidationIssue[] = [];

  if (design.blocks.length === 0) {
    issues.push(
      issue('DESIGN_EMPTY', 'error', 'The design has no blocks. Add at least a header, a content block and a footer.'),
    );
  }

  for (const block of design.blocks) checkBlock(block, issues);

  const hasFooter = design.blocks.some((block) => block.type === 'footer');
  if (!hasFooter && design.blocks.length > 0) {
    issues.push(
      issue(
        'FOOTER_MISSING',
        'error',
        'No footer block. Add the organization footer with contact details, preferences and an unsubscribe link.',
      ),
    );
  }

  if (design.settings.width > 680) {
    issues.push(
      issue('WIDTH_WIDE', 'warning', 'Canvas width above 680px can clip in some email clients. 600px is the safe default.'),
    );
  }

  const errors = issues.filter((entry) => entry.severity === 'error');
  const warnings = issues.filter((entry) => entry.severity === 'warning');
  const info = issues.filter((entry) => entry.severity === 'info');

  return { ok: errors.length === 0, errors, warnings, info };
}

/** One-line summary used by the Manager and the API responses. */
export function summarizeValidation(report: EmailValidationReport): string {
  if (report.errors.length > 0) {
    return `${report.errors.length} blocking issue${report.errors.length === 1 ? '' : 's'}: ${report.errors
      .slice(0, 3)
      .map((entry) => entry.message)
      .join(' ')}`;
  }
  if (report.warnings.length > 0) {
    return `${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}: ${report.warnings
      .slice(0, 2)
      .map((entry) => entry.message)
      .join(' ')}`;
  }
  return 'No validation issues.';
}

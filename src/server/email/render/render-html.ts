/**
 * Email Studio — HTML renderer.
 *
 * Produces a real, responsive, email-client-compatible document:
 *  - table-based layout with `role="presentation"` (no CSS grid/flex reliance),
 *  - inline CSS on every element plus a small `<style>` block for the mobile
 *    media query (the only place a class is needed),
 *  - Outlook (`mso`) conditional tables and VML bulletproof buttons,
 *  - `<img>` with width/height/alt and a colour fallback when the asset is
 *    missing,
 *  - absolutely no JavaScript, no external stylesheets, no web fonts.
 *
 * Every block renders as exactly one well-formed `<tr><td …>…</td></tr>` row of
 * the container table, so the document stays valid for the strictest parsers.
 *
 * Every value interpolated here has already been escaped or URL-validated by
 * the render pipeline in `./index.ts`; this module only assembles markup.
 */

import type { EmailBlock, EmailDesignDocument, EmailSocialPlatform } from '@/types/email-design';
import { escapeAttr, escapeHtml, sanitizeRichText } from './sanitize';

export interface RenderedImage {
  /** Absolute URL, or null when no asset/URL is available. */
  url: string | null;
  alt: string;
  width: number;
  height: number;
}

type StyleValue = string | number | undefined | null;

function style(record: Record<string, StyleValue>): string {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

const SOCIAL_GLYPHS: Record<EmailSocialPlatform, string> = {
  facebook: 'f',
  instagram: 'ig',
  linkedin: 'in',
  x: 'X',
  youtube: '▶',
  tiktok: 'tt',
  pinterest: 'p',
  whatsapp: 'wa',
  website: '↗',
};

const SOCIAL_LABELS: Record<EmailSocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  whatsapp: 'WhatsApp',
  website: 'Website',
};

/** Resolved (absolute, validated) URLs for one block's fields. */
export interface ResolvedBlockLinks {
  [key: string]: string | null;
}

export interface HtmlRenderOptions {
  subject: string;
  preheader: string;
  /** Resolves a Content Library media id to an absolute URL (or null). */
  resolveAssetUrl: (mediaId: string) => string | null;
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

function imgTag(
  image: RenderedImage,
  options: { width?: number; rounded?: boolean; fallbackBg?: string; extraStyle?: Record<string, StyleValue> } = {},
): string {
  const width = options.width ?? image.width;
  const base: Record<string, StyleValue> = {
    display: 'block',
    border: 0,
    'max-width': '100%',
    width: '100%',
    height: 'auto',
    ...(options.rounded ? { 'border-radius': '8px' } : {}),
    ...(options.extraStyle ?? {}),
  };
  if (!image.url) {
    // Sensible fallback: a labelled colour block so the layout never collapses.
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${style({
      'background-color': options.fallbackBg ?? '#e5e7eb',
      ...(options.rounded ? { 'border-radius': '8px' } : {}),
    })}"><tr><td align="center" style="${style({
      padding: '28px 16px',
      'font-family': 'Helvetica, Arial, sans-serif',
      'font-size': '13px',
      'line-height': '20px',
      color: '#6b7280',
    })}">${escapeHtml(image.alt || 'Image unavailable')}</td></tr></table>`;
  }
  return `<img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.alt)}" width="${width}" style="${style(base)}" />`;
}

/** Wraps block content in one row of the container table. */
function row(cellStyle: string, content: string, attributes = ''): string {
  return `<tr${attributes}><td${cellStyle ? ` style="${cellStyle}"` : ''}>${content}</td></tr>`;
}

/**
 * Bulletproof button: an `<a>` for modern clients, wrapped in an Outlook VML
 * `v:roundrect` so desktop Word-based clients still render a clickable button.
 */
function buttonHtml(options: {
  label: string;
  url: string | null;
  backgroundColor: string;
  textColor: string;
  radius: number;
  fullWidth: boolean;
  align: 'left' | 'center' | 'right';
  fontFamily: string;
  uppercase: boolean;
  fontWeight: 'normal' | 'bold';
}): string {
  const label = escapeHtml(options.label);
  const alignMap = { left: 'left', center: 'center', right: 'right' } as const;
  if (!options.url) {
    // No destination yet: render the visual button without a link so the
    // canvas still shows the design.
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${alignMap[options.align]}" style="margin:0 auto;"><tr><td align="center" style="${style({
      'background-color': options.backgroundColor,
      'border-radius': `${options.radius}px`,
      padding: '14px 28px',
      'font-family': options.fontFamily,
      'font-size': '15px',
      'font-weight': options.fontWeight,
      'line-height': '20px',
      color: options.textColor,
      'text-transform': options.uppercase ? 'uppercase' : 'none',
      'mso-padding-alt': '14px 28px',
    })}">${label}</td></tr></table>`;
  }

  const href = escapeAttr(options.url);
  const cellStyle = style({
    'background-color': options.backgroundColor,
    'border-radius': `${options.radius}px`,
    padding: '14px 28px',
    'font-family': options.fontFamily,
    'font-size': '15px',
    'font-weight': options.fontWeight,
    'line-height': '20px',
    'text-align': 'center',
    color: options.textColor,
    'text-decoration': 'none',
    'text-transform': options.uppercase ? 'uppercase' : 'none',
    display: options.fullWidth ? 'block' : 'inline-block',
    width: options.fullWidth ? '100%' : 'auto',
    'mso-padding-alt': '14px 28px',
  });

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="' + alignMap[options.align] + '" style="margin:0 auto;">',
    '<tr><td align="center">',
    '<!--[if mso]>',
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="v-text-anchor:middle;${options.fullWidth ? 'width:100%;' : ''}" arcsize="${Math.round(
      (options.radius / 48) * 100,
    )}%" strokecolor="${options.backgroundColor}" fillcolor="${options.backgroundColor}">`,
    '<w:anchorlock/>',
    `<center style="color:${options.textColor};font-family:${options.fontFamily};font-size:15px;font-weight:${options.fontWeight};text-transform:${options.uppercase ? 'uppercase' : 'none'};">${label}</center>`,
    '</v:roundrect>',
    '<![endif]-->',
    '<!--[if !mso]><!-- -->',
    `<a href="${href}" style="${cellStyle}">${label}</a>`,
    '<!--<![endif]-->',
    '</td></tr></table>',
  ].join('');
}

function socialIconHtml(platform: EmailSocialPlatform, url: string | null, color: string, size: number): string {
  const glyph = SOCIAL_GLYPHS[platform];
  const label = SOCIAL_LABELS[platform];
  const inner = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td align="center" width="${size}" height="${size}" style="${style({
    width: `${size}px`,
    height: `${size}px`,
    'background-color': color,
    'border-radius': '50%',
    'font-family': 'Helvetica, Arial, sans-serif',
    'font-size': `${Math.round(size * 0.42)}px`,
    'font-weight': 'bold',
    'line-height': `${size}px`,
    color: '#ffffff',
    'text-align': 'center',
  })}">${escapeHtml(glyph)}</td></tr></table>`;

  if (!url) {
    return `<td align="center" style="padding:0 5px;">${inner}</td>`;
  }
  return `<td align="center" style="padding:0 5px;"><a href="${escapeAttr(url)}" style="text-decoration:none;" aria-label="${escapeAttr(
    label,
  )}">${inner}</a></td>`;
}

/* -------------------------------------------------------------------------- */
/* Block renderers                                                             */
/* -------------------------------------------------------------------------- */

interface BlockContext extends HtmlRenderOptions {
  design: EmailDesignDocument;
}

function columnWidths(count: number): number[] {
  return Array.from({ length: count }, () => Math.floor(100 / count));
}

function renderProductsBlock(block: EmailBlock & { type: 'products' }, ctx: BlockContext): string {
  const props = block.props;
  const brand = ctx.design.brand;
  const font = ctx.design.settings.fontFamily;
  const bg = props.backgroundColor ?? brand.colors.surface;
  const items = props.items.slice(0, 12);
  const count = Math.max(1, Math.min(props.columns, items.length || props.columns));
  const widths = columnWidths(count);
  const surface = brand.colors.surface;

  if (items.length === 0) {
    return row(
      style({ 'background-color': bg, padding: '24px', 'font-family': font, 'font-size': '14px', color: brand.colors.muted, 'text-align': 'center' }),
      'No products added yet.',
    );
  }

  const rows: string[] = [];
  for (let index = 0; index < items.length; index += count) {
    const rowItems = items.slice(index, index + count);
    const cells = rowItems
      .map((item, cellIndex) => {
        const image: RenderedImage = {
          url: item.image.mediaId ? ctx.resolveAssetUrl(item.image.mediaId) : item.image.url,
          alt: item.image.alt,
          width: 240,
          height: 160,
        };
        const price = props.showPrice && item.price
          ? `<p style="${style({ margin: '6px 0 0', 'font-family': font, 'font-size': '15px', 'font-weight': 'bold', color: brand.colors.primary })}">${escapeHtml(
              item.price,
            )}</p>`
          : '';
        const description = item.description
          ? `<p style="${style({ margin: '6px 0 0', 'font-family': font, 'font-size': '13px', 'line-height': '20px', color: brand.colors.muted })}">${escapeHtml(
              item.description,
            )}</p>`
          : '';
        const link = item.url
          ? `<a href="${escapeAttr(item.url)}" style="${style({ color: brand.colors.link, 'font-family': font, 'font-size': '13px', 'text-decoration': 'underline' })}">${escapeHtml(
              item.ctaLabel || 'View',
            )}</a>`
          : '';
        return `<td class="stack" width="${widths[cellIndex] ?? 100}" valign="top" style="${style({
          width: `${widths[cellIndex] ?? 100}%`,
          padding: '8px',
          'background-color': bg,
        })}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${style({
          'background-color': surface,
          'border-radius': '10px',
          border: `1px solid ${brand.colors.background}`,
        })}"><tr><td style="${style({ padding: '12px' })}">${imgTag(image, {
          rounded: true,
          fallbackBg: brand.colors.background,
        })}<p style="${style({
          margin: '10px 0 0',
          'font-family': font,
          'font-size': '15px',
          'font-weight': 'bold',
          'line-height': '22px',
          color: brand.colors.text,
        })}">${escapeHtml(item.title)}</p>${description}${price}<p style="${style({ margin: '10px 0 0' })}">${link}</p></td></tr></table></td>`;
      })
      .join('');
    rows.push(`<tr>${cells}</tr>`);
  }

  return row(
    style({ 'background-color': bg, padding: '12px' }),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="stack-table"><tbody>${rows.join(
      '',
    )}</tbody></table>`,
  );
}

function renderGalleryBlock(block: EmailBlock & { type: 'gallery' }, ctx: BlockContext): string {
  const props = block.props;
  const brand = ctx.design.brand;
  const font = ctx.design.settings.fontFamily;
  const bg = props.backgroundColor ?? brand.colors.surface;
  const items = props.items.slice(0, 12);
  if (items.length === 0) {
    return row(
      style({ 'background-color': bg, padding: '24px', 'font-family': font, 'font-size': '14px', color: brand.colors.muted, 'text-align': 'center' }),
      'No gallery items yet.',
    );
  }
  const count = Math.max(1, Math.min(props.columns, items.length));
  const widths = columnWidths(count);
  const rows: string[] = [];
  for (let index = 0; index < items.length; index += count) {
    const cells = items
      .slice(index, index + count)
      .map((item, cellIndex) => {
        const image: RenderedImage = {
          url: item.image.mediaId ? ctx.resolveAssetUrl(item.image.mediaId) : item.image.url,
          alt: item.image.alt,
          width: 240,
          height: 180,
        };
        const caption = item.title
          ? `<p style="${style({ margin: '8px 0 0', 'font-family': font, 'font-size': '13px', color: brand.colors.text, 'text-align': 'center' })}">${escapeHtml(
              item.title,
            )}</p>`
          : '';
        const body = `${imgTag(image, { rounded: true, fallbackBg: brand.colors.background })}${caption}`;
        return `<td class="stack" width="${widths[cellIndex] ?? 100}" valign="top" style="${style({
          width: `${widths[cellIndex] ?? 100}%`,
          padding: '6px',
        })}">${
          item.url
            ? `<a href="${escapeAttr(item.url)}" style="text-decoration:none;display:block;">${body}</a>`
            : `<div style="display:block;">${body}</div>`
        }</td>`;
      })
      .join('');
    rows.push(`<tr>${cells}</tr>`);
  }
  return row(
    style({ 'background-color': bg, padding: '12px' }),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody>${rows.join(
      '',
    )}</tbody></table>`,
  );
}

/** A full-width inner table used for stacked content inside one block. */
function stackTable(cellStyle: string, content: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td${cellStyle ? ` style="${cellStyle}"` : ''}>${content}</td></tr></table>`;
}

function renderBlock(block: EmailBlock, ctx: BlockContext): string {
  const brand = ctx.design.brand;
  const font = ctx.design.settings.fontFamily;
  const surface = brand.colors.surface;
  switch (block.type) {
    case 'header': {
      const props = block.props;
      const bg = props.backgroundColor ?? surface;
      const logo: RenderedImage = {
        url: props.logo.mediaId ? ctx.resolveAssetUrl(props.logo.mediaId) : props.logo.url,
        alt: props.logo.alt || props.brandName,
        width: 140,
        height: 40,
      };
      const logoCell = logo.url
        ? imgTag(logo, { width: 140 })
        : `<div style="${style({ 'font-family': font, 'font-size': '20px', 'font-weight': 'bold', color: brand.colors.primary })}">${escapeHtml(
            props.brandName,
          )}</div>`;
      const nav = props.showNav && props.navLinks.length
        ? `<p style="${style({ margin: '10px 0 0', 'font-family': font, 'font-size': '13px' })}">${props.navLinks
            .map((link) => {
              if (!link.url) return escapeHtml(link.label);
              return `<a href="${escapeAttr(link.url)}" style="${style({
                color: brand.colors.link,
                'text-decoration': 'none',
                padding: '0 8px',
              })}">${escapeHtml(link.label)}</a>`;
            })
            .join('')}</p>`
        : '';
      return row(
        style({
          'background-color': bg,
          padding: '22px 24px',
          'border-bottom': `1px solid ${brand.colors.background}`,
          'text-align': props.alignment,
        }),
        `${logoCell}${nav}`,
      );
    }

    case 'hero': {
      const props = block.props;
      const bg = props.backgroundColor ?? brand.colors.surface;
      const color = props.textColor ?? brand.colors.text;
      const image: RenderedImage = {
        url: props.image.mediaId ? ctx.resolveAssetUrl(props.image.mediaId) : props.image.url,
        alt: props.image.alt || props.headline,
        width: ctx.design.settings.width,
        height: 320,
      };
      const headline = props.headline
        ? `<h1 style="${style({ margin: 0, 'font-family': brand.typography.headingFont, 'font-size': '30px', 'line-height': '38px', color })}">${escapeHtml(
            props.headline,
          )}</h1>`
        : '';
      const description = props.description
        ? `<p style="${style({ margin: '12px 0 0', 'font-family': font, 'font-size': '16px', 'line-height': '26px', color })}">${escapeHtml(
            props.description,
          )}</p>`
        : '';
      const cta = props.cta
        ? buttonHtml({
            label: props.cta.label,
            url: props.cta.url || null,
            backgroundColor: brand.colors.buttonBackground,
            textColor: brand.colors.buttonText,
            radius: brand.button.radius,
            fullWidth: false,
            align: 'center',
            fontFamily: font,
            uppercase: brand.button.uppercase,
            fontWeight: brand.button.fontWeight,
          })
        : '';
      return row(
        style({ 'background-color': bg }),
        `${stackTable(style({ padding: 0 }), imgTag(image, { fallbackBg: brand.colors.background }))}${stackTable(
          style({ padding: '28px 24px 32px', 'text-align': 'center' }),
          `${headline}${description}${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto 0;"><tr><td>${cta}</td></tr></table>` : ''}`,
        )}`,
      );
    }

    case 'banner': {
      const props = block.props;
      const bg = props.backgroundColor ?? brand.colors.background;
      const image: RenderedImage = {
        url: props.image.mediaId ? ctx.resolveAssetUrl(props.image.mediaId) : props.image.url,
        alt: props.image.alt || 'Banner',
        width: ctx.design.settings.width,
        height: props.height,
      };
      const body = imgTag(image, { fallbackBg: bg });
      return row(
        style({ 'background-color': bg, padding: 0 }),
        props.url ? `<a href="${escapeAttr(props.url)}" style="text-decoration:none;display:block;">${body}</a>` : body,
      );
    }

    case 'video': {
      const props = block.props;
      const thumb: RenderedImage = {
        url: props.thumbnail.mediaId ? ctx.resolveAssetUrl(props.thumbnail.mediaId) : props.thumbnail.url,
        alt: props.thumbnail.alt || props.title || 'Video thumbnail',
        width: ctx.design.settings.width,
        height: 260,
      };
      const play = props.showPlayButton
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td align="center" width="68" height="68" style="${style({
            width: '68px',
            height: '68px',
            'background-color': 'rgba(15,23,42,0.62)',
            'border-radius': '50%',
            'font-family': 'Helvetica, Arial, sans-serif',
            'font-size': '26px',
            'line-height': '68px',
            color: '#ffffff',
            'text-align': 'center',
          })}">&#9654;</td></tr></table>`
        : '';
      const title = props.title
        ? `<p style="${style({ margin: 0, 'font-family': brand.typography.headingFont, 'font-size': '20px', 'line-height': '28px', color: brand.colors.text, 'text-align': 'center' })}">${escapeHtml(
            props.title,
          )}</p>`
        : '';
      const description = props.description
        ? `<p style="${style({ margin: '8px 0 0', 'font-family': font, 'font-size': '14px', 'line-height': '22px', color: brand.colors.muted, 'text-align': 'center' })}">${escapeHtml(
            props.description,
          )}</p>`
        : '';
      const cta = props.videoUrl
        ? buttonHtml({
            label: props.ctaLabel || 'Watch the video',
            url: props.videoUrl,
            backgroundColor: brand.colors.buttonBackground,
            textColor: brand.colors.buttonText,
            radius: brand.button.radius,
            fullWidth: false,
            align: 'center',
            fontFamily: font,
            uppercase: brand.button.uppercase,
            fontWeight: brand.button.fontWeight,
          })
        : '';
      // Email clients do not reliably play inline video: the thumbnail is a
      // link that opens the video in a browser. No <video>, no autoplay, no
      // JavaScript — only a clickable image.
      const thumbArea = thumb.url
        ? `<td align="center" background="${escapeAttr(thumb.url)}" bgcolor="${brand.colors.secondary}" style="${style({
            'background-image': `url('${thumb.url.replace(/'/g, '%27')}')`,
            'background-size': 'cover',
            'background-position': 'center',
            padding: '48px 0',
          })}">${
            props.videoUrl
              ? `<a href="${escapeAttr(props.videoUrl)}" style="text-decoration:none;display:block;">${play}</a>`
              : play
          }</td>`
        : `<td align="center" style="${style({ padding: 0 })}">${imgTag(thumb, {
            fallbackBg: brand.colors.background,
            width: ctx.design.settings.width,
          })}</td>`;
      return row(
        style({ 'background-color': surface, padding: '20px 24px' }),
        `${stackTable(
          style({ 'border-radius': '10px', overflow: 'hidden' }),
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${thumbArea}</tr></table>`,
        )}${stackTable(
          style({ padding: '18px 8px 4px', 'text-align': 'center' }),
          `${title}${description}${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 0;"><tr><td>${cta}</td></tr></table>` : ''}`,
        )}`,
      );
    }

    case 'products':
      return renderProductsBlock(block, ctx);

    case 'gallery':
      return renderGalleryBlock(block, ctx);

    case 'promo': {
      const props = block.props;
      const bg = props.backgroundColor ?? brand.colors.primary;
      const color = props.textColor ?? '#ffffff';
      const badge = props.badge
        ? `<p style="${style({ margin: '0 0 10px', 'font-family': font, 'font-size': '12px', 'font-weight': 'bold', 'letter-spacing': '1px', 'text-transform': 'uppercase', color })}">${escapeHtml(
            props.badge,
          )}</p>`
        : '';
      const eyebrow = props.eyebrow
        ? `<p style="${style({ margin: '0 0 6px', 'font-family': font, 'font-size': '13px', color })}">${escapeHtml(props.eyebrow)}</p>`
        : '';
      const headline = props.headline
        ? `<h2 style="${style({ margin: 0, 'font-family': brand.typography.headingFont, 'font-size': '24px', 'line-height': '32px', color })}">${escapeHtml(
            props.headline,
          )}</h2>`
        : '';
      const description = props.description
        ? `<p style="${style({ margin: '10px 0 0', 'font-family': font, 'font-size': '15px', 'line-height': '24px', color })}">${escapeHtml(
            props.description,
          )}</p>`
        : '';
      const cta = props.cta
        ? buttonHtml({
            label: props.cta.label,
            url: props.cta.url || null,
            backgroundColor: '#ffffff',
            textColor: brand.colors.primary,
            radius: brand.button.radius,
            fullWidth: false,
            align: 'left',
            fontFamily: font,
            uppercase: brand.button.uppercase,
            fontWeight: brand.button.fontWeight,
          })
        : '';
      const image: RenderedImage = {
        url: props.image.mediaId ? ctx.resolveAssetUrl(props.image.mediaId) : props.image.url,
        alt: props.image.alt || props.headline,
        width: 240,
        height: 240,
      };
      const imageCell = imgTag(image, { rounded: true, fallbackBg: brand.colors.secondary });
      const content = `${badge}${eyebrow}${headline}${description}${
        cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;"><tr><td>${cta}</td></tr></table>` : ''
      }`;
      const hasImage = Boolean(props.image.mediaId || props.image.url);
      const inner = hasImage
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="stack" width="60%" valign="middle" style="${style({
            width: '60%',
            padding: '28px 24px',
          })}">${content}</td><td class="stack" width="40%" valign="middle" style="${style({ width: '40%', padding: '20px' })}">${imageCell}</td></tr></table>`
        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="${style({
            padding: '30px 26px',
          })}">${content}</td></tr></table>`;
      return row(style({ 'background-color': bg }), inner);
    }

    case 'text': {
      const props = block.props;
      const color = props.color ?? brand.colors.text;
      const heading = props.heading
        ? `<h${props.headingLevel} style="${style({
            margin: '0 0 12px',
            'font-family': brand.typography.headingFont,
            'font-size': props.headingLevel === 1 ? '26px' : props.headingLevel === 2 ? '21px' : '18px',
            'line-height': '30px',
            color,
          })}">${escapeHtml(props.heading)}</h${props.headingLevel}>`
        : '';
      const body = props.html
        ? `<div style="${style({
            'font-family': font,
            'font-size': `${props.fontSize}px`,
            'line-height': `${Math.round(props.fontSize * 1.6)}px`,
            color,
          })}">${sanitizeRichText(props.html)}</div>`
        : '';
      return row(
        style({ 'background-color': surface, padding: '24px', 'text-align': props.alignment }),
        `${heading}${body}`,
      );
    }

    case 'button': {
      const props = block.props;
      return row(
        style({ 'background-color': surface, padding: '8px 24px 24px' }),
        buttonHtml({
          label: props.label,
          url: props.url || null,
          backgroundColor: props.backgroundColor ?? brand.colors.buttonBackground,
          textColor: props.textColor ?? brand.colors.buttonText,
          radius: props.radius,
          fullWidth: props.fullWidth,
          align: props.align,
          fontFamily: font,
          uppercase: brand.button.uppercase,
          fontWeight: brand.button.fontWeight,
        }),
      );
    }

    case 'social': {
      const props = block.props;
      const color = props.iconColor ?? brand.colors.primary;
      const icons = props.links.map((link) => socialIconHtml(link.platform, link.url || null, color, props.size)).join('');
      return row(
        style({ 'background-color': surface, padding: '16px 24px 24px', 'text-align': props.align }),
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>${icons}</tr></table>`,
      );
    }

    case 'spacer': {
      const props = block.props;
      return row(
        style({
          height: `${props.height}px`,
          'line-height': `${props.height}px`,
          'font-size': '1px',
          'background-color': props.backgroundColor ?? surface,
        }),
        '&nbsp;',
      );
    }

    case 'divider': {
      const props = block.props;
      return row(
        style({ 'background-color': surface, padding: '12px 24px' }),
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="${style({
          'border-top': `${props.thickness}px solid ${props.color ?? brand.colors.background}`,
          'font-size': '1px',
          'line-height': '1px',
          width: `${props.width}%`,
        })}">&nbsp;</td></tr></table>`,
      );
    }

    case 'background': {
      const props = block.props;
      const bg = props.backgroundColor ?? brand.colors.background;
      const image: RenderedImage = {
        url: props.image.mediaId ? ctx.resolveAssetUrl(props.image.mediaId) : props.image.url,
        alt: props.image.alt || '',
        width: ctx.design.settings.width,
        height: 200,
      };
      const heading = props.heading
        ? `<h2 style="${style({ margin: '0 0 8px', 'font-family': brand.typography.headingFont, 'font-size': '22px', 'line-height': '30px', color: props.textColor ?? brand.colors.text })}">${escapeHtml(
            props.heading,
          )}</h2>`
        : '';
      const text = props.text
        ? `<p style="${style({ margin: 0, 'font-family': font, 'font-size': '15px', 'line-height': '24px', color: props.textColor ?? brand.colors.text })}">${escapeHtml(
            props.text,
          )}</p>`
        : '';
      const hasImage = Boolean(image.url);
      return row(
        style({
          'background-color': bg,
          ...(hasImage
            ? {
                'background-image': `url('${String(image.url).replace(/'/g, '%27')}')`,
                'background-size': 'cover',
                'background-position': 'center',
              }
            : {}),
          padding: `${props.padding}px 24px`,
          'text-align': 'center',
        }),
        `${heading}${text}`,
        hasImage ? ` background="${escapeAttr(String(image.url))}" bgcolor="${bg}"` : '',
      );
    }

    case 'footer': {
      const props = block.props;
      const bg = props.backgroundColor ?? brand.colors.secondary;
      const color = props.textColor ?? '#ffffff';
      const company = props.companyName
        ? `<p style="${style({ margin: 0, 'font-family': font, 'font-size': '15px', 'font-weight': 'bold', color })}">${escapeHtml(
            props.companyName,
          )}</p>`
        : '';
      const address = props.addressLine
        ? `<p style="${style({ margin: '6px 0 0', 'font-family': font, 'font-size': '13px', 'line-height': '20px', color })}">${escapeHtml(
            props.addressLine,
          )}</p>`
        : '';
      const contactBits = [props.contactEmail, props.contactPhone].filter(Boolean);
      const contact = contactBits.length
        ? `<p style="${style({ margin: '6px 0 0', 'font-family': font, 'font-size': '13px', 'line-height': '20px', color })}">${contactBits
            .map((bit) => escapeHtml(bit as string))
            .join(' · ')}</p>`
        : '';
      const legal = props.legalText
        ? `<p style="${style({ margin: '10px 0 0', 'font-family': font, 'font-size': '12px', 'line-height': '18px', color })}">${escapeHtml(
            props.legalText,
          )}</p>`
        : '';
      const links = [props.preferencesUrl, props.unsubscribeUrl]
        .filter((url): url is string => Boolean(url))
        .map((url) => {
          const label = url === props.unsubscribeUrl ? props.unsubscribeLabel || 'Unsubscribe' : 'Email preferences';
          return `<a href="${escapeAttr(url)}" style="${style({
            color,
            'font-family': font,
            'font-size': '12px',
            'text-decoration': 'underline',
          })}">${escapeHtml(label)}</a>`;
        })
        .join(' &nbsp;·&nbsp; ');
      const linksRow = links ? `<p style="${style({ margin: '12px 0 0' })}">${links}</p>` : '';
      const social = props.showSocial && props.socialLinks.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 0;"><tr>${props.socialLinks
            .map((link) => socialIconHtml(link.platform, link.url || null, color, 28))
            .join('')}</tr></table>`
        : '';
      return row(
        style({ 'background-color': bg, padding: '28px 24px', 'text-align': 'center' }),
        `${company}${address}${contact}${legal}${linksRow}${social}`,
      );
    }

    default:
      return '';
  }
}

/* -------------------------------------------------------------------------- */
/* Document                                                                    */
/* -------------------------------------------------------------------------- */

const MOBILE_STYLES = `
@media only screen and (max-width:620px){
  .email-container{width:100% !important;max-width:100% !important;border-radius:0 !important;}
  .stack{display:block !important;width:100% !important;max-width:100% !important;box-sizing:border-box !important;}
  .stack-table td{display:block !important;width:100% !important;}
  .mobile-center{text-align:center !important;}
  .mobile-hide{display:none !important;}
  h1{font-size:24px !important;line-height:32px !important;}
  h2{font-size:20px !important;line-height:28px !important;}
  .mobile-btn a{display:block !important;width:100% !important;}
}
`;

/** Renders the complete HTML document for a design. */
export function renderEmailHtml(design: EmailDesignDocument, options: HtmlRenderOptions): string {
  const ctx: BlockContext = { ...options, design };
  const width = design.settings.width;
  // Each block is wrapped in a <tbody data-email-block="…"> so the studio canvas
  // can locate, highlight, select and reorder the real rendered element inside
  // the preview iframe — the preview is the artefact, not an approximation.
  const body = design.blocks
    .map((block) => `<tbody data-email-block="${escapeAttr(block.id)}">${renderBlock(block, ctx)}</tbody>`)
    .join('\n');
  const preheader = options.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(
        options.preheader,
      )}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(options.subject)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style type="text/css">${MOBILE_STYLES}</style>
</head>
<body style="margin:0;padding:0;word-spacing:normal;background-color:${design.settings.backgroundColor};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${design.settings.backgroundColor};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" class="email-container" width="${width}" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:${width}px;margin:0 auto;background-color:${design.settings.surfaceColor};border-radius:12px;overflow:hidden;">
${body}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

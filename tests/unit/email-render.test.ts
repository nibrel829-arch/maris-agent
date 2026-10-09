import { describe, expect, it } from 'vitest';
import {
  checkEmailUrl,
  escapeHtml,
  escapeAttr,
  renderEmail,
  renderEmailFromUnknown,
  sanitizeRichText,
  substituteVariables,
  textFromHtml,
  validateDesign,
  summarizeValidation,
} from '@/server/email/render';
import {
  DEFAULT_EMAIL_BRAND_TOKENS,
  DEFAULT_EMAIL_BRAND_PROFILE,
  type EmailBlock,
  type EmailDesignDocument,
} from '@/types/email-design';
import { createBlock, emptyDesignDocument } from '@/features/email/studio/block-defaults';

function document(blocks: EmailBlock[], preheader = ''): EmailDesignDocument {
  const base = emptyDesignDocument(DEFAULT_EMAIL_BRAND_PROFILE);
  return { ...base, blocks, settings: { ...base.settings, preheader } };
}

function block(type: Parameters<typeof createBlock>[0], patch: Record<string, unknown> = {}): EmailBlock {
  const created = createBlock(type, { brand: DEFAULT_EMAIL_BRAND_TOKENS, profile: null });
  return { ...created, props: { ...created.props, ...patch } } as EmailBlock;
}

const resolver = (id: string) => `https://studio.nibrexo.test/api/workspace/email/assets/${id}`;

/** Balanced-tag check: a rendered email must be parseable by strict clients. */
function tagBalanceProblems(html: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const token = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const voids = new Set(['img', 'br', 'hr', 'meta', 'link', 'input']);
  let match: RegExpExecArray | null;
  while ((match = token.exec(html)) !== null) {
    const index = match.index;
    // Skip anything inside a conditional comment.
    if (html.lastIndexOf('<!--', index) > html.lastIndexOf('-->', index)) continue;
    const [full, closing, rawName = '', , selfClose] = match;
    const name = rawName.toLowerCase();
    if (voids.has(name) || selfClose === '/') continue;
    if (!closing) {
      stack.push(name);
      continue;
    }
    const open = stack.pop();
    if (open !== name) problems.push(`</${name}> does not close <${open ?? 'nothing'}> (${full.slice(0, 40)})`);
  }
  if (stack.length > 0) problems.push(`unclosed tags: ${stack.join(', ')}`);
  return problems;
}

describe('Email HTML renderer', () => {
  it('produces a balanced, table-based document with inline CSS and no JavaScript', () => {
    const design = document(
      [
        block('header', { brandName: 'Nibrexo' }),
        block('hero', { headline: 'Launch day', description: 'Everything is ready.' }),
        block('products', { items: [] }),
        block('footer', { companyName: 'Nibrexo Ltd', unsubscribeUrl: 'https://nibrexo.test/unsub' }),
      ],
      'A short preheader',
    );
    const rendered = renderEmail(design, { resolveAssetUrl: resolver });

    expect(tagBalanceProblems(rendered.html)).toEqual([]);
    expect(rendered.html).toContain('<!DOCTYPE html>');
    expect(rendered.html).toContain('role="presentation"');
    expect(rendered.html).toContain('cellpadding="0"');
    expect(rendered.html).toMatch(/<style type="text\/css">/);
    expect(rendered.html).toMatch(/max-width:620px/);
    expect(rendered.html).toContain('<!--[if mso]>');
    // No script, no event handlers, no external stylesheet or font.
    expect(rendered.html).not.toMatch(/<script/i);
    expect(rendered.html).not.toMatch(/on(click|load|mouseover)=/i);
    expect(rendered.html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(rendered.html).not.toMatch(/@import/);
    // Preheader is present and hidden.
    expect(rendered.html).toContain('A short preheader');
    expect(rendered.html).toMatch(/mso-hide:all/);
  });

  it('tags every rendered block so the canvas can select the real element', () => {
    const header = block('header');
    const hero = block('hero');
    const rendered = renderEmail(document([header, hero]), { resolveAssetUrl: resolver });

    expect(rendered.html).toContain(`<tbody data-email-block="${header.id}">`);
    expect(rendered.html).toContain(`<tbody data-email-block="${hero.id}">`);
    expect(rendered.html).not.toContain('__BLOCK__');
  });

  it('escapes user content instead of treating it as markup', () => {
    const hostile = '<img src=x onerror="alert(1)"> & "quoted"';
    const rendered = renderEmail(
      document([block('text', { heading: hostile, html: hostile })]),
      { resolveAssetUrl: resolver },
    );

    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img src=x onerror=');
    expect(rendered.html).toContain('&amp;');
    expect(rendered.html).toContain('&quot;quoted&quot;');
    expect(rendered.html).not.toMatch(/onerror="alert/i);
  });

  it('substitutes variables, reports the unresolved ones and escapes substituted values', () => {
    const design = document(
      [block('text', { heading: 'Hello {{contact.name}}', html: '<p>{{contact.company}}</p>' })],
      'Hi {{user.name}}',
    );
    const { design: substituted, unresolved } = substituteVariables(design, {
      'contact.name': 'Ada <b>Lovelace</b>',
    });

    expect(unresolved).toEqual(['contact.company', 'user.name']);
    const heading = substituted.blocks[0];
    expect(heading?.type).toBe('text');
    if (!heading || heading.type !== 'text') return;
    expect(heading.props.heading).toBe('Hello Ada <b>Lovelace</b>');

    const rendered = renderEmail(design, {
      resolveAssetUrl: resolver,
      variables: { 'contact.name': 'Ada <script>' },
    });
    expect(rendered.html).toContain('Hello Ada &lt;script&gt;');
    expect(rendered.unresolvedVariables).toEqual(['contact.company', 'user.name']);
  });

  it('resolves Content Library assets through the injected resolver and keeps alt text', () => {
    const mediaId = '11111111-1111-1111-1111-111111111111';
    const rendered = renderEmail(
      document([
        block('banner', { image: { mediaId, url: null, alt: 'Launch banner' }, url: 'https://nibrexo.test/launch' }),
      ]),
      { resolveAssetUrl: resolver },
    );

    expect(rendered.html).toContain(resolver(mediaId));
    expect(rendered.html).toContain('alt="Launch banner"');
    expect(rendered.html).toContain('href="https://nibrexo.test/launch"');
  });

  it('falls back to a labelled colour block when an asset is missing', () => {
    const rendered = renderEmail(
      document([block('banner', { image: { mediaId: null, url: null, alt: 'Missing banner' } })]),
      { resolveAssetUrl: () => null },
    );

    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('Missing banner');
    expect(rendered.validation.warnings.some((issue) => issue.code === 'IMAGE_EMPTY')).toBe(true);
  });

  it('renders a video block as a clickable thumbnail, never as inline playback', () => {
    const rendered = renderEmail(
      document([
        block('video', {
          thumbnail: { mediaId: null, url: 'https://nibrexo.test/thumb.jpg', alt: 'Tour thumbnail' },
          videoUrl: 'https://nibrexo.test/watch/tour',
          title: 'Product tour',
        }),
      ]),
      { resolveAssetUrl: resolver },
    );

    expect(rendered.html).not.toMatch(/<video/i);
    expect(rendered.html).not.toMatch(/autoplay/i);
    expect(rendered.html).not.toMatch(/<iframe/i);
    expect(rendered.html).toContain('href="https://nibrexo.test/watch/tour"');
    expect(rendered.html).toContain('&#9654;');
    expect(rendered.validation.info.some((issue) => issue.code === 'VIDEO_LINK_ONLY')).toBe(true);
  });

  it('builds a plain-text alternative with links and the unsubscribe instruction', () => {
    const rendered = renderEmail(
      document(
        [
          block('button', { label: 'Start now', url: 'https://nibrexo.test/start' }),
          block('footer', {
            companyName: 'Nibrexo Ltd',
            unsubscribeUrl: 'https://nibrexo.test/unsubscribe?email={{contact.email}}',
          }),
        ],
        'Preheader text',
      ),
      { resolveAssetUrl: resolver },
    );

    expect(rendered.text).toContain('Start now — https://nibrexo.test/start');
    expect(rendered.text).toContain('Unsubscribe — https://nibrexo.test/unsubscribe?email={{contact.email}}');
    expect(rendered.text).not.toMatch(/<[a-z]/i);
    // The preheader is not repeated when it duplicates the subject.
    expect(rendered.text.match(/Preheader text/g)?.length ?? 0).toBe(1);
  });

  it('renders every block type into balanced markup', () => {
    const types: Array<Parameters<typeof createBlock>[0]> = [
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
    const design = document(
      types.map((type) => block(type, type === 'products' ? { items: [] } : {})),
    );
    const rendered = renderEmail(design, { resolveAssetUrl: resolver });

    expect(tagBalanceProblems(rendered.html)).toEqual([]);
    for (const created of design.blocks) {
      expect(rendered.html).toContain(`data-email-block="${created.id}"`);
    }
  });
});

describe('Email URL validation', () => {
  it('accepts http, https, mailto and tel', () => {
    for (const url of ['https://nibrexo.test/a?b=c', 'http://example.com', 'mailto:a@b.test', 'tel:+441234']) {
      expect(checkEmailUrl(url).ok).toBe(true);
    }
  });

  it('rejects script, data, vbscript, file and relative URLs', () => {
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox',
      'file:///etc/passwd',
      '/relative/path',
      'nibrexo.test',
      'https://nibrexo.test/<script>',
    ]) {
      const result = checkEmailUrl(url);
      expect(result.ok, url).toBe(false);
    }
  });

  it('defers URLs that still contain a template variable', () => {
    const result = checkEmailUrl('https://nibrexo.test/unsub?email={{contact.email}}');
    expect(result.ok).toBe(true);
    expect(result.url).toContain('{{contact.email}}');
  });
});

describe('Rich-text sanitisation', () => {
  it('keeps the allowed formatting subset', () => {
    const clean = sanitizeRichText('<p>Hello <strong>there</strong> <a href="https://nibrexo.test">link</a></p>');
    expect(clean).toContain('<strong>there</strong>');
    expect(clean).toContain('href="https://nibrexo.test"');
  });

  it('drops scripts, handlers, unknown tags and unsafe URLs', () => {
    const dirty = sanitizeRichText(
      '<p onclick="steal()">text<script>alert(1)</script><iframe src="x"></iframe><a href="javascript:alert(1)">bad</a></p>',
    );
    expect(dirty).not.toMatch(/<script/i);
    expect(dirty).not.toMatch(/<iframe/i);
    expect(dirty).not.toMatch(/onclick/i);
    expect(dirty).not.toMatch(/javascript:/i);
    expect(dirty).toContain('text');
  });

  it('escapes and flattens text for the plain-text alternative', () => {
    expect(textFromHtml('<p>a &amp; b</p>')).toContain('a & b');
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;');
    expect(escapeAttr('a"b')).toBe('a&quot;b');
  });
});

describe('Design validation report', () => {
  it('blocks a marketing email without an unsubscribe link', () => {
    const report = validateDesign(
      document([
        block('hero', { headline: 'Hi', cta: { label: 'Go', url: 'https://nibrexo.test' } }),
        block('footer', { companyName: 'Nibrexo', unsubscribeUrl: '' }),
      ]),
    );
    expect(report.ok).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'UNSUBSCRIBE_MISSING')).toBe(true);
  });

  it('blocks unsafe and empty call-to-action destinations', () => {
    const report = validateDesign(
      document([
        block('button', { label: 'Bad', url: 'javascript:alert(1)' }),
        block('footer', { companyName: 'Nibrexo', unsubscribeUrl: 'https://nibrexo.test/unsub' }),
      ]),
    );
    expect(report.ok).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'LINK_UNSAFE')).toBe(true);

    const empty = validateDesign(
      document([
        block('button', { label: 'Nowhere', url: '' }),
        block('footer', { companyName: 'Nibrexo', unsubscribeUrl: 'https://nibrexo.test/unsub' }),
      ]),
    );
    expect(empty.errors.some((issue) => issue.code === 'LINK_EMPTY')).toBe(true);
  });

  it('warns about missing images and alt text but still allows a test send', () => {
    const report = validateDesign(
      document([
        block('banner', { image: { mediaId: null, url: null, alt: '' } }),
        block('footer', { companyName: 'Nibrexo', unsubscribeUrl: 'https://nibrexo.test/unsub' }),
      ]),
    );
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(summarizeValidation(report)).toMatch(/warnings/i);
  });

  it('rejects an empty design', () => {
    const report = validateDesign(document([]));
    expect(report.ok).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'DESIGN_EMPTY')).toBe(true);
  });
});

describe('Untrusted design documents', () => {
  it('rejects a malformed document instead of rendering it', () => {
    expect(() =>
      renderEmailFromUnknown({ blocks: 'not-an-array' }, { resolveAssetUrl: resolver }),
    ).toThrow(/Invalid email design/i);
  });

  it('renders a plain JSON document by applying defaults', () => {
    const rendered = renderEmailFromUnknown(
      {
        blocks: [
          {
            id: 'b1',
            type: 'text',
            props: { heading: 'From JSON', html: '<p>Body</p>' },
          },
        ],
      },
      { resolveAssetUrl: resolver, subject: 'JSON subject' },
    );

    expect(rendered.subject).toBe('JSON subject');
    expect(rendered.html).toContain('From JSON');
    expect(tagBalanceProblems(rendered.html)).toEqual([]);
  });
});

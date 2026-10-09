/**
 * HTML escaping and rich-text sanitisation for the Email Studio.
 *
 * Nothing a user types is ever treated as markup. Plain fields are escaped
 * with `escapeHtml`. The one exception is the text block, which accepts a
 * deliberately small formatting subset so users can write lists, links and
 * emphasis — and that subset is re-serialised from a parsed token stream, so
 * unknown tags, attributes and event handlers cannot survive.
 */

const VOID_TAGS = new Set(['br']);

const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'a',
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'span',
  'blockquote',
]);

/** Tags whose *content* is dropped entirely (never kept as text). */
const DROP_CONTENT_TAGS = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed']);

const TAG_TOKEN = /<[^>]*>/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes a value for use inside a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, ' ');
}

/** Strips control characters that must never reach an email document. */
export function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

interface ParsedTag {
  closing: boolean;
  name: string;
  attrs: Array<{ name: string; value: string }>;
}

function parseTag(token: string): ParsedTag | null {
  const closing = /^<\//.test(token);
  const inner = token.replace(/^<\/?/, '').replace(/\/?>$/, '').trim();
  if (inner.length === 0) return null;
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(inner);
  if (!nameMatch) return null;
  const name = nameMatch[0].toLowerCase();
  const rest = inner.slice(nameMatch[0].length);
  const attrs: Array<{ name: string; value: string }> = [];
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(rest)) !== null) {
    const attrName = match[1];
    if (!attrName) continue;
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs.push({ name: attrName.toLowerCase(), value });
  }
  return { closing, name, attrs };
}

/** URL check for rich-text links (mirrors ./url.ts without a cycle). */
function safeUrlForRichText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(trimmed)) return trimmed;
  if (/[\u0000-\u001f\u007f<>"'`\\]/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const allowed = new Set(['http:', 'https:', 'mailto:', 'tel:']);
  return allowed.has(parsed.protocol) ? trimmed : null;
}

function allowedAttribute(tag: string, attr: string, value: string): string | null {
  // Only `href` on anchors survives, and only when it passes URL validation.
  if (tag === 'a' && attr === 'href') {
    const safe = safeUrlForRichText(value);
    return safe ? `href="${escapeAttr(safe)}"` : null;
  }
  return null;
}

/**
 * Sanitises the rich-text subset used by text blocks.
 * Unknown tags are dropped (their text content is preserved), disallowed
 * attributes are dropped, and unbalanced tags are closed at the end.
 */
export function sanitizeRichText(input: string): string {
  if (!input) return '';
  const source = cleanText(input);
  const tokens = source.match(/<[^>]*>|[^<]+/g);
  if (!tokens) return escapeHtml(source);

  const out: string[] = [];
  const stack: string[] = [];
  let dropDepth = 0;

  for (const token of tokens) {
    if (token.startsWith('<')) {
      const parsed = parseTag(token);
      if (!parsed) continue; // Malformed tag: drop the markup.

      if (DROP_CONTENT_TAGS.has(parsed.name)) {
        if (parsed.closing) {
          if (dropDepth > 0) dropDepth -= 1;
        } else if (!VOID_TAGS.has(parsed.name)) {
          dropDepth += 1;
        }
        continue;
      }
      if (dropDepth > 0) continue;
      if (!ALLOWED_TAGS.has(parsed.name)) continue; // Drop tag, keep inner text.

      if (parsed.closing) {
        const index = stack.lastIndexOf(parsed.name);
        if (index >= 0) {
          for (let i = stack.length - 1; i > index; i -= 1) {
            out.push(`</${stack[i]}>`);
          }
          out.push(`</${parsed.name}>`);
          stack.length = index;
        }
        continue;
      }

      const attrs: string[] = [];
      for (const attr of parsed.attrs) {
        const rendered = allowedAttribute(parsed.name, attr.name, attr.value);
        if (rendered) attrs.push(rendered);
      }
      out.push(`<${parsed.name}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
      if (!VOID_TAGS.has(parsed.name)) stack.push(parsed.name);
      continue;
    }

    if (dropDepth > 0) continue;
    out.push(escapeHtml(token));
  }

  while (stack.length > 0) {
    out.push(`</${stack.pop()}>`);
  }
  return out.join('');
}

/** Plain-text projection of sanitised rich text (used for text alternatives). */
export function textFromHtml(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|h4|li|ul|ol|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  const withoutTags = withBreaks.replace(TAG_TOKEN, '');
  const decoded = withoutTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/\n{3,}/g, '\n\n').trim();
}

/** True when the string contains any markup at all. */
export function containsMarkup(value: string): boolean {
  return TAG_TOKEN.test(value);
}

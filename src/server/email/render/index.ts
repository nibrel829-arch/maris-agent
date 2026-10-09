/**
 * Email Studio — render pipeline.
 *
 *   normalise -> substitute {{variables}} -> resolve Content Library assets
 *             -> build HTML -> build plain text -> validate
 *
 * The browser canvas and the delivered email call the same pipeline, so the
 * preview is the artefact, not an approximation of it. The only difference is
 * the asset resolver: in the studio it points at the same signed asset route
 * the recipient's client will request.
 */

import type { EmailDesignDocument, RenderedEmail } from '@/types/email-design';
import { escapeHtml } from './sanitize';
import { renderEmailHtml } from './render-html';
import { renderEmailText } from './render-text';
import { emailDesignDocumentSchema, parseDesignDocument } from './schema';
import { validateDesign } from './validate';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface RenderEmailOptions {
  /** Values for {{variables}} used anywhere in the design. */
  variables?: Record<string, string>;
  /** Resolves a Content Library media id into an absolute URL. */
  resolveAssetUrl: (mediaId: string) => string | null;
  /** Subject override (already validated). Defaults to the design preheader-free subject. */
  subject?: string;
}

/** Deep-substitutes {{variables}} in every string of the design document. */
export function substituteVariables(
  design: EmailDesignDocument,
  values: Record<string, string>,
): { design: EmailDesignDocument; unresolved: string[] } {
  const unresolved = new Set<string>();

  const walk = (value: unknown, escapeValues: boolean): unknown => {
    if (typeof value === 'string') {
      return value.replace(PLACEHOLDER, (whole, key: string) => {
        if (key in values) {
          const replacement = values[key] ?? '';
          // The rich-text field is the only place markup is accepted, so a
          // substituted value must be escaped there.
          return escapeValues ? escapeHtml(replacement) : replacement;
        }
        unresolved.add(key);
        return whole;
      });
    }
    if (Array.isArray(value)) return value.map((entry) => walk(entry, escapeValues));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        out[key] = walk(nested, escapeValues || key === 'html');
      }
      return out;
    }
    return value;
  };

  const next = walk(design, false) as EmailDesignDocument;
  return { design: next, unresolved: [...unresolved].sort() };
}

/** Normalises unknown JSON into a design document, applying every default. */
export function normaliseDesign(value: unknown): EmailDesignDocument {
  const parsed = emailDesignDocumentSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Invalid email design: ${first?.path.join('.') ?? 'document'} ${first?.message ?? ''}`.trim());
  }
  return parsed.data as unknown as EmailDesignDocument;
}

/** Renders a design into HTML, plain text and a validation report. */
export function renderEmail(design: EmailDesignDocument, options: RenderEmailOptions): RenderedEmail {
  const normalised = normaliseDesign(design);
  const variables = options.variables ?? {};
  const { design: substituted, unresolved } = substituteVariables(normalised, variables);

  const subject = (options.subject ?? substituted.settings.preheader ?? '').trim();
  const html = renderEmailHtml(substituted, {
    subject: subject || 'Email from Nibrexo',
    preheader: substituted.settings.preheader,
    resolveAssetUrl: options.resolveAssetUrl,
  });
  const text = renderEmailText(substituted, subject, substituted.settings.preheader);
  const validation = validateDesign(substituted);

  return {
    subject,
    html,
    text,
    preheader: substituted.settings.preheader,
    unresolvedVariables: unresolved,
    validation,
  };
}

/** Renders a design from unknown JSON (used by the Manager and API routes). */
export function renderEmailFromUnknown(value: unknown, options: RenderEmailOptions): RenderedEmail {
  const parsed = parseDesignDocument(value);
  if (!parsed.ok || !parsed.document) {
    throw new Error(`Invalid email design: ${parsed.errors.join('; ')}`);
  }
  return renderEmail(parsed.document, options);
}

export { renderEmailHtml } from './render-html';
export { renderEmailText, renderEmailText as renderTextAlternative } from './render-text';
export { validateDesign, summarizeValidation } from './validate';
export { sanitizeRichText, escapeHtml, escapeAttr, textFromHtml } from './sanitize';
export { checkEmailUrl, safeEmailUrl, isValidEmailUrl, absoluteUrl } from './url';
export {
  BLOCK_TYPE_DESCRIPTIONS,
  BLOCK_TYPE_LABELS,
  emailBlockSchema,
  emailBrandProfileSchema,
  emailDesignDocumentSchema,
  parseBrandProfile,
  parseDesignDocument,
} from './schema';

/**
 * Email templates & sending validation (Phase 10).
 *
 * One Zod source of truth shared by API routes and the service layer.
 * The browser never supplies organization_id, created_by or id.
 */

import { z } from 'zod';

export const TEMPLATE_VARIABLE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const SINGLE_VARIABLE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/;
const VARIABLE_NAME = /^[a-zA-Z][a-zA-Z0-9_.]*$/;

// Detect any {{ ... }} block — well-formed or malformed — to reject partials.
const ANY_PLACEHOLDER = /\{\{[^}]*\}?\}?/g;

export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VARIABLE)].map((m) => m[1] ?? ''))].filter(Boolean);
}

/**
 * Returns an error message when the text contains malformed placeholders,
 * otherwise null. A well-formed placeholder is exactly {{ varName }} where
 * varName matches VARIABLE_NAME. Everything else with {{ is rejected so the
 * service never silently keeps an unresolved fragment.
 */
export function malformedPlaceholderError(text: string): string | null {
  const all = [...text.matchAll(ANY_PLACEHOLDER)].map((m) => m[0]);
  if (all.length === 0) return null;
  const good = new Set([...text.matchAll(TEMPLATE_VARIABLE)].map((m) => m[0]));
  for (const token of all) {
    if (!good.has(token)) {
      // Empty {{}} or with invalid chars, Unclosed {{foo, etc.
      const inner = token.replace(/^\{\{\s*|\s*\}\}?$/g, '');
      if (inner.length === 0) return 'Empty variable placeholder "{{}}" is not allowed.';
      if (!VARIABLE_NAME.test(inner.trim())) {
        return `Malformed variable placeholder ${JSON.stringify(token)} — use {{name}} or {{client.name}}.`;
      }
      // Any other structural mismatch (e.g. single closing brace)
      return `Malformed variable placeholder ${JSON.stringify(token)} — ensure it is {{variable}} with closing braces.`;
    }
    // Even good matches are checked for name validity (already captured group)
    const name = token.match(SINGLE_VARIABLE)?.[1] ?? '';
    if (!VARIABLE_NAME.test(name)) {
      return `Invalid variable name ${JSON.stringify(name)} — use letters, numbers, dots and underscores starting with a letter.`;
    }
  }
  return null;
}

export function variablesFromTemplate(subject: string, body: string): string[] {
  return [...new Set([...extractVariables(subject), ...extractVariables(body)])].sort();
}

export function renderTemplate(
  template: string,
  values: Record<string, string>,
): { rendered: string; unresolved: string[] } {
  const unresolved = new Set<string>();
  const rendered = template.replace(TEMPLATE_VARIABLE, (whole, key: string) => {
    if (key in values) return values[key] as string;
    unresolved.add(key);
    return whole;
  });
  return { rendered, unresolved: [...unresolved] };
}

// ---- Template schemas ----

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const emailTemplateStatus = z.enum(['draft', 'active', 'archived']);

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required.').max(100, 'Template name must be 100 characters or fewer.'),
  category: z.string().trim().min(1, 'Category is required.').max(80, 'Category must be 80 characters or fewer.'),
  subject: z.string().trim().min(1, 'Subject is required.').max(300, 'Subject must be 300 characters or fewer.'),
  body: z.string().trim().min(1, 'Body is required.').max(20000, 'Body must be 20000 characters or fewer.'),
  status: emailTemplateStatus.default('active').optional(),
});

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    subject: z.string().trim().min(1).max(300).optional(),
    body: z.string().trim().min(1).max(20000).optional(),
    status: emailTemplateStatus.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update.' });

export const templateListQuerySchema = z.object({
  search: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  category: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  status: z.preprocess(emptyToUndefined, emailTemplateStatus.optional()),
  archived: z.preprocess(
    (value) => {
      if (value === undefined || value === '') return undefined;
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0') return false;
      return value;
    },
    z.boolean().optional(),
  ),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type TemplateListQuery = z.infer<typeof templateListQuerySchema>;

// ---- Send schemas ----

export const emailAddressSchema = z.string().trim().email('A valid recipient email is required.').max(254);

export const sendEmailSchema = z.object({
  to: z.string().trim().email('A valid recipient email is required.').max(254),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  templateId: z.string().uuid().optional(),
  variables: z.record(z.string(), z.string()).default({}),
  clientId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
  replyTo: z.string().trim().email().max(254).optional(),
});

export const previewTemplateSchema = z.object({
  variables: z.record(z.string(), z.string()).default({}),
});

export const emailLogListQuerySchema = z.object({
  search: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  status: z.preprocess(emptyToUndefined, z.string().trim().max(20).optional()),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;
export type PreviewTemplateInput = z.infer<typeof previewTemplateSchema>;
export type EmailLogListQuery = z.infer<typeof emailLogListQuerySchema>;

/**
 * Client-side mirrors of server validation (src/server/email/validation.ts).
 * These give instant feedback; server remains authoritative.
 */

export interface TemplateFieldErrors {
  name?: string;
  category?: string;
  subject?: string;
  body?: string;
}

export interface ComposeFieldErrors {
  to?: string;
  subject?: string;
  body?: string;
  variables?: string;
}

// Pattern constants are inlined where used to keep validation logic auditable.

export function validateTemplateFields(fields: {
  name: string;
  category: string;
  subject: string;
  body: string;
}): TemplateFieldErrors {
  const errors: TemplateFieldErrors = {};

  if (fields.name.trim().length === 0) errors.name = 'Template name is required.';
  else if (fields.name.trim().length > 100) errors.name = 'Template name must be 100 characters or fewer.';

  if (fields.category.trim().length === 0) errors.category = 'Category is required.';
  else if (fields.category.trim().length > 80) errors.category = 'Category must be 80 characters or fewer.';

  if (fields.subject.trim().length === 0) errors.subject = 'Subject is required.';
  else if (fields.subject.trim().length > 300) errors.subject = 'Subject must be 300 characters or fewer.';
  else {
    const malformed = malformedPlaceholderMessage(fields.subject);
    if (malformed) errors.subject = malformed;
  }

  if (fields.body.trim().length === 0) errors.body = 'Body is required.';
  else if (fields.body.trim().length > 20000) errors.body = 'Body must be 20000 characters or fewer.';
  else {
    const malformed = malformedPlaceholderMessage(fields.body);
    if (malformed) errors.body = malformed;
  }

  return errors;
}

function malformedPlaceholderMessage(text: string): string | null {
  const all = [...text.matchAll(/\{\{[^}]*\}?\}?/g)].map((m) => m[0]);
  if (all.length === 0) return null;
  const good = new Set([...text.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[0]));
  for (const token of all) {
    if (!good.has(token)) {
      const inner = token.replace(/^\{\{\s*|\s*\}\}?$/g, '');
      if (inner.length === 0) return 'Empty variable "{{}}" is not allowed.';
      if (!/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(inner.trim())) {
        return `Malformed placeholder ${JSON.stringify(token)} — use {{variable}} or {{client.name}}.`;
      }
      return `Malformed placeholder ${JSON.stringify(token)} — ensure it is {{variable}} with closing braces.`;
    }
  }
  return null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateComposeFields(fields: {
  to: string;
  subject: string;
  body: string;
}): ComposeFieldErrors {
  const errors: ComposeFieldErrors = {};

  const to = fields.to.trim();
  if (to.length === 0) errors.to = 'Recipient email is required.';
  else if (to.length > 254) errors.to = 'Recipient email is too long.';
  else if (!EMAIL_PATTERN.test(to)) errors.to = 'Enter a valid email address.';

  if (fields.subject.trim().length === 0) errors.subject = 'Subject is required.';
  else if (fields.subject.trim().length > 300) errors.subject = 'Subject must be 300 characters or fewer.';

  if (fields.body.trim().length === 0) errors.body = 'Body is required.';
  else if (fields.body.trim().length > 20000) errors.body = 'Body must be 20000 characters or fewer.';

  return errors;
}

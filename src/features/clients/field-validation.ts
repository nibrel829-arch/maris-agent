/**
 * Client-side mirrors of the server validation messages (validation.ts).
 * These give instant field feedback; the server remains authoritative and
 * re-validates every submission.
 */

export interface ClientFieldErrors {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  notes?: string;
  tags?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+\d][\d\s\-().]*$/;

export function validateClientFields(fields: {
  name: string;
  company: string;
  email: string;
  phone: string;
  notes: string;
  tags: string;
}): ClientFieldErrors {
  const errors: ClientFieldErrors = {};

  if (fields.name.trim().length === 0) errors.name = 'Client name is required.';
  else if (fields.name.trim().length > 200) errors.name = 'Client name must be 200 characters or fewer.';

  if (fields.company.trim().length > 200) errors.company = 'Company must be 200 characters or fewer.';

  const email = fields.email.trim();
  if (email.length > 0) {
    if (email.length > 320) errors.email = 'Email address is too long.';
    else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';
  }

  const phone = fields.phone.trim();
  if (phone.length > 0) {
    if (phone.length > 50) errors.phone = 'Phone number must be 50 characters or fewer.';
    else if (!PHONE_PATTERN.test(phone) || phone.replace(/\D/g, '').length < 5) {
      errors.phone = 'Enter a valid phone number.';
    }
  }

  if (fields.notes.length > 5000) errors.notes = 'Notes must be 5000 characters or fewer.';

  const tags = fields.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  if (tags.length > 25) errors.tags = 'A client can have at most 25 tags.';
  else if (tags.some((tag) => tag.length > 50)) errors.tags = 'Tags must be 50 characters or fewer.';

  return errors;
}

export function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

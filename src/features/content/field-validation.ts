/**
 * Client-side mirrors of the server validation messages (validation.ts).
 * Instant field feedback; the server remains authoritative.
 */

export interface ContentFieldErrors {
  title?: string;
  caption?: string;
  body?: string;
  mediaUrl?: string;
}

const MEDIA_URL_PATTERN = /^(\/|https?:\/\/)/i;

export function validateContentFields(fields: {
  title: string;
  caption: string;
  body: string;
  mediaUrl: string;
}): ContentFieldErrors {
  const errors: ContentFieldErrors = {};

  if (fields.title.trim().length === 0) errors.title = 'A title is required.';
  else if (fields.title.trim().length > 200) errors.title = 'Title must be 200 characters or fewer.';

  if (fields.caption.length > 5000) errors.caption = 'Caption must be 5000 characters or fewer.';
  if (fields.body.length > 20000) errors.body = 'Body must be 20000 characters or fewer.';

  const mediaUrl = fields.mediaUrl.trim();
  if (mediaUrl.length > 0) {
    if (mediaUrl.length > 1000) errors.mediaUrl = 'Media URL must be 1000 characters or fewer.';
    else if (!MEDIA_URL_PATTERN.test(mediaUrl)) {
      errors.mediaUrl = 'Media URL must be a site path or an http(s) URL.';
    }
  }

  return errors;
}

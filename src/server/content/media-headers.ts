/**
 * Response headers for Content Library bytes served to a browser or a mail
 * client (Phase 17 security hardening).
 *
 * The Content Library accepts `image/svg+xml`. An SVG served inline from the
 * application origin can execute script in that origin, so every byte response
 * is sandboxed: a document loaded directly from the URL gets an opaque origin
 * and no script runs, and the content security policy blocks all subresources.
 * Images in `<img>` tags are unaffected.
 */
export const MEDIA_RESPONSE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

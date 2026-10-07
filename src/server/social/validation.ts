/**
 * Social connection validation (Phase 7).
 *
 * Zod schemas for the OAuth routes. Provider quirks live here as bounds, not
 * branches: authorization codes are opaque and length-capped, `state` echoes
 * the random value we issued, and provider error parameters are accepted so
 * the callback can report user-denied cancellations honestly.
 */

import { z } from 'zod';

export const SOCIAL_PLATFORMS = [
  'tiktok',
  'youtube',
  'pinterest',
  'linkedin',
  'instagram',
  'facebook',
  'contra',
] as const;

export const CONNECTABLE_PLATFORMS = [
  'tiktok',
  'youtube',
  'pinterest',
  'linkedin',
  'instagram',
  'facebook',
] as const;

export type ConnectablePlatform = (typeof CONNECTABLE_PLATFORMS)[number];

export const socialPlatformSchema = z.enum(SOCIAL_PLATFORMS, {
  errorMap: () => ({ message: 'Unknown social platform.' }),
});

export function isConnectablePlatform(value: unknown): value is ConnectablePlatform {
  return (
    typeof value === 'string' &&
    (CONNECTABLE_PLATFORMS as readonly string[]).includes(value)
  );
}

/** GET/POST /api/workspace/social/connect/[platform] — platform comes from the path. */
export const connectParamsSchema = z.object({
  platform: socialPlatformSchema,
});

/**
 * GET /api/workspace/social/callback/[platform]?code=&state=[&error=…].
 * Unknown query parameters are ignored: providers append their own extras.
 */
export const callbackQuerySchema = z
  .object({
    code: z.string().min(1, 'Missing authorization code.').max(4096).optional(),
    state: z.string().min(16, 'Invalid state.').max(256).optional(),
    error: z.string().max(200).optional(),
    error_reason: z.string().max(200).optional(),
    error_description: z.string().max(500).optional(),
  })
  .passthrough();

export type CallbackQuery = z.infer<typeof callbackQuerySchema>;

/** POST /api/workspace/social/facebook/select — picks one Page after OAuth. */
export const selectPageSchema = z.object({
  state: z.string().min(16, 'Invalid state.').max(256),
  page_id: z.string().min(1, 'Choose a Page.').max(128),
});

export type SelectPageInput = z.infer<typeof selectPageSchema>;

export const accountIdSchema = z.string().uuid('Unknown account.');

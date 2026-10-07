import { describe, expect, it } from 'vitest';
import {
  accountIdSchema,
  callbackQuerySchema,
  connectParamsSchema,
  isConnectablePlatform,
  selectPageSchema,
  socialPlatformSchema,
} from '@/server/social/validation';

describe('Social validation', () => {
  it('accepts all seven platforms but only six connect', () => {
    for (const platform of [
      'tiktok',
      'youtube',
      'pinterest',
      'linkedin',
      'instagram',
      'facebook',
      'contra',
    ]) {
      expect(socialPlatformSchema.safeParse(platform).success).toBe(true);
    }
    expect(socialPlatformSchema.safeParse('myspace').success).toBe(false);
    expect(connectParamsSchema.safeParse({ platform: 'tiktok' }).success).toBe(true);

    expect(isConnectablePlatform('tiktok')).toBe(true);
    expect(isConnectablePlatform('facebook')).toBe(true);
    expect(isConnectablePlatform('contra')).toBe(false);
    expect(isConnectablePlatform('myspace')).toBe(false);
  });

  it('accepts provider callbacks and ignores provider extras', () => {
    const parsed = callbackQuerySchema.parse({
      code: 'AUTH-CODE',
      state: 'a'.repeat(64),
      utm_source: 'ignored',
    });
    expect(parsed.code).toBe('AUTH-CODE');
    expect(parsed.state).toBe('a'.repeat(64));
  });

  it('accepts provider cancellations for honest reporting', () => {
    const parsed = callbackQuerySchema.parse({
      state: 'b'.repeat(64),
      error: 'access_denied',
      error_reason: 'user_denied',
      error_description: 'The user denied your request',
    });
    expect(parsed.error).toBe('access_denied');
  });

  it('bounds callback fields', () => {
    expect(callbackQuerySchema.safeParse({ code: '', state: 'c'.repeat(64) }).success).toBe(false);
    expect(callbackQuerySchema.safeParse({ code: 'x', state: 'short' }).success).toBe(false);
    expect(
      callbackQuerySchema.safeParse({ code: 'x'.repeat(5000), state: 'c'.repeat(64) }).success,
    ).toBe(false);
  });

  it('validates the Facebook Page selection', () => {
    expect(selectPageSchema.safeParse({ state: 'd'.repeat(64), page_id: '123' }).success).toBe(true);
    expect(selectPageSchema.safeParse({ state: 'short', page_id: '123' }).success).toBe(false);
    expect(selectPageSchema.safeParse({ state: 'd'.repeat(64), page_id: '' }).success).toBe(false);
  });

  it('validates account ids', () => {
    expect(accountIdSchema.safeParse('nope').success).toBe(false);
    expect(accountIdSchema.safeParse('00000000-0000-0000-0000-000000000001').success).toBe(true);
  });
});

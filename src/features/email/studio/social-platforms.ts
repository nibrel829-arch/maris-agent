import { EMAIL_SOCIAL_PLATFORMS } from '@/types/email-design';

/** Client-safe list of supported social platforms (label + value). */
export function emailSocialPlatformList(): string[] {
  return [...EMAIL_SOCIAL_PLATFORMS];
}

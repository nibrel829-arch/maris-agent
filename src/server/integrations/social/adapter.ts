/**
 * Social platform adapter layer (PDF #09 §7 Adapter Pattern).
 *
 * CRITICAL RULE (PDF #09 §19): do not assume all platforms expose the same API
 * capabilities. Where an operation is not implemented against a verified
 * official API, the adapter reports `unsupported`. It never simulates,
 * scrapes or bypasses a platform.
 *
 * Each platform adapter must, before it can publish or read, provide:
 *  - verified OAuth configuration (client id/secret from environment),
 *  - verified scopes,
 *  - verified endpoint behaviour against current official documentation.
 * Until that verification is recorded, capabilities stay false and calls
 * return UNSUPPORTED.
 */

import type { SocialCapabilities, SocialPlatform } from '@/types/domain';

export type SocialOperation =
  | 'publish'
  | 'schedule'
  | 'readDm'
  | 'sendDm'
  | 'readComments'
  | 'replyComments'
  | 'analytics';

export interface PublishRequest {
  organizationId: string;
  accountId: string;
  contentId: string;
  platform: SocialPlatform;
  caption: string;
  mediaUrl: string | null;
  idempotencyKey: string;
}

export type SocialOutcome =
  | { status: 'published'; externalPostId: string; platform: SocialPlatform }
  | { status: 'scheduled'; externalJobId: string; platform: SocialPlatform; scheduledFor: string }
  | { status: 'unsupported'; operation: SocialOperation; platform: SocialPlatform; reason: string }
  | { status: 'not_configured'; platform: SocialPlatform; reason: string }
  | { status: 'failed'; platform: SocialPlatform; reason: string; retryable: boolean };

export interface SocialAdapter {
  readonly platform: SocialPlatform;
  capabilities(): SocialCapabilities;
  isConfigured(): boolean;
  publish(request: PublishRequest): Promise<SocialOutcome>;
  schedule(request: PublishRequest & { scheduledFor: string }): Promise<SocialOutcome>;
}

const ALL_FALSE: SocialCapabilities = {
  publish: false,
  schedule: false,
  readDm: false,
  sendDm: false,
  readComments: false,
  replyComments: false,
  analytics: false,
};

/**
 * Placeholder adapter for platforms whose official API integration has not yet
 * been verified in this codebase. It reports `unsupported` rather than
 * emulating a result.
 */
class UnverifiedAdapter implements SocialAdapter {
  constructor(readonly platform: SocialPlatform) {}

  capabilities(): SocialCapabilities {
    return { ...ALL_FALSE };
  }

  isConfigured(): boolean {
    return false;
  }

  async publish(request: PublishRequest): Promise<SocialOutcome> {
    return {
      status: 'unsupported',
      operation: 'publish',
      platform: request.platform,
      reason: `Publishing for ${request.platform} is not implemented. It requires verified OAuth credentials, scopes and endpoint behaviour from the current official ${request.platform} API documentation before it can be enabled.`,
    };
  }

  async schedule(request: PublishRequest & { scheduledFor: string }): Promise<SocialOutcome> {
    return {
      status: 'unsupported',
      operation: 'schedule',
      platform: request.platform,
      reason: `Scheduling for ${request.platform} is not implemented. It requires verified official API support for future publishing.`,
    };
  }
}

const ADAPTERS: Record<SocialPlatform, SocialAdapter> = {
  tiktok: new UnverifiedAdapter('tiktok'),
  youtube: new UnverifiedAdapter('youtube'),
  pinterest: new UnverifiedAdapter('pinterest'),
  linkedin: new UnverifiedAdapter('linkedin'),
  instagram: new UnverifiedAdapter('instagram'),
  facebook: new UnverifiedAdapter('facebook'),
  contra: new UnverifiedAdapter('contra'),
};

export function getSocialAdapter(platform: SocialPlatform): SocialAdapter {
  return ADAPTERS[platform];
}

export function listAdapters(): Array<{
  platform: SocialPlatform;
  configured: boolean;
  capabilities: SocialCapabilities;
}> {
  return Object.values(ADAPTERS).map((adapter) => ({
    platform: adapter.platform,
    configured: adapter.isConfigured(),
    capabilities: adapter.capabilities(),
  }));
}

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return (
    typeof value === 'string' &&
    ['tiktok', 'youtube', 'pinterest', 'linkedin', 'instagram', 'facebook', 'contra'].includes(
      value,
    )
  );
}

export const PLATFORM_CAPABILITY_RULE =
  'Capabilities are reported per platform from the official API only. Unsupported operations are marked unsupported, never simulated (PDF #09 §19).';

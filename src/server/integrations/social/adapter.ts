/**
 * Social platform adapter layer (PDF #09 §7 Adapter Pattern).
 *
 * CRITICAL RULE (PDF #09 §19): do not assume all platforms expose the same API
 * capabilities. Where an operation is not implemented against a verified
 * official API, the adapter reports `unsupported`. It never simulates,
 * scrapes or bypasses a platform.
 *
 * Phase 8 wires this layer to the real publishing pipeline: capabilities
 * come from the verified publisher matrix, and publish/schedule delegate to
 * the publish service (jobs, executor, verification, audit). Execution needs
 * a configured environment (repository, actor, storage); without one the
 * adapter reports `not_configured` instead of inventing a result.
 */

import type { MediaStorage } from '@/server/content/storage';
import type { NibrexoRepository } from '@/server/db/types';
import type { ActorContext, SocialCapabilities, SocialPlatform } from '@/types/domain';
import {
  capabilitiesFor,
  getPublisher,
  PUBLISHING_SUPPORT,
} from './publishers';
import type { TokenKeyring } from '@/server/social/crypto';
import type { ProviderHttp } from '@/server/social/providers';
import { isProviderConfigured } from '@/server/social/providers';
import { isConnectablePlatform } from '@/server/social/validation';
import { createPublishJobs } from '@/server/social/publish/service';

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
  | { status: 'processing'; platform: SocialPlatform; jobId: string; note: string }
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

/** Execution environment for publish/schedule delegation. */
export interface SocialAdapterEnv {
  repo: NibrexoRepository;
  actor: ActorContext;
  storage: MediaStorage;
  http?: ProviderHttp;
  keyring?: TokenKeyring;
}

let activeEnv: SocialAdapterEnv | null = null;

/**
 * Configures (or clears, with null) the execution environment. Callers with
 * a request/tool context configure before publishing; tests configure
 * scripted doubles. Unconfigured publish calls report `not_configured`.
 */
export function configureSocialAdapters(env: SocialAdapterEnv | null): void {
  activeEnv = env;
}

function unsupported(
  operation: SocialOperation,
  platform: SocialPlatform,
): Extract<SocialOutcome, { status: 'unsupported' }> {
  const entry = PUBLISHING_SUPPORT[platform];
  const reason =
    entry.unsupported.length > 0
      ? `${entry.label}: ${entry.unsupported.join(' ')}`
      : `Publishing for ${platform} is not implemented. It requires verified OAuth credentials, scopes and endpoint behaviour from the current official ${platform} API documentation before it can be enabled.`;
  return { status: 'unsupported', operation, platform, reason };
}

class PublishingAdapter implements SocialAdapter {
  constructor(readonly platform: SocialPlatform) {}

  capabilities(): SocialCapabilities {
    return capabilitiesFor(this.platform);
  }

  isConfigured(): boolean {
    return isConnectablePlatform(this.platform) && isProviderConfigured(this.platform);
  }

  async publish(request: PublishRequest): Promise<SocialOutcome> {
    return runThroughPipeline('publish', request, null);
  }

  async schedule(request: PublishRequest & { scheduledFor: string }): Promise<SocialOutcome> {
    return runThroughPipeline('schedule', request, request.scheduledFor);
  }
}

async function runThroughPipeline(
  operation: 'publish' | 'schedule',
  request: PublishRequest,
  scheduledFor: string | null,
): Promise<SocialOutcome> {
  const env = activeEnv;
  const platform = request.platform;
  if (!env) {
    return {
      status: 'not_configured',
      platform,
      reason: 'Publishing execution is not configured on the server.',
    };
  }
  if (!getPublisher(platform)) {
    return unsupported(operation, platform);
  }
  const account = await env.repo.socialAccounts.get(request.accountId, request.organizationId);
  if (!account || account.platform !== platform) {
    return {
      status: 'failed',
      platform,
      reason: 'Social account not found or not in this organization.',
      retryable: false,
    };
  }

  const created = await createPublishJobs(
    env.actor,
    env.repo,
    env.storage,
    {
      contentId: request.contentId,
      targets: [{ accountId: request.accountId, options: {} }],
      ...(scheduledFor ? { runAt: scheduledFor } : {}),
      timezone: 'UTC',
      idempotencyKey: request.idempotencyKey,
    },
    { http: env.http, keyring: env.keyring },
  );
  if (!created.ok) {
    return {
      status: 'failed',
      platform,
      reason: created.error.message,
      retryable: created.error.retryable ?? false,
    };
  }
  const job = created.data.jobs[0]?.job;
  if (!job) {
    return { status: 'failed', platform, reason: 'Publish job was not created.', retryable: false };
  }
  switch (job.status) {
    case 'published':
      return { status: 'published', externalPostId: job.provider_ref ?? job.id, platform };
    case 'scheduled':
    case 'queued':
      return { status: 'scheduled', externalJobId: job.id, platform, scheduledFor: job.run_at };
    case 'publishing':
    case 'verifying':
      return {
        status: 'processing',
        platform,
        jobId: job.id,
        note: 'The provider is processing the post; its status advances automatically.',
      };
    default:
      return {
        status: 'failed',
        platform,
        reason: job.last_error ?? `Publish ${job.status}.`,
        retryable: job.provider_payload.retryable === true,
      };
  }
}

const ADAPTERS: Record<SocialPlatform, SocialAdapter> = {
  tiktok: new PublishingAdapter('tiktok'),
  youtube: new PublishingAdapter('youtube'),
  pinterest: new PublishingAdapter('pinterest'),
  linkedin: new PublishingAdapter('linkedin'),
  instagram: new PublishingAdapter('instagram'),
  facebook: new PublishingAdapter('facebook'),
  contra: new PublishingAdapter('contra'),
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

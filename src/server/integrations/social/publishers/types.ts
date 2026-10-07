/**
 * Publisher step types (Phase 8).
 *
 * Every platform publisher is a stepwise state machine, not a one-shot call:
 * one `executeStep` performs ONE bounded provider interaction (a submit, a
 * status poll, a read-back) and either reaches a terminal result or asks to
 * be continued later. The job executor persists the returned state between
 * steps, which keeps each serverless invocation short and every async
 * provider (TikTok processing, Instagram containers, Pinterest video)
 * resumable across sweeps.
 *
 * Terminal honesty: `published` is returned ONLY with provider evidence —
 * either a read-back of the created object (`read_back`) or a durable
 * provider reference where the official API offers no read-back under our
 * scopes (`provider_reference`, LinkedIn member posts). Anything ambiguous
 * is `failed` or stays polling; poll-budget exhaustion becomes `unknown`,
 * never `published`.
 */

import type {
  PublishProviderState,
  PublishVerification,
  SocialPlatform,
} from '@/types/domain';
import type { ProviderHttp } from '@/server/social/providers';

/** Media resolved by the executor for one publish step. */
export interface PublishMediaInput {
  kind: 'image' | 'video';
  mime: string;
  sizeBytes: number;
  filename: string;
  /** Raw bytes for byte-capable providers (YouTube, TikTok video, ...). */
  bytes: Uint8Array | null;
  /**
   * Short-lived public URL for URL-only providers (Instagram, Facebook
   * media, TikTok photos). Null on the memory backend, where no public URL
   * exists — URL-only operations report `unsupported` there.
   */
  publicUrl: string | null;
}

/** Pure pre-flight input: text, media facts and target options. No network. */
export interface PublishSupportInput {
  title: string;
  text: string;
  linkUrl: string | null;
  media: { kind: 'image' | 'video'; mime: string; sizeBytes: number } | null;
  coverPublicUrl: string | null;
  options: Record<string, string | boolean>;
  /** Requested go-live time (ISO). Equals ~now for immediate publishes. */
  runAt: string;
  scheduled: boolean;
  now: Date;
}

export type PublishSupport =
  | { ok: true }
  | { ok: false; reason: string };

export interface PublishStepContext {
  platform: SocialPlatform;
  /** Provider-side account id (Page id, IG id, person sub, ...). */
  accountExternalId: string;
  /** Decrypted access token. Memory-only; never persisted or logged. */
  accessToken: string;
  title: string;
  text: string;
  linkUrl: string | null;
  media: PublishMediaInput | null;
  /** Public cover-image URL for Pinterest video Pins (required by Pinterest). */
  coverPublicUrl: string | null;
  options: Record<string, string | boolean>;
  runAt: string;
  /** True when submitting now for a provider-native future go-live. */
  scheduled: boolean;
  state: PublishProviderState;
  http: ProviderHttp;
  now: Date;
}

export type PublishStepOutcome =
  | {
      done: true;
      result: 'published';
      verification: PublishVerification;
      /** Durable provider post id (video id, pin id, post URN, media id...). */
      postId: string;
      providerRef: string;
      note?: string;
    }
  | {
      done: true;
      result: 'scheduled_provider';
      providerRef: string;
      postId?: string;
      /** When the sweeper should verify the provider went live (ISO). */
      verifyAfter: string;
      note?: string;
    }
  | { done: true; result: 'failed'; reason: string; retryable: boolean; reauth?: boolean }
  | { done: true; result: 'unknown'; reason: string }
  | { done: true; result: 'unsupported'; reason: string }
  | {
      done: false;
      /** Seconds before the next poll step. 0 = continue immediately. */
      pollAfterSeconds: number;
      state: PublishProviderState;
      note?: string;
    };

/**
 * How a publisher consumes media: raw bytes (byte upload), a public URL the
 * provider fetches, or none (text-only). The executor resolves exactly what
 * the strategy needs and reports a clear unsupported reason otherwise.
 */
export type MediaStrategy = 'bytes' | 'public-url' | 'none';

export interface PublisherAdapter {
  readonly platform: SocialPlatform;
  readonly label: string;
  /** Pure capability pre-flight. Must not touch the network. */
  checkSupport(input: PublishSupportInput): PublishSupport;
  mediaStrategy(kind: 'image' | 'video' | null): MediaStrategy;
  /** One bounded provider interaction. */
  executeStep(ctx: PublishStepContext): Promise<PublishStepOutcome>;
  /**
   * Best-effort provider-side cancel of a provider-native schedule.
   * Absent = the provider offers no verified cancel; the job cancels locally.
   */
  cancelRemote?(ctx: PublishStepContext): Promise<{ cancelled: boolean; reason: string }>;
}

/* Step constructors -------------------------------------------------------- */

export function stepPublished(
  verification: PublishVerification,
  postId: string,
  providerRef?: string,
  note?: string,
): PublishStepOutcome {
  return { done: true, result: 'published', verification, postId, providerRef: providerRef ?? postId, note };
}

export function stepFailed(reason: string, retryable = false, reauth = false): PublishStepOutcome {
  return { done: true, result: 'failed', reason, retryable, reauth };
}

export function stepUnknown(reason: string): PublishStepOutcome {
  return { done: true, result: 'unknown', reason };
}

export function stepUnsupported(reason: string): PublishStepOutcome {
  return { done: true, result: 'unsupported', reason };
}

export function stepContinue(
  state: PublishProviderState,
  pollAfterSeconds: number,
  note?: string,
): PublishStepOutcome {
  return { done: false, pollAfterSeconds, state, note };
}

export function stepScheduledProvider(
  providerRef: string,
  verifyAfter: string,
  postId?: string,
  note?: string,
): PublishStepOutcome {
  return { done: true, result: 'scheduled_provider', providerRef, verifyAfter, postId, note };
}

/**
 * Resume convention: when the executor records a `scheduled_provider`
 * outcome it persists `provider_payload.step = 'scheduled_verify'`, so the
 * adapter's late verification branch runs when the provider should be live.
 */
export const SCHEDULED_VERIFY_STEP = 'scheduled_verify';

/** Poll round counter shared by all async publishers. */
export function pollRound(state: PublishProviderState): number {
  return typeof state.pollRound === 'number' ? state.pollRound : 0;
}

export function optionString(
  options: Record<string, string | boolean>,
  key: string,
): string | null {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function optionBoolean(
  options: Record<string, string | boolean>,
  key: string,
  fallback: boolean,
): boolean {
  const value = options[key];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Builds a multipart/form-data body for providers that require it
 * (Pinterest S3 video upload). Returns the raw bytes plus the exact
 * Content-Type header value. No dependencies; boundary is random per call.
 */
export function buildMultipartForm(
  fields: Record<string, string>,
  file: { fieldName: string; filename: string; mime: string; bytes: Uint8Array },
): { body: Uint8Array; contentType: string } {
  const boundary = `----nibrexo-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const pushText = (text: string): void => {
    parts.push(encoder.encode(text));
  };
  for (const [name, value] of Object.entries(fields)) {
    pushText(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  const safeFilename = file.filename.replace(/["\r\n]/g, '_') || 'file';
  pushText(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${safeFilename}"\r\n` +
      `Content-Type: ${file.mime}\r\n\r\n`,
  );
  parts.push(file.bytes);
  pushText(`\r\n--${boundary}--\r\n`);
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

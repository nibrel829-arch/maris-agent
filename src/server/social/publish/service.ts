/**
 * Publishing service (Phase 8).
 *
 * Pipeline: CONTENT -> SELECT ACCOUNTS -> VALIDATE CAPABILITIES -> CREATE
 * JOB -> EXECUTE -> VERIFY -> UPDATE STATUS -> AUDIT.
 *
 * One job per (content x account) target. Immediate jobs execute inline
 * (bounded steps) and scheduled jobs wait for `run_at`; provider-native
 * schedules (YouTube public futures, Facebook 10min-30d futures) submit at
 * creation and park in `scheduled` until the provider goes live.
 *
 * Tenancy: every read/write is organization-scoped; cross-tenant ids resolve
 * to NOT_FOUND. Authorization: social.publish (+ content.view) for
 * create/retry/cancel, social.view for reads. Execution inherits the
 * creation-time grant (standard queue semantics); the sweeper additionally
 * requires CRON_SECRET at the route.
 *
 * Duplicate-publication protection (three layers):
 *  1. deterministic idempotency keys — retried submissions resolve to the
 *     existing row (unique constraint backstop);
 *  2. one active job per (content, account) — double-clicks attach instead
 *     of duplicating;
 *  3. single-flight scheduler claims (SKIP LOCKED + lock lease).
 */

import { createHash } from 'node:crypto';
import { checkPermission } from '@/server/auth/permissions';
import type { NibrexoRepository } from '@/server/db/types';
import type { MediaStorage } from '@/server/content/storage';
import { mediaKindFor } from '@/server/content/validation';
import {
  getPublisher,
  PUBLISHING_SUPPORT,
  SCHEDULED_VERIFY_STEP,
  type PublishMediaInput,
  type PublishStepContext,
  type PublisherAdapter,
} from '@/server/integrations/social/publishers';
import { writeAudit } from '@/server/manager/audit';
import { fail, ok, type ServiceResult } from '@/lib/result';
import type {
  ActorContext,
  ContentItem,
  MediaFile,
  PublishJob,
  PublishPayloadSnapshot,
  PublishProviderState,
  SocialAccount,
  UUID,
} from '@/types/domain';
import type { ManagerIssue } from '@/types/manager';
import { resolveTokenKeyring, type TokenKeyring } from '../crypto';
import {
  defaultProviderHttp,
  parseProviderJson,
  type ProviderHttp,
} from '../providers';
import { ensureFreshAccessToken } from '../service';
import {
  MAX_IMMEDIATE_STEPS,
  SWEEP_CLAIM_LIMIT,
  SWEEP_LOCK_SECONDS,
  type CreatePublishInput,
  type PublishListQuery,
  type PublishTargetInput,
  type ValidatePublishInput,
} from './validation';

export interface PublishDeps {
  keyring?: TokenKeyring;
  http?: ProviderHttp;
  now?: Date;
}

const ACTIVE_JOB_STATUSES: PublishJob['status'][] = ['queued', 'publishing', 'verifying', 'scheduled'];
const TERMINAL_JOB_STATUSES: PublishJob['status'][] = ['published', 'failed', 'unknown', 'cancelled'];
const NIL_USER = '00000000-0000-0000-0000-000000000000';

type PublishErrorClass = ManagerIssue['errorClass'];

function failCode(
  code: string,
  message: string,
  errorClass: PublishErrorClass,
  retryable = false,
): ServiceResult<never> {
  return fail(code, message, { errorClass, severity: 'error', retryable });
}

function publishDenied(actor: ActorContext, action: string): ServiceResult<never> {
  return failCode(
    'PUBLISH_PERMISSION_DENIED',
    checkPermission(actor, { module: 'social', action: action as 'publish' }).reason,
    'permission',
  );
}

/* -------------------------------------------------------------------------- */
/* Media resolution                                                            */
/* -------------------------------------------------------------------------- */

interface ResolvedMediaFacts {
  mediaId: UUID | null;
  kind: 'image' | 'video' | null;
  mime: string | null;
  sizeBytes: number | null;
  filename: string | null;
  storagePath: string | null;
  externalUrl: string | null;
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

function kindFromExtension(url: string): 'image' | 'video' | null {
  const clean = url.split('?')[0]?.split('#')[0] ?? '';
  const ext = clean.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

function mediaIdFromSitePath(value: string): UUID | null {
  const match = /\/api\/workspace\/content\/media\/([0-9a-f-]{36})\/file/i.exec(value);
  return match?.[1] ?? null;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolves which media a publish carries, without loading bytes. Precedence:
 * explicit mediaId (null = force none) -> content media_url (library path or
 * absolute URL) -> none. Audio/documents are refused: no publisher supports
 * them.
 */
async function resolveMediaFacts(
  repo: NibrexoRepository,
  organizationId: UUID,
  content: ContentItem,
  mediaId: UUID | null | undefined,
): Promise<ServiceResult<ResolvedMediaFacts>> {
  const none: ResolvedMediaFacts = {
    mediaId: null,
    kind: null,
    mime: null,
    sizeBytes: null,
    filename: null,
    storagePath: null,
    externalUrl: null,
  };
  if (mediaId === null) return ok(none);

  const loadRow = async (id: UUID): Promise<ServiceResult<MediaFile | null>> => {
    const row = await repo.mediaFiles.get(id, organizationId);
    return ok(row);
  };

  if (mediaId) {
    const rowResult = await loadRow(mediaId);
    const row = rowResult.ok ? rowResult.data : null;
    if (!row) return failCode('MEDIA_NOT_FOUND', 'Selected media was not found.', 'validation');
    return mediaFactsFromRow(row);
  }

  const contentUrl = content.media_url?.trim();
  if (!contentUrl) return ok(none);
  const pathId = mediaIdFromSitePath(contentUrl);
  if (pathId) {
    const rowResult = await loadRow(pathId);
    const row = rowResult.ok ? rowResult.data : null;
    if (!row) return failCode('MEDIA_NOT_FOUND', 'The content media file is gone; pick new media.', 'validation');
    return mediaFactsFromRow(row);
  }
  if (isAbsoluteHttpUrl(contentUrl)) {
    const kind = kindFromExtension(contentUrl);
    if (!kind) {
      return failCode(
        'PUBLISH_MEDIA_UNKNOWN',
        'Cannot determine the media type from the content URL; attach library media instead.',
        'validation',
      );
    }
    return ok({ ...none, kind, externalUrl: contentUrl });
  }
  return ok(none);
}

function mediaFactsFromRow(row: MediaFile): ServiceResult<ResolvedMediaFacts> {
  const kind = mediaKindFor(row.mime_type);
  if (kind !== 'image' && kind !== 'video') {
    return failCode(
      'PUBLISH_MEDIA_UNSUPPORTED',
      `Publishing supports images and videos; this file is ${row.mime_type}.`,
      'validation',
    );
  }
  return ok({
    mediaId: row.id,
    kind,
    mime: row.mime_type,
    sizeBytes: row.size_bytes,
    filename: row.storage_path.split('/').pop() ?? 'media',
    storagePath: row.storage_path,
    externalUrl: null,
  });
}

/* -------------------------------------------------------------------------- */
/* Pre-flight                                                                  */
/* -------------------------------------------------------------------------- */

export interface TargetValidation {
  accountId: UUID;
  platform: SocialAccount['platform'];
  accountName: string;
  accountStatus: SocialAccount['status'];
  ok: boolean;
  issues: string[];
  warnings: string[];
  /** True when a future runAt would submit natively now (vs Nibrexo hold). */
  nativeSchedule: boolean;
}

export interface PublishValidationResult {
  contentId: UUID;
  runAt: string;
  scheduled: boolean;
  targets: TargetValidation[];
}

function assembleText(content: ContentItem): string {
  return content.caption?.trim() || content.body?.trim() || '';
}

function linkFor(content: ContentItem, override: string | null | undefined): string | null {
  if (override !== undefined && override !== null) return override;
  const url = content.media_url?.trim();
  return url && isAbsoluteHttpUrl(url) ? url : null;
}

async function preflightTarget(
  repo: NibrexoRepository,
  storage: MediaStorage | null,
  organizationId: UUID,
  content: ContentItem,
  media: ResolvedMediaFacts,
  coverMediaId: UUID | null,
  linkUrl: string | null,
  target: PublishTargetInput,
  runAt: Date,
  scheduled: boolean,
  now: Date,
): Promise<TargetValidation> {
  const account = await repo.socialAccounts.get(target.accountId, organizationId);
  if (!account) {
    return {
      accountId: target.accountId,
      platform: 'contra',
      accountName: 'Unknown account',
      accountStatus: 'disconnected',
      ok: false,
      issues: ['Account not found in this organization.'],
      warnings: [],
      nativeSchedule: false,
    };
  }
  const issues: string[] = [];
  const warnings: string[] = [];
  const publisher = getPublisher(account.platform);
  if (!publisher) {
    issues.push(`${PUBLISHING_SUPPORT[account.platform]?.label ?? account.platform}: publishing is not supported (no public publishing API).`);
    return {
      accountId: account.id,
      platform: account.platform,
      accountName: account.name,
      accountStatus: account.status,
      ok: false,
      issues,
      warnings,
      nativeSchedule: false,
    };
  }
  if (account.status !== 'connected') {
    issues.push(`Account is ${account.status.replace('_', ' ')}; reconnect before publishing.`);
  }

  // Cover image facts for Pinterest video Pins.
  let coverPublicUrl: string | null = null;
  if (coverMediaId) {
    const cover = await repo.mediaFiles.get(coverMediaId, organizationId);
    const coverKind = cover ? mediaKindFor(cover.mime_type) : null;
    if (!cover || coverKind !== 'image') {
      issues.push('The Pin cover must be a library image.');
    } else if (storage?.backend !== 'supabase') {
      issues.push('Pinterest video covers need a public URL (Supabase backend).');
    } else {
      coverPublicUrl = 'signed-url-at-execution';
    }
  }

  const support = publisher.checkSupport({
    title: content.title,
    text: assembleText(content),
    linkUrl,
    media: media.kind ? { kind: media.kind, mime: media.mime ?? 'application/octet-stream', sizeBytes: media.sizeBytes ?? 0 } : null,
    coverPublicUrl,
    options: target.options,
    runAt: runAt.toISOString(),
    scheduled,
    now,
  });
  if (!support.ok) {
    const held = /held( Nibrexo-side| and )|hold/i.test(support.reason);
    if (scheduled && held) {
      warnings.push(support.reason);
    } else {
      issues.push(support.reason);
    }
  }

  // Environment: can this run resolve what the publisher consumes?
  const strategy = publisher.mediaStrategy(media.kind);
  const hasPublicUrl =
    !!media.externalUrl || (storage?.backend === 'supabase' && !!media.storagePath);
  if (strategy === 'public-url' && media.kind && !hasPublicUrl) {
    issues.push(
      `${publisher.label} fetches media from a public URL; attach an absolute media URL or use the Supabase backend.`,
    );
  }
  if (strategy === 'bytes' && media.externalUrl && !media.storagePath) {
    issues.push(`${publisher.label} uploads media bytes; attach library media instead of a URL.`);
  }

  const nativeSchedule =
    scheduled &&
    PUBLISHING_SUPPORT[account.platform].nativeSchedule &&
    publisher.checkSupport({
      title: content.title,
      text: assembleText(content),
      linkUrl,
      media: media.kind
        ? { kind: media.kind, mime: media.mime ?? 'application/octet-stream', sizeBytes: media.sizeBytes ?? 0 }
        : null,
      coverPublicUrl,
      options: target.options,
      runAt: runAt.toISOString(),
      scheduled: true,
      now,
    }).ok;

  return {
    accountId: account.id,
    platform: account.platform,
    accountName: account.name,
    accountStatus: account.status,
    ok: issues.length === 0,
    issues,
    warnings,
    nativeSchedule,
  };
}

export async function validatePublishTargets(
  actor: ActorContext,
  repo: NibrexoRepository,
  storage: MediaStorage | null,
  input: ValidatePublishInput,
  deps: PublishDeps = {},
): Promise<ServiceResult<PublishValidationResult>> {
  if (!checkPermission(actor, { module: 'social', action: 'view' }).allowed) {
    return publishDenied(actor, 'view');
  }
  const content = await repo.contentItems.get(input.contentId, actor.organizationId);
  if (!content) {
    return failCode('CONTENT_NOT_FOUND', 'Content item not found.', 'validation');
  }
  const mediaResult = await resolveMediaFacts(repo, actor.organizationId, content, input.mediaId);
  if (!mediaResult.ok) return mediaResult as ServiceResult<never>;
  const media = mediaResult.data;
  const linkUrl = linkFor(content, input.linkUrl);
  const now = deps.now ?? new Date();
  const runAt = input.runAt ? new Date(input.runAt) : now;
  const scheduled = runAt.getTime() > now.getTime() + 5000;

  const targets: TargetValidation[] = [];
  for (const target of input.targets) {
    targets.push(
      await preflightTarget(
        repo,
        storage,
        actor.organizationId,
        content,
        media,
        target.coverMediaId ?? null,
        linkUrl,
        target,
        runAt,
        scheduled,
        now,
      ),
    );
  }
  return ok({ contentId: content.id, runAt: runAt.toISOString(), scheduled, targets });
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreatedTarget {
  job: PublishJob;
  duplicate: boolean;
  nativeSchedule: boolean;
}

function stablePayloadHash(snapshot: PublishPayloadSnapshot): string {
  const sortedOptions = Object.fromEntries(
    Object.entries(snapshot.options).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: snapshot.title,
        caption: snapshot.caption,
        mediaId: snapshot.mediaId,
        mediaKind: snapshot.mediaKind,
        mediaMime: snapshot.mediaMime,
        mediaSizeBytes: snapshot.mediaSizeBytes,
        mediaExternalUrl: snapshot.mediaExternalUrl,
        coverMediaId: snapshot.coverMediaId,
        linkUrl: snapshot.linkUrl,
        options: sortedOptions,
      }),
    )
    .digest('hex');
}

function deriveIdempotencyKey(
  organizationId: UUID,
  contentId: UUID,
  accountId: UUID,
  runAtIso: string,
  snapshot: PublishPayloadSnapshot,
): string {
  return `auto_${createHash('sha256')
    .update([organizationId, contentId, accountId, runAtIso, stablePayloadHash(snapshot)].join('|'))
    .digest('hex')
    .slice(0, 40)}`;
}

async function activeJobFor(
  repo: NibrexoRepository,
  organizationId: UUID,
  contentId: UUID,
  accountId: UUID,
): Promise<PublishJob | null> {
  const rows = await repo.publishJobs.list(organizationId, { limit: 500 });
  return (
    rows.find(
      (row) =>
        row.content_id === contentId &&
        row.account_id === accountId &&
        ACTIVE_JOB_STATUSES.includes(row.status),
    ) ?? null
  );
}

export async function createPublishJobs(
  actor: ActorContext,
  repo: NibrexoRepository,
  storage: MediaStorage,
  input: CreatePublishInput,
  deps: PublishDeps = {},
): Promise<ServiceResult<{ runAt: string; scheduled: boolean; jobs: CreatedTarget[] }>> {
  if (!checkPermission(actor, { module: 'social', action: 'publish' }).allowed) {
    return publishDenied(actor, 'publish');
  }
  if (!checkPermission(actor, { module: 'content', action: 'view' }).allowed) {
    return publishDenied(actor, 'view');
  }
  const content = await repo.contentItems.get(input.contentId, actor.organizationId);
  if (!content) {
    return failCode('CONTENT_NOT_FOUND', 'Content item not found.', 'validation');
  }
  const mediaResult = await resolveMediaFacts(repo, actor.organizationId, content, input.mediaId);
  if (!mediaResult.ok) return mediaResult as ServiceResult<never>;
  const media = mediaResult.data;
  const linkUrl = linkFor(content, input.linkUrl);
  const now = deps.now ?? new Date();
  const runAt = input.runAt ? new Date(input.runAt) : now;
  if (!Number.isFinite(runAt.getTime())) {
    return failCode('INVALID_INPUT', 'Scheduled time is not a valid datetime.', 'validation');
  }
  const scheduled = runAt.getTime() > now.getTime() + 5000;

  // Pre-flight every target before writing anything: one bad target fails the
  // whole request, so a multi-account publish never half-creates.
  const validations: TargetValidation[] = [];
  for (const target of input.targets) {
    validations.push(
      await preflightTarget(
        repo,
        storage,
        actor.organizationId,
        content,
        media,
        target.coverMediaId ?? null,
        linkUrl,
        target,
        runAt,
        scheduled,
        now,
      ),
    );
  }
  const blocked = validations.filter((v) => !v.ok);
  if (blocked.length > 0) {
    const detail = blocked.map((v) => `${v.accountName}: ${v.issues.join(' ')}`).join(' | ');
    return failCode('PUBLISH_VALIDATION_FAILED', detail.slice(0, 600), 'validation');
  }

  const created: CreatedTarget[] = [];
  for (let index = 0; index < input.targets.length; index += 1) {
    const target = input.targets[index] as PublishTargetInput;
    const validation = validations[index] as TargetValidation;
    const snapshot: PublishPayloadSnapshot = {
      title: content.title,
      caption: assembleText(content),
      mediaId: media.mediaId,
      mediaKind: media.kind,
      mediaMime: media.mime,
      mediaSizeBytes: media.sizeBytes,
      mediaExternalUrl: media.externalUrl,
      coverMediaId: target.coverMediaId ?? null,
      linkUrl,
      options: { ...target.options },
    };
    const key = input.idempotencyKey
      ? `client_${actor.organizationId}_${input.idempotencyKey}_${target.accountId}`
      : deriveIdempotencyKey(actor.organizationId, content.id, target.accountId, runAt.toISOString(), snapshot);

    const existingByKey = await repo.publishJobs.findByIdempotencyKey(actor.organizationId, key);
    if (existingByKey) {
      created.push({ job: existingByKey, duplicate: true, nativeSchedule: false });
      continue;
    }
    const active = await activeJobFor(repo, actor.organizationId, content.id, target.accountId);
    if (active) {
      created.push({ job: active, duplicate: true, nativeSchedule: false });
      continue;
    }

    const job = await repo.publishJobs.insert({
      organization_id: actor.organizationId,
      content_id: content.id,
      account_id: target.accountId,
      platform: validation.platform,
      status: 'queued',
      verification: null,
      run_at: runAt.toISOString(),
      timezone: input.timezone,
      idempotency_key: key,
      attempts: 0,
      max_attempts: 8,
      provider_ref: null,
      provider_payload: {},
      payload: snapshot,
      last_error: null,
      next_poll_at: null,
      locked_at: null,
      created_by: actor.userId,
    });
    await writeAudit(repo, actor, {
      action: 'publish.job.created',
      entityType: 'publish_job',
      entityId: job.id,
      metadata: {
        platform: job.platform,
        contentId: content.id,
        accountId: target.accountId,
        scheduled,
        runAt: job.run_at,
      },
    });

    // Drive now when the job is due, or submit natively when the provider
    // holds the schedule. Nibrexo-held futures wait for the sweeper.
    let current = job;
    if (!scheduled || validation.nativeSchedule) {
      const driven = await driveJob(repo, storage, job, deps);
      if (driven) current = driven;
    }
    created.push({ job: current, duplicate: false, nativeSchedule: scheduled && validation.nativeSchedule });
  }

  const first = created[0]?.job;
  if (first) await syncContentStatus(repo, actor, first.content_id);
  return ok({ runAt: runAt.toISOString(), scheduled, jobs: created });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function getPublishJob(
  actor: ActorContext,
  repo: NibrexoRepository,
  jobId: UUID,
): Promise<ServiceResult<PublishJob>> {
  if (!checkPermission(actor, { module: 'social', action: 'view' }).allowed) {
    return publishDenied(actor, 'view');
  }
  const job = await repo.publishJobs.get(jobId, actor.organizationId);
  if (!job) return failCode('PUBLISH_NOT_FOUND', 'Publish job not found.', 'validation');
  return ok(job);
}

export async function listPublishJobs(
  actor: ActorContext,
  repo: NibrexoRepository,
  query: PublishListQuery,
): Promise<ServiceResult<{ jobs: PublishJob[]; total: number }>> {
  if (!checkPermission(actor, { module: 'social', action: 'view' }).allowed) {
    return publishDenied(actor, 'view');
  }
  const rows = await repo.publishJobs.list(actor.organizationId, { limit: 500 });
  const filtered = rows
    .filter((row) => {
      if (query.contentId && row.content_id !== query.contentId) return false;
      if (query.accountId && row.account_id !== query.accountId) return false;
      if (query.status && row.status !== query.status) return false;
      return true;
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return ok({
    jobs: filtered.slice(query.offset, query.offset + query.limit),
    total: filtered.length,
  });
}

/* -------------------------------------------------------------------------- */
/* Pinterest boards (target picker)                                              */
/* -------------------------------------------------------------------------- */

export interface PinterestBoard {
  id: string;
  name: string;
}

/**
 * Lists the connected Pinterest account's boards for the publish target
 * picker. Read-only: a dead grant surfaces as a reconnect error without
 * mutating the account (the executor owns state transitions).
 */
export async function listPinterestBoards(
  actor: ActorContext,
  repo: NibrexoRepository,
  accountId: UUID,
  deps: PublishDeps = {},
): Promise<ServiceResult<{ boards: PinterestBoard[]; truncated: boolean }>> {
  if (!checkPermission(actor, { module: 'social', action: 'view' }).allowed) {
    return publishDenied(actor, 'view') as ServiceResult<{ boards: PinterestBoard[]; truncated: boolean }>;
  }
  const account = await repo.socialAccounts.get(accountId, actor.organizationId);
  if (!account || account.platform !== 'pinterest') {
    return failCode('PUBLISH_NOT_FOUND', 'Pinterest account not found.', 'validation') as ServiceResult<{
      boards: PinterestBoard[];
      truncated: boolean;
    }>;
  }
  if (account.status !== 'connected') {
    return failCode(
      'PUBLISH_ACCOUNT_OFFLINE',
      `Account is ${account.status.replace('_', ' ')}; reconnect before publishing.`,
      'validation',
    ) as ServiceResult<{ boards: PinterestBoard[]; truncated: boolean }>;
  }
  const http = deps.http ?? defaultProviderHttp();
  let keyring: TokenKeyring;
  if (deps.keyring) {
    keyring = deps.keyring;
  } else {
    const resolved = resolveTokenKeyring();
    if (!resolved.ok) {
      return failCode('PUBLISH_KEY_UNAVAILABLE', 'Token encryption key is unavailable.', 'server') as ServiceResult<{
        boards: PinterestBoard[];
        truncated: boolean;
      }>;
    }
    keyring = resolved.keyring;
  }
  const token = await ensureFreshAccessToken(repo, actor, account, keyring, http, deps.now ?? new Date());
  if (!token.ok) {
    return failCode('PUBLISH_ACCOUNT_OFFLINE', token.reason, 'validation') as ServiceResult<{
      boards: PinterestBoard[];
      truncated: boolean;
    }>;
  }
  try {
    const response = await http('https://api.pinterest.com/v5/boards', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    const payload = (await parseProviderJson(response, { platform: 'Pinterest' })) as Record<string, unknown>;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const boards: PinterestBoard[] = [];
    for (const item of items) {
      const row = (item ?? {}) as Record<string, unknown>;
      if (typeof row.id === 'string' && typeof row.name === 'string') {
        boards.push({ id: row.id, name: row.name });
      }
    }
    return ok({ boards, truncated: typeof payload.bookmark === 'string' && payload.bookmark.length > 0 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    return failCode('PUBLISH_PROVIDER_ERROR', `Pinterest: ${detail.slice(0, 200)}`, 'network', true) as ServiceResult<{
      boards: PinterestBoard[];
      truncated: boolean;
    }>;
  }
}

/* -------------------------------------------------------------------------- */
/* Executor                                                                    */
/* -------------------------------------------------------------------------- */

function schedulerActor(job: PublishJob): ActorContext {
  return {
    userId: job.created_by ?? NIL_USER,
    organizationId: job.organization_id,
    role: 'owner',
    email: null,
    fullName: null,
    isDevIdentity: false,
  };
}

async function markTerminal(
  repo: NibrexoRepository,
  job: PublishJob,
  patch: Partial<PublishJob>,
  auditAction: 'publish.job.published' | 'publish.job.failed' | null,
  auditMetadata: Record<string, unknown> = {},
): Promise<PublishJob | null> {
  const updated = await repo.publishJobs.update(job.id, job.organization_id, {
    ...patch,
    locked_at: null,
    next_poll_at: null,
  });
  if (!updated) return null;
  if (auditAction) {
    await writeAudit(repo, schedulerActor(job), {
      action: auditAction,
      entityType: 'publish_job',
      entityId: job.id,
      metadata: {
        platform: job.platform,
        contentId: job.content_id,
        accountId: job.account_id,
        providerRef: updated.provider_ref,
        verification: updated.verification,
        ...auditMetadata,
      },
    });
  }
  await syncContentStatus(repo, schedulerActor(job), job.content_id);
  return updated;
}

async function resolveExecutionMedia(
  repo: NibrexoRepository,
  storage: MediaStorage,
  job: PublishJob,
  publisher: PublisherAdapter,
): Promise<
  | { ok: true; media: PublishMediaInput | null; coverPublicUrl: string | null }
  | { ok: false; reason: string; retryable: boolean }
> {
  const snapshot = job.payload;
  if (!snapshot.mediaKind) return { ok: true, media: null, coverPublicUrl: null };
  const strategy = publisher.mediaStrategy(snapshot.mediaKind);

  let bytes: Uint8Array | null = null;
  let publicUrl: string | null = snapshot.mediaExternalUrl;
  let storagePath: string | null = null;
  if (snapshot.mediaId) {
    const row = await repo.mediaFiles.get(snapshot.mediaId, job.organization_id);
    if (!row) {
      return { ok: false, reason: 'The attached media file was deleted after scheduling.', retryable: false };
    }
    storagePath = row.storage_path;
  }
  if (strategy === 'bytes') {
    if (!storagePath) {
      return { ok: false, reason: `${publisher.label} uploads media bytes; attach library media instead of a URL.`, retryable: false };
    }
    try {
      const stored = await storage.download(storagePath);
      if (!stored) return { ok: false, reason: 'The attached media bytes are unavailable.', retryable: true };
      bytes = stored.bytes;
    } catch {
      return { ok: false, reason: 'Media download failed; retry later.', retryable: true };
    }
  }
  if (strategy === 'public-url' && !publicUrl) {
    if (!storagePath || storage.backend !== 'supabase') {
      return { ok: false, reason: `${publisher.label} fetches media from a public URL, which needs the Supabase backend.`, retryable: false };
    }
    try {
      publicUrl = await storage.createSignedUrl(storagePath, snapshot.mediaKind === 'video' ? 7200 : 3600);
      if (!publicUrl) return { ok: false, reason: 'Could not sign a media URL for the provider.', retryable: true };
    } catch {
      return { ok: false, reason: 'Could not sign a media URL for the provider.', retryable: true };
    }
  }

  let coverPublicUrl: string | null = null;
  if (snapshot.coverMediaId) {
    const cover = await repo.mediaFiles.get(snapshot.coverMediaId, job.organization_id);
    if (!cover || mediaKindFor(cover.mime_type) !== 'image') {
      return { ok: false, reason: 'The Pin cover image is gone; pick a new cover.', retryable: false };
    }
    if (storage.backend !== 'supabase') {
      return { ok: false, reason: 'Pinterest video covers need a public URL (Supabase backend).', retryable: false };
    }
    try {
      coverPublicUrl = await storage.createSignedUrl(cover.storage_path, 7200);
      if (!coverPublicUrl) return { ok: false, reason: 'Could not sign the cover URL for Pinterest.', retryable: true };
    } catch {
      return { ok: false, reason: 'Could not sign the cover URL for Pinterest.', retryable: true };
    }
  }

  return {
    ok: true,
    media: {
      kind: snapshot.mediaKind,
      mime: snapshot.mediaMime ?? 'application/octet-stream',
      sizeBytes: snapshot.mediaSizeBytes ?? bytes?.byteLength ?? 0,
      filename: storagePath?.split('/').pop() ?? 'media',
      bytes,
      publicUrl,
    },
    coverPublicUrl,
  };
}

/**
 * Runs one claim's worth of work for a job: immediate steps loop inline
 * (bounded), async waits park the row for the sweeper. Returns the latest
 * persisted row, or null when the row vanished mid-flight.
 */
export async function driveJob(
  repo: NibrexoRepository,
  storage: MediaStorage,
  job: PublishJob,
  deps: PublishDeps = {},
): Promise<PublishJob | null> {
  const now = deps.now ?? new Date();
  const http = deps.http ?? defaultProviderHttp();
  let keyring: TokenKeyring;
  if (deps.keyring) {
    keyring = deps.keyring;
  } else {
    const resolved = resolveTokenKeyring();
    if (!resolved.ok) {
      return markTerminal(
        repo,
        job,
        { status: 'failed', last_error: 'Token encryption key is unavailable; retry once configured.', provider_payload: { ...job.provider_payload, retryable: true } },
        'publish.job.failed',
        { outcome: 'failed' },
      );
    }
    keyring = resolved.keyring;
  }

  const account = await repo.socialAccounts.get(job.account_id, job.organization_id);
  if (!account) {
    return markTerminal(
      repo,
      job,
      { status: 'failed', last_error: 'The social account no longer exists.', provider_payload: { ...job.provider_payload, retryable: false } },
      'publish.job.failed',
      { outcome: 'failed' },
    );
  }
  if (account.status !== 'connected') {
    const reauth = account.status === 'reconnect_required';
    return markTerminal(
      repo,
      job,
      {
        status: 'failed',
        last_error: `Account is ${account.status.replace('_', ' ')}; reconnect before publishing.`,
        provider_payload: { ...job.provider_payload, retryable: false, reauth },
      },
      'publish.job.failed',
      { outcome: 'failed', reauth },
    );
  }
  const publisher = getPublisher(account.platform);
  if (!publisher) {
    return markTerminal(
      repo,
      job,
      {
        status: 'failed',
        last_error: `${PUBLISHING_SUPPORT[account.platform]?.label ?? account.platform}: publishing is not supported.`,
        provider_payload: { ...job.provider_payload, retryable: false, unsupported: true },
      },
      'publish.job.failed',
      { outcome: 'failed', unsupported: true },
    );
  }

  const token = await ensureFreshAccessToken(repo, schedulerActor(job), account, keyring, http, now);
  if (!token.ok) {
    if (token.reauth) {
      await repo.socialAccounts.update(account.id, job.organization_id, {
        status: 'reconnect_required',
        last_error: token.reason,
      });
    }
    return markTerminal(
      repo,
      job,
      {
        status: 'failed',
        last_error: token.reason,
        provider_payload: { ...job.provider_payload, retryable: token.reauth ? false : token.retryable, reauth: token.reauth },
      },
      'publish.job.failed',
      { outcome: 'failed', reauth: token.reauth },
    );
  }

  const mediaResult = await resolveExecutionMedia(repo, storage, job, publisher);
  if (!mediaResult.ok) {
    return markTerminal(
      repo,
      job,
      {
        status: 'failed',
        last_error: mediaResult.reason,
        provider_payload: { ...job.provider_payload, retryable: mediaResult.retryable },
      },
      'publish.job.failed',
      { outcome: 'failed' },
    );
  }

  const scheduledSubmit = job.status === 'queued' && Date.parse(job.run_at) > now.getTime() + 5000;
  let state: PublishProviderState = { ...job.provider_payload };
  // Transient bookkeeping must not leak into adapter state comparisons.
  delete state.retryable;
  delete state.reauth;
  delete state.unsupported;

  for (let step = 0; step < MAX_IMMEDIATE_STEPS; step += 1) {
    const ctx: PublishStepContext = {
      platform: account.platform,
      accountExternalId: account.external_account_id,
      accessToken: token.accessToken,
      title: job.payload.title,
      text: job.payload.caption,
      linkUrl: job.payload.linkUrl,
      media: mediaResult.media,
      coverPublicUrl: mediaResult.coverPublicUrl,
      options: job.payload.options,
      runAt: job.run_at,
      scheduled: scheduledSubmit,
      state,
      http,
      now,
    };
    const outcome = await publisher.executeStep(ctx);

    if (outcome.done && outcome.result === 'published') {
      return markTerminal(
        repo,
        job,
        {
          status: 'published',
          verification: outcome.verification,
          provider_ref: outcome.providerRef,
          provider_payload: { ...state, postId: outcome.postId, note: outcome.note ?? null },
          last_error: null,
        },
        'publish.job.published',
      );
    }
    if (outcome.done && outcome.result === 'scheduled_provider') {
      const updated = await repo.publishJobs.update(job.id, job.organization_id, {
        status: 'scheduled',
        provider_ref: outcome.providerRef,
        provider_payload: {
          ...state,
          step: SCHEDULED_VERIFY_STEP,
          postId: outcome.postId ?? outcome.providerRef,
          note: outcome.note ?? null,
        },
        next_poll_at: outcome.verifyAfter,
        locked_at: null,
        last_error: null,
      });
      if (updated) await syncContentStatus(repo, schedulerActor(job), job.content_id);
      return updated;
    }
    if (outcome.done && outcome.result === 'failed') {
      if (outcome.reauth) {
        await repo.socialAccounts.update(account.id, job.organization_id, {
          status: 'reconnect_required',
          last_error: outcome.reason,
        });
      }
      return markTerminal(
        repo,
        job,
        {
          status: 'failed',
          last_error: outcome.reason,
          provider_payload: { ...state, retryable: outcome.retryable, reauth: outcome.reauth ?? false },
        },
        'publish.job.failed',
        { outcome: 'failed', reauth: outcome.reauth ?? false },
      );
    }
    if (outcome.done && outcome.result === 'unknown') {
      return markTerminal(
        repo,
        job,
        {
          status: 'unknown',
          last_error: outcome.reason,
          provider_payload: { ...state, retryable: true },
        },
        'publish.job.failed',
        { outcome: 'unknown' },
      );
    }
    if (outcome.done && outcome.result === 'unsupported') {
      return markTerminal(
        repo,
        job,
        {
          status: 'failed',
          last_error: outcome.reason,
          provider_payload: { ...state, retryable: false, unsupported: true },
        },
        'publish.job.failed',
        { outcome: 'failed', unsupported: true },
      );
    }
    if (!outcome.done && outcome.pollAfterSeconds <= 0) {
      state = { ...outcome.state };
      continue;
    }
    if (!outcome.done) {
      const updated = await repo.publishJobs.update(job.id, job.organization_id, {
        status: 'verifying',
        provider_ref: typeof outcome.state.ref === 'string' ? outcome.state.ref : job.provider_ref,
        provider_payload: { ...outcome.state, note: outcome.note ?? null },
        next_poll_at: new Date(now.getTime() + outcome.pollAfterSeconds * 1000).toISOString(),
        locked_at: null,
        last_error: null,
      });
      if (updated) await syncContentStatus(repo, schedulerActor(job), job.content_id);
      return updated;
    }
  }

  // Immediate-step budget exhausted (defensive; adapters terminate sooner):
  // park for the sweeper instead of spinning.
  const parked = await repo.publishJobs.update(job.id, job.organization_id, {
    status: 'verifying',
    provider_payload: state,
    next_poll_at: new Date(now.getTime() + 60_000).toISOString(),
    locked_at: null,
  });
  if (parked) await syncContentStatus(repo, schedulerActor(job), job.content_id);
  return parked;
}

/* -------------------------------------------------------------------------- */
/* Retry / cancel                                                                */
/* -------------------------------------------------------------------------- */

export async function retryPublishJob(
  actor: ActorContext,
  repo: NibrexoRepository,
  storage: MediaStorage,
  jobId: UUID,
  deps: PublishDeps = {},
): Promise<ServiceResult<PublishJob>> {
  if (!checkPermission(actor, { module: 'social', action: 'publish' }).allowed) {
    return publishDenied(actor, 'publish') as ServiceResult<PublishJob>;
  }
  const job = await repo.publishJobs.get(jobId, actor.organizationId);
  if (!job) return failCode('PUBLISH_NOT_FOUND', 'Publish job not found.', 'validation') as ServiceResult<PublishJob>;
  if (job.status !== 'failed' && job.status !== 'unknown') {
    return failCode('PUBLISH_NOT_RETRYABLE', `Only failed jobs can be retried (this one is ${job.status}).`, 'validation') as ServiceResult<PublishJob>;
  }
  if (job.provider_payload.unsupported === true) {
    return failCode('PUBLISH_NOT_RETRYABLE', 'Unsupported operations cannot be retried.', 'validation') as ServiceResult<PublishJob>;
  }
  if (job.status === 'failed' && job.provider_payload.retryable === false) {
    return failCode('PUBLISH_NOT_RETRYABLE', job.last_error ?? 'This failure is not retryable.', 'validation') as ServiceResult<PublishJob>;
  }
  if (job.attempts >= job.max_attempts) {
    return failCode('PUBLISH_NOT_RETRYABLE', 'This job exhausted its attempt budget.', 'validation') as ServiceResult<PublishJob>;
  }

  // Resume where the provider left off: a stored provider reference means the
  // submit reached the provider, so re-poll instead of re-submitting.
  const resumePoll = !!job.provider_ref;
  const reset: PublishProviderState = { ...job.provider_payload, pollRound: 0 };
  delete reset.retryable;
  delete reset.reauth;
  const resetJob = await repo.publishJobs.update(job.id, actor.organizationId, {
    status: resumePoll ? 'verifying' : 'queued',
    run_at: resumePoll ? job.run_at : (deps.now ?? new Date()).toISOString(),
    next_poll_at: resumePoll ? (deps.now ?? new Date()).toISOString() : null,
    last_error: null,
    locked_at: null,
    provider_payload: reset,
  });
  if (!resetJob) return failCode('PUBLISH_NOT_FOUND', 'Publish job not found.', 'validation') as ServiceResult<PublishJob>;
  await writeAudit(repo, actor, {
    action: 'publish.job.created',
    entityType: 'publish_job',
    entityId: job.id,
    metadata: { platform: job.platform, retry: true, attempt: resetJob.attempts + 1 },
  });
  const driven = await driveJob(repo, storage, resetJob, deps);
  return ok(driven ?? resetJob);
}

export async function cancelPublishJob(
  actor: ActorContext,
  repo: NibrexoRepository,
  storage: MediaStorage,
  jobId: UUID,
  deps: PublishDeps = {},
): Promise<ServiceResult<PublishJob>> {
  if (!checkPermission(actor, { module: 'social', action: 'publish' }).allowed) {
    return publishDenied(actor, 'publish') as ServiceResult<PublishJob>;
  }
  const job = await repo.publishJobs.get(jobId, actor.organizationId);
  if (!job) return failCode('PUBLISH_NOT_FOUND', 'Publish job not found.', 'validation') as ServiceResult<PublishJob>;
  if (TERMINAL_JOB_STATUSES.includes(job.status)) {
    return failCode('PUBLISH_ALREADY_TERMINAL', `This job is already ${job.status}.`, 'validation') as ServiceResult<PublishJob>;
  }

  // Not yet submitted: safe local cancel.
  if (!job.provider_ref && (job.status === 'queued' || job.status === 'publishing')) {
    const updated = await repo.publishJobs.update(job.id, actor.organizationId, {
      status: 'cancelled',
      locked_at: null,
      next_poll_at: null,
      last_error: null,
    });
    if (!updated) return failCode('PUBLISH_NOT_FOUND', 'Publish job not found.', 'validation') as ServiceResult<PublishJob>;
    await writeAudit(repo, actor, {
      action: 'publish.job.cancelled',
      entityType: 'publish_job',
      entityId: job.id,
      metadata: { platform: job.platform, remote: false },
    });
    await syncContentStatus(repo, actor, job.content_id);
    return ok(updated);
  }

  // Provider-native schedule: attempt a remote cancel where verified.
  if (job.status === 'scheduled') {
    const publisher = getPublisher(job.platform);
    let remoteNote = 'No provider cancel is implemented for this platform.';
    let remoteCancelled = false;
    if (publisher?.cancelRemote) {
      const account = await repo.socialAccounts.get(job.account_id, actor.organizationId);
      const http = deps.http ?? defaultProviderHttp();
      let keyring: TokenKeyring | null = deps.keyring ?? null;
      if (!keyring) {
        const resolved = resolveTokenKeyring();
        keyring = resolved.ok ? resolved.keyring : null;
      }
      if (account && keyring) {
        const token = await ensureFreshAccessToken(repo, actor, account, keyring, http, deps.now ?? new Date());
        if (token.ok) {
          const mediaResult = await resolveExecutionMedia(repo, storage, job, publisher);
          const result = await publisher.cancelRemote({
            platform: job.platform,
            accountExternalId: account.external_account_id,
            accessToken: token.accessToken,
            title: job.payload.title,
            text: job.payload.caption,
            linkUrl: job.payload.linkUrl,
            media: mediaResult.ok ? mediaResult.media : null,
            coverPublicUrl: mediaResult.ok ? mediaResult.coverPublicUrl : null,
            options: job.payload.options,
            runAt: job.run_at,
            scheduled: true,
            state: {
              ...job.provider_payload,
              postId:
                typeof job.provider_payload.postId === 'string'
                  ? job.provider_payload.postId
                  : (job.provider_ref ?? undefined),
            },
            http,
            now: deps.now ?? new Date(),
          });
          remoteCancelled = result.cancelled;
          remoteNote = result.reason;
        } else {
          remoteNote = `Remote cancel skipped: ${token.reason}`;
        }
      } else {
        remoteNote = 'Remote cancel skipped: account or token key unavailable.';
      }
    } else if (job.platform === 'youtube') {
      remoteNote = 'Cancelled in Nibrexo. Remove the scheduled (private) video in YouTube Studio — the upload scope cannot delete it.';
    }
    const updated = await repo.publishJobs.update(job.id, actor.organizationId, {
      status: 'cancelled',
      locked_at: null,
      next_poll_at: null,
      last_error: null,
      provider_payload: { ...job.provider_payload, cancelNote: remoteNote },
    });
    if (!updated) return failCode('PUBLISH_NOT_FOUND', 'Publish job not found.', 'validation') as ServiceResult<PublishJob>;
    await writeAudit(repo, actor, {
      action: 'publish.job.cancelled',
      entityType: 'publish_job',
      entityId: job.id,
      metadata: { platform: job.platform, remote: remoteCancelled, note: remoteNote },
    });
    await syncContentStatus(repo, actor, job.content_id);
    return ok(updated);
  }

  return failCode(
    'PUBLISH_ALREADY_SUBMITTED',
    `This job was already submitted to ${PUBLISHING_SUPPORT[job.platform]?.label ?? job.platform} and cannot be recalled.`,
    'validation',
  ) as ServiceResult<PublishJob>;
}

/* -------------------------------------------------------------------------- */
/* Sweeper                                                                     */
/* -------------------------------------------------------------------------- */

export interface SweepSummary {
  claimed: number;
  terminal: Record<string, number>;
  errors: Array<{ jobId: string; error: string }>;
}

export async function runDueJobs(
  repo: NibrexoRepository,
  storage: MediaStorage,
  deps: PublishDeps = {},
): Promise<SweepSummary> {
  const now = deps.now ?? new Date();
  const summary: SweepSummary = { claimed: 0, terminal: {}, errors: [] };
  let claimed: PublishJob[];
  try {
    claimed = await repo.publishJobs.claimDueJobs(now.toISOString(), SWEEP_LOCK_SECONDS, SWEEP_CLAIM_LIMIT);
  } catch (error) {
    summary.errors.push({
      jobId: '*',
      error: error instanceof Error ? error.message : 'Claim failed.',
    });
    return summary;
  }
  summary.claimed = claimed.length;

  for (const job of claimed) {
    try {
      const result = await driveJob(repo, storage, job, { ...deps, now });
      const status = result?.status ?? 'failed';
      summary.terminal[status] = (summary.terminal[status] ?? 0) + 1;
    } catch (error) {
      // Infrastructure failure (DB/storage threw): never leave the row
      // locked. Attempts were already bumped by the claim.
      const message = error instanceof Error ? error.message : 'Job execution failed.';
      summary.errors.push({ jobId: job.id, error: message.slice(0, 200) });
      try {
        if (job.attempts + 1 >= job.max_attempts) {
          await markTerminal(
            repo,
            job,
            {
              status: 'failed',
              last_error: `Execution failed repeatedly (${message.slice(0, 160)}).`,
              provider_payload: { ...job.provider_payload, retryable: true },
            },
            'publish.job.failed',
            { outcome: 'failed' },
          );
        } else if (job.status === 'publishing' && !job.provider_ref) {
          await repo.publishJobs.update(job.id, job.organization_id, {
            status: 'queued',
            locked_at: null,
            last_error: message.slice(0, 300),
          });
        } else {
          await repo.publishJobs.update(job.id, job.organization_id, {
            locked_at: null,
            next_poll_at: new Date(now.getTime() + 300_000).toISOString(),
            last_error: message.slice(0, 300),
          });
        }
      } catch {
        // The lock lease reclaims the row; nothing else to do.
      }
    }
  }
  return summary;
}

/* -------------------------------------------------------------------------- */
/* Content status sync                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Derives the content item status from its publish jobs. Called after every
 * job write. Publishing statuses belong to this pipeline (Phase 6 left them
 * to Phase 8); the library never moves rows out of them.
 */
export async function syncContentStatus(
  repo: NibrexoRepository,
  actor: ActorContext,
  contentId: UUID,
): Promise<void> {
  const rows = await repo.publishJobs.list(actor.organizationId, { limit: 500 });
  const jobs = rows.filter((row) => row.content_id === contentId);
  if (jobs.length === 0) return;
  const content = await repo.contentItems.get(contentId, actor.organizationId);
  if (!content) return;

  const active = jobs.filter((job) => ACTIVE_JOB_STATUSES.includes(job.status));
  let next: ContentItem['status'];
  if (active.length > 0) {
    const nowMs = Date.now();
    const allFutureQueued = active.every(
      (job) => job.status === 'queued' && Date.parse(job.run_at) > nowMs,
    );
    next = allFutureQueued ? 'SCHEDULED' : 'PUBLISHING';
  } else {
    const published = jobs.filter((job) => job.status === 'published').length;
    const cancelled = jobs.filter((job) => job.status === 'cancelled').length;
    if (published === jobs.length) next = 'PUBLISHED';
    else if (published > 0) next = 'PARTIAL';
    else if (cancelled === jobs.length) next = 'CANCELLED';
    else next = 'FAILED';
  }
  if (content.status !== next) {
    await repo.contentItems.update(contentId, actor.organizationId, { status: next });
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import { scriptedHttp, urlContains } from '../helpers/social-http';
import type { NibrexoRepository } from '@/server/db/types';
import { createMemoryMediaStorage, type MediaStorage } from '@/server/content/storage';
import { encryptToken, parseTokenKey, type TokenKeyring } from '@/server/social/crypto';
import {
  cancelPublishJob,
  createPublishJobs,
  getPublishJob,
  listPublishJobs,
  retryPublishJob,
  runDueJobs,
  syncContentStatus,
  validatePublishTargets,
} from '@/server/social/publish/service';
import type {
  ContentItem,
  PublishJob,
  PublishPayloadSnapshot,
  SocialAccount,
  UUID,
} from '@/types/domain';

const TEST_KEY = '0123456789abcdef'.repeat(4);
const PAGE_ID = 'PAGE1';

function keyring(): TokenKeyring {
  return parseTokenKey(TEST_KEY) as TokenKeyring;
}

function storage(): MediaStorage {
  return createMemoryMediaStorage();
}

async function seedContent(store: NibrexoRepository, overrides: Partial<ContentItem> = {}) {
  return store.contentItems.insert({
    organization_id: TEST_ORG,
    title: 'Launch day',
    caption: 'We are live!',
    body: null,
    status: 'DRAFT',
    platforms: ['facebook'],
    media_url: null,
    created_by: actor().userId,
    ...overrides,
  });
}

async function seedAccount(
  store: NibrexoRepository,
  overrides: Partial<SocialAccount> = {},
): Promise<SocialAccount> {
  const account = await store.socialAccounts.insert({
    organization_id: TEST_ORG,
    platform: 'facebook',
    external_account_id: PAGE_ID,
    name: 'Acme Page',
    status: 'connected',
    capabilities: {
      publish: true,
      schedule: true,
      readDm: false,
      sendDm: false,
      readComments: false,
      replyComments: false,
      analytics: false,
    },
    connected_by: actor().userId,
    last_error: null,
    ...overrides,
  });
  await store.socialCredentials.insert({
    organization_id: TEST_ORG,
    account_id: account.id,
    credential_ref: 'v1',
    scopes: ['pages_manage_posts', 'pages_read_engagement'],
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    access_token_encrypted: encryptToken('FB-TOKEN', keyring()),
    refresh_token_encrypted: null,
    token_type: 'Bearer',
    refresh_expires_at: null,
    last_refreshed_at: null,
  });
  return account;
}

function textSnapshot(): PublishPayloadSnapshot {
  return {
    title: 'Launch day',
    caption: 'We are live!',
    mediaId: null,
    mediaKind: null,
    mediaMime: null,
    mediaSizeBytes: null,
    mediaExternalUrl: null,
    coverMediaId: null,
    linkUrl: null,
    options: {},
  };
}

async function seedJob(
  store: NibrexoRepository,
  contentId: UUID,
  accountId: UUID,
  overrides: Partial<PublishJob> = {},
): Promise<PublishJob> {
  return store.publishJobs.insert({
    organization_id: TEST_ORG,
    content_id: contentId,
    account_id: accountId,
    platform: 'facebook',
    status: 'queued',
    verification: null,
    run_at: new Date().toISOString(),
    timezone: 'UTC',
    idempotency_key: `seed_${Math.random().toString(36).slice(2)}`,
    attempts: 0,
    max_attempts: 8,
    provider_ref: null,
    provider_payload: {},
    payload: textSnapshot(),
    last_error: null,
    next_poll_at: null,
    locked_at: null,
    created_by: actor().userId,
    ...overrides,
  });
}

function facebookSuccessScenes() {
  return [
    { match: urlContains(`/${PAGE_ID}/feed`), status: 200, body: { id: 'POST1' } },
    { match: urlContains('/POST1?fields='), status: 200, body: { id: 'POST1', is_published: true } },
  ];
}

beforeEach(() => {
  vi.stubEnv('NIBREXO_TOKEN_ENCRYPTION_KEY', TEST_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Publish creation', () => {
  it('drives an immediate post to published with read-back verification', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const http = scriptedHttp(facebookSuccessScenes());

    const result = await createPublishJobs(
      actor(),
      store,
      storage(),
      { contentId: content.id, targets: [{ accountId: account.id, options: {} }], timezone: 'UTC' },
      { http, keyring: keyring() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.scheduled).toBe(false);
    const entry = result.data.jobs[0]!;
    expect(entry.duplicate).toBe(false);
    expect(entry.job.status).toBe('published');
    expect(entry.job.verification).toBe('read_back');
    expect(entry.job.provider_ref).toBe('POST1');
    // No token material may leak into the job row.
    expect(JSON.stringify(entry.job)).not.toContain('FB-TOKEN');

    const updated = await store.contentItems.get(content.id, TEST_ORG);
    expect(updated?.status).toBe('PUBLISHED');

    const audit = await store.activityLogs.list(TEST_ORG);
    const actions = audit.map((row) => (row as { action?: string }).action);
    expect(actions).toContain('publish.job.created');
    expect(actions).toContain('publish.job.published');
  });

  it('parks a future post as queued without calling any provider', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const http = scriptedHttp([]);

    // Beyond Facebook's 30-day native window, the job is held Nibrexo-side.
    const runAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const result = await createPublishJobs(
      actor(),
      store,
      storage(),
      {
        contentId: content.id,
        targets: [{ accountId: account.id, options: {} }],
        runAt,
        timezone: 'UTC',
      },
      { http, keyring: keyring() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scheduled).toBe(true);
    expect(result.data.jobs[0]!.job.status).toBe('queued');
    // Unmatched provider calls throw, so an empty scene list proves silence.
    expect(http.calls).toHaveLength(0);

    const updated = await store.contentItems.get(content.id, TEST_ORG);
    expect(updated?.status).toBe('SCHEDULED');
  });

  it('submits an in-window future post as a provider-native schedule', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const http = scriptedHttp([
      { match: urlContains(`/${PAGE_ID}/feed`), status: 200, body: { id: 'POST1' } },
    ]);

    const runAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await createPublishJobs(
      actor(),
      store,
      storage(),
      {
        contentId: content.id,
        targets: [{ accountId: account.id, options: {} }],
        runAt,
        timezone: 'UTC',
      },
      { http, keyring: keyring() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.data.jobs[0]!;
    expect(entry.nativeSchedule).toBe(true);
    expect(entry.job.status).toBe('scheduled');
    expect(entry.job.provider_ref).toBe('POST1');
    expect(entry.job.next_poll_at).not.toBeNull();
    expect(String(http.calls[0]!.init.body)).toContain('scheduled_publish_time');
  });

  it('fails all-or-nothing when one target cannot publish', async () => {
    const store = repo();
    const content = await seedContent(store);
    const good = await seedAccount(store);
    const bad = await seedAccount(store, {
      external_account_id: 'PAGE2',
      name: 'Dead Page',
      status: 'disconnected',
    });
    const http = scriptedHttp([]);

    const result = await createPublishJobs(
      actor(),
      store,
      storage(),
      {
        contentId: content.id,
        targets: [
          { accountId: good.id, options: {} },
          { accountId: bad.id, options: {} },
        ],
        timezone: 'UTC',
      },
      { http, keyring: keyring() },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(await store.publishJobs.list(TEST_ORG)).toHaveLength(0);
  });

  it('resolves a repeated request to the existing job (idempotency)', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const http = scriptedHttp([]);
    const input = {
      contentId: content.id,
      targets: [{ accountId: account.id, options: {} }],
      runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      timezone: 'UTC',
      idempotencyKey: 'client-key-1',
    };

    const first = await createPublishJobs(actor(), store, storage(), input, {
      http,
      keyring: keyring(),
    });
    const second = await createPublishJobs(actor(), store, storage(), input, {
      http,
      keyring: keyring(),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data.jobs[0]!.duplicate).toBe(false);
    expect(second.data.jobs[0]!.duplicate).toBe(true);
    expect(second.data.jobs[0]!.job.id).toBe(first.data.jobs[0]!.job.id);
    expect(await store.publishJobs.list(TEST_ORG)).toHaveLength(1);
  });

  it('attaches a second schedule for the same content+account to the active job', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const http = scriptedHttp([]);

    const first = await createPublishJobs(
      actor(),
      store,
      storage(),
      {
        contentId: content.id,
        targets: [{ accountId: account.id, options: {} }],
        runAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
        timezone: 'UTC',
      },
      { http, keyring: keyring() },
    );
    // Different runAt means a different derived key — still no second row.
    // (Both dates sit beyond the native window, so both stay Nibrexo-held.)
    const second = await createPublishJobs(
      actor(),
      store,
      storage(),
      {
        contentId: content.id,
        targets: [{ accountId: account.id, options: {} }],
        runAt: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString(),
        timezone: 'UTC',
      },
      { http, keyring: keyring() },
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.jobs[0]!.duplicate).toBe(true);
    expect(await store.publishJobs.list(TEST_ORG)).toHaveLength(1);
  });

  it('refuses creation for roles without the publish permission', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);

    const result = await createPublishJobs(
      actor({ role: 'member' }),
      store,
      storage(),
      { contentId: content.id, targets: [{ accountId: account.id, options: {} }], timezone: 'UTC' },
      { http: scriptedHttp([]), keyring: keyring() },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PUBLISH_PERMISSION_DENIED');
  });
});

describe('Publish validation (dry-run)', () => {
  it('reports per-target issues without writing jobs', async () => {
    const store = repo();
    const content = await seedContent(store);
    const bad = await seedAccount(store, { name: 'Dead Page', status: 'disconnected' });

    const result = await validatePublishTargets(
      actor(),
      store,
      storage(),
      { contentId: content.id, targets: [{ accountId: bad.id, options: {} }], timezone: 'UTC' },
      { keyring: keyring() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.targets[0]!.ok).toBe(false);
    expect(result.data.targets[0]!.issues.join(' ')).toMatch(/disconnected/);
    expect(await store.publishJobs.list(TEST_ORG)).toHaveLength(0);
  });
});

describe('Publish reads', () => {
  it('keeps jobs tenant-scoped', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const job = await seedJob(store, content.id, account.id);

    const own = await getPublishJob(actor(), store, job.id);
    expect(own.ok).toBe(true);

    const foreign = await getPublishJob(actor({ organizationId: OTHER_ORG }), store, job.id);
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.code).toBe('PUBLISH_NOT_FOUND');

    const listed = await listPublishJobs(actor({ organizationId: OTHER_ORG }), store, {
      limit: 20,
      offset: 0,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.jobs).toHaveLength(0);
  });
});

describe('Publish retry', () => {
  it('resumes a failed-before-submit job from queued and publishes it', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    // Empty scenes: the submit call throws inside the adapter, which fails
    // the job as retryable without a provider reference.
    const failing = scriptedHttp([]);
    const created = await createPublishJobs(
      actor(),
      store,
      storage(),
      { contentId: content.id, targets: [{ accountId: account.id, options: {} }], timezone: 'UTC' },
      { http: failing, keyring: keyring() },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.jobs[0]!.job.status).toBe('failed');
    expect(created.data.jobs[0]!.job.provider_ref).toBeNull();

    const retried = await retryPublishJob(actor(), store, storage(), created.data.jobs[0]!.job.id, {
      http: scriptedHttp(facebookSuccessScenes()),
      keyring: keyring(),
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.data.status).toBe('published');
    expect(retried.data.provider_ref).toBe('POST1');
  });

  it('resumes a submitted job at verification and never resubmits', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const job = await seedJob(store, content.id, account.id, {
      status: 'failed',
      provider_ref: 'POST1',
      provider_payload: { step: 'verify', ref: 'POST1', postId: 'POST1', retryable: true },
      last_error: 'Read-back failed; retrying.',
    });

    const http = scriptedHttp([
      { match: urlContains('/POST1?fields='), status: 200, body: { id: 'POST1', is_published: true } },
    ]);
    const retried = await retryPublishJob(actor(), store, storage(), job.id, {
      http,
      keyring: keyring(),
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.data.status).toBe('published');
    // Only the read-back ran: no POST to /feed may appear.
    expect(http.calls.every((call) => !call.url.includes('/feed'))).toBe(true);
  });

  it('refuses non-retryable failures', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const job = await seedJob(store, content.id, account.id, {
      status: 'failed',
      provider_payload: { retryable: false },
      last_error: 'Facebook posts need text, a link, or media.',
    });

    const retried = await retryPublishJob(actor(), store, storage(), job.id, {
      http: scriptedHttp([]),
      keyring: keyring(),
    });
    expect(retried.ok).toBe(false);
    if (retried.ok) return;
    expect(retried.error.code).toBe('PUBLISH_NOT_RETRYABLE');
  });
});

describe('Publish cancel', () => {
  it('cancels a queued job locally', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const job = await seedJob(store, content.id, account.id, {
      run_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const cancelled = await cancelPublishJob(actor(), store, storage(), job.id, {
      http: scriptedHttp([]),
      keyring: keyring(),
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.data.status).toBe('cancelled');

    const updated = await store.contentItems.get(content.id, TEST_ORG);
    expect(updated?.status).toBe('CANCELLED');
  });

  it('cancels a provider-native schedule remotely before marking cancelled', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const job = await seedJob(store, content.id, account.id, {
      status: 'scheduled',
      provider_ref: 'POST1',
      provider_payload: { step: 'scheduled_verify', ref: 'POST1', postId: 'POST1' },
      run_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const http = scriptedHttp([
      {
        match: (url, init) =>
          urlContains('/POST1?')(url) && typeof init.body === 'string' && init.body.includes('delete'),
        status: 200,
        body: { success: true },
      },
    ]);
    const cancelled = await cancelPublishJob(actor(), store, storage(), job.id, {
      http,
      keyring: keyring(),
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.data.status).toBe('cancelled');
    expect(http.calls).toHaveLength(1);
  });

  it('refuses to cancel an already-submitted immediate post', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    const job = await seedJob(store, content.id, account.id, {
      status: 'verifying',
      provider_ref: 'POST1',
      provider_payload: { step: 'verify', ref: 'POST1', postId: 'POST1' },
    });

    const cancelled = await cancelPublishJob(actor(), store, storage(), job.id, {
      http: scriptedHttp([]),
      keyring: keyring(),
    });
    expect(cancelled.ok).toBe(false);
    if (cancelled.ok) return;
    expect(cancelled.error.code).toBe('PUBLISH_ALREADY_SUBMITTED');
  });
});

describe('Publish sweeper', () => {
  it('claims a due job exactly once and publishes it', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    await seedJob(store, content.id, account.id, {
      run_at: new Date(Date.now() - 1000).toISOString(),
    });

    const first = await runDueJobs(store, storage(), {
      http: scriptedHttp(facebookSuccessScenes()),
      keyring: keyring(),
    });
    expect(first.claimed).toBe(1);
    expect(first.errors).toHaveLength(0);

    // Terminal rows are never reclaimed.
    const second = await runDueJobs(store, storage(), {
      http: scriptedHttp([]),
      keyring: keyring(),
    });
    expect(second.claimed).toBe(0);

    const updated = await store.contentItems.get(content.id, TEST_ORG);
    expect(updated?.status).toBe('PUBLISHED');
  });

  it('reports per-job errors without stopping the sweep', async () => {
    const store = repo();
    const content = await seedContent(store);
    const account = await seedAccount(store);
    await seedJob(store, content.id, account.id, {
      run_at: new Date(Date.now() - 1000).toISOString(),
      idempotency_key: 'sweep-err-1',
    });
    await seedJob(store, content.id, account.id, {
      run_at: new Date(Date.now() - 1000).toISOString(),
      idempotency_key: 'sweep-err-2',
    });

    const summary = await runDueJobs(store, storage(), {
      http: scriptedHttp([]),
      keyring: keyring(),
    });
    // Empty scenes make both submits fail as retryable — the sweep survives
    // and both jobs land failed (not stuck, not double-driven).
    expect(summary.claimed).toBe(2);
    const rows = await store.publishJobs.list(TEST_ORG);
    expect(rows.every((row) => row.status === 'failed')).toBe(true);
  });
});

describe('Content status sync', () => {
  it('derives PARTIAL from mixed terminal jobs', async () => {
    const store = repo();
    const content = await seedContent(store);
    const first = await seedAccount(store);
    const second = await seedAccount(store, { external_account_id: 'PAGE2', name: 'Second Page' });
    await seedJob(store, content.id, first.id, { status: 'published', idempotency_key: 'sync-1' });
    await seedJob(store, content.id, second.id, {
      status: 'failed',
      last_error: 'boom',
      idempotency_key: 'sync-2',
    });

    await syncContentStatus(store, actor(), content.id);
    const updated = await store.contentItems.get(content.id, TEST_ORG);
    expect(updated?.status).toBe('PARTIAL');
  });
});

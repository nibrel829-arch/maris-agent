import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import { scriptedHttp, urlContains } from '../helpers/social-http';
import { parseTokenKey, encryptToken } from '@/server/social/crypto';
import type { SocialAccount, UUID } from '@/types/domain';
import type { ProviderHttp } from '@/server/social/providers';
import {
  getInboxConversation,
  listInbox,
  saveReplyDraft,
  sendInboxReply,
  syncInboxAccount,
  updateInboxConversation,
} from '@/server/inbox/service';

const KEYRING = parseTokenKey('0123456789abcdef'.repeat(4))!;
const YOUTUBE_ACCOUNT_ID: UUID = '00000000-0000-0000-0000-0000000000b1';
const FB_ACCOUNT_ID: UUID = '00000000-0000-0000-0000-0000000000b2';
const NOW = new Date('2026-10-07T12:00:00.000Z');
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

beforeEach(() => {
  vi.stubEnv('NIBREXO_TOKEN_ENCRYPTION_KEY', '0123456789abcdef'.repeat(4));
  vi.stubEnv('NIBREXO_DATA_BACKEND', 'memory');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeAccount(
  platform: 'youtube' | 'facebook',
  id: UUID,
  organizationId: UUID = TEST_ORG,
  connectedBy: UUID = actor().userId,
): Omit<SocialAccount, 'created_at' | 'updated_at'> {
  return {
    id,
    organization_id: organizationId,
    platform,
    external_account_id: platform === 'youtube' ? 'CHANNEL1' : 'PAGE1',
    name: platform === 'youtube' ? 'Nibrexo channel' : 'Nibrexo Page',
    status: 'connected',
    capabilities: { publish: false, schedule: false, readDm: false, sendDm: false, readComments: false, replyComments: false, analytics: false },
    connected_by: connectedBy,
    last_error: null,
  };
}

async function seedAccount(
  store: ReturnType<typeof repo>,
  platform: 'youtube' | 'facebook' = 'youtube',
  options: { scopes?: string[]; organizationId?: UUID; id?: UUID } = {},
): Promise<SocialAccount> {
  const id = options.id ?? (platform === 'youtube' ? YOUTUBE_ACCOUNT_ID : FB_ACCOUNT_ID);
  const organizationId = options.organizationId ?? TEST_ORG;
  const account = await store.socialAccounts.insert(makeAccount(platform, id, organizationId));
  const token = platform === 'youtube' ? 'YT-SERVER-TOKEN' : 'FB-SERVER-TOKEN';
  const scopeList = options.scopes ?? (platform === 'youtube' ? [YOUTUBE_SCOPE] : ['pages_read_engagement', 'pages_read_user_content']);
  await store.socialCredentials.insert({
    organization_id: organizationId,
    account_id: id,
    credential_ref: 'v1',
    scopes: scopeList,
    expires_at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    access_token_encrypted: encryptToken(token, KEYRING),
    refresh_token_encrypted: null,
    token_type: 'bearer',
    refresh_expires_at: null,
    last_refreshed_at: null,
  });
  return account;
}

function youtubeSyncHttp() {
  return scriptedHttp([
    { match: urlContains('/youtube/v3/channels?'), status: 200, body: { items: [{ id: 'CHANNEL1', snippet: { title: 'Nibrexo channel' } }] } },
    {
      match: urlContains('/youtube/v3/commentThreads?'),
      status: 200,
      body: { items: [{
        id: 'THREAD1',
        snippet: {
          videoId: 'VIDEO1',
          canReply: true,
          totalReplyCount: 0,
          topLevelComment: {
            id: 'COMMENT1',
            snippet: {
              authorChannelId: { value: 'VIEWER1' },
              authorDisplayName: 'Viewer One',
              textDisplay: 'Can you help me?',
              publishedAt: '2026-10-07T10:00:00.000Z',
            },
          },
        },
      }] },
    },
  ]);
}

function verifiedReplyHttp() {
  return scriptedHttp([
    {
      match: (url, init) => urlContains('/youtube/v3/comments?part=snippet')(url) && init.method === 'POST',
      status: 200,
      body: { id: 'REPLY1' },
    },
    {
      match: (url, init) => urlContains('/youtube/v3/comments?')(url) && init.method === 'GET',
      status: 200,
      body: { items: [{
        id: 'REPLY1',
        snippet: {
          parentId: 'THREAD1',
          textOriginal: 'Happy to help.',
          authorChannelId: { value: 'CHANNEL1' },
          authorDisplayName: 'Nibrexo channel',
          publishedAt: '2026-10-07T11:55:00.000Z',
        },
      }] },
    },
  ]);
}

async function syncedConversation(store: ReturnType<typeof repo>) {
  const account = await seedAccount(store);
  const sync = await syncInboxAccount(actor(), store, account.id, {
    adminRepo: store,
    keyring: KEYRING,
    http: youtubeSyncHttp(),
    now: () => NOW,
  });
  if (!sync.ok) throw new Error(`sync failed: ${sync.error.code}`);
  const listed = await store.inbox.listConversations(TEST_ORG, { limit: 10, offset: 0 });
  return { account, sync: sync.data, conversation: listed.rows[0]! };
}

describe('Unified Inbox services', () => {
  it('polls a connected YouTube channel, deduplicates messages and preserves local read/status state', async () => {
    const store = repo();
    const account = await seedAccount(store);
    const first = await syncInboxAccount(actor(), store, account.id, {
      adminRepo: store,
      keyring: KEYRING,
      http: youtubeSyncHttp(),
      now: () => NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.newMessages).toBe(1);
    expect(await store.inbox.unreadCount(TEST_ORG)).toBe(1);

    const conversation = (await store.inbox.listConversations(TEST_ORG, { limit: 10, offset: 0 })).rows[0]!;
    expect(conversation.external_thread_id).toBe('THREAD1');
    expect(conversation.is_read).toBe(false);
    const detail = await getInboxConversation(actor(), store, conversation.id, { limit: 100 }, { adminRepo: store });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.replySupported).toBe(true);
    expect(detail.data.messages[0]!.body).toBe('Can you help me?');

    const marked = await updateInboxConversation(actor(), store, conversation.id, { is_read: true });
    expect(marked.ok).toBe(true);
    expect(await store.inbox.unreadCount(TEST_ORG)).toBe(0);
    const closed = await updateInboxConversation(actor(), store, conversation.id, { status: 'closed' });
    expect(closed.ok).toBe(true);

    const second = await syncInboxAccount(actor(), store, account.id, {
      adminRepo: store,
      keyring: KEYRING,
      http: youtubeSyncHttp(),
      now: () => new Date(NOW.getTime() + 60_000),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.newMessages).toBe(0);
    expect(await store.inbox.unreadCount(TEST_ORG)).toBe(0);
    expect((await store.inbox.getConversation(conversation.id, TEST_ORG))?.status).toBe('closed');
  });

  it('resumes bounded YouTube pagination across polling runs instead of repeating the first page', async () => {
    const store = repo();
    const account = await seedAccount(store);
    const pageData = new Map<string, { threadId: string; next: string | null }>([
      ['first', { threadId: 'THREAD1', next: 'PAGE2' }],
      ['PAGE2', { threadId: 'THREAD2', next: 'PAGE3' }],
      ['PAGE3', { threadId: 'THREAD3', next: 'PAGE4' }],
      ['PAGE4', { threadId: 'THREAD4', next: null }],
    ]);
    const response = (body: unknown) => ({
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    const http: ProviderHttp = async (url) => {
      if (url.includes('/youtube/v3/channels?')) {
        return response({ items: [{ id: 'CHANNEL1', snippet: { title: 'Nibrexo channel' } }] });
      }
      const query = new URL(url).searchParams;
      const page = pageData.get(query.get('pageToken') ?? 'first');
      if (!page) throw new Error('Unexpected YouTube page token.');
      return response({
        items: [{
          id: page.threadId,
          snippet: {
            videoId: 'VIDEO1',
            canReply: true,
            totalReplyCount: 0,
            topLevelComment: {
              id: `${page.threadId}-ROOT`,
              snippet: {
                authorChannelId: { value: 'VIEWER1' },
                authorDisplayName: 'Viewer One',
                textDisplay: `Comment on ${page.threadId}`,
                publishedAt: NOW.toISOString(),
              },
            },
          },
        }],
        ...(page.next ? { nextPageToken: page.next } : {}),
      });
    };

    const firstRun = await syncInboxAccount(actor(), store, account.id, {
      adminRepo: store,
      keyring: KEYRING,
      http,
      now: () => NOW,
    });
    expect(firstRun.ok).toBe(true);
    if (!firstRun.ok) return;
    expect(firstRun.data.hasMore).toBe(true);
    expect((await store.inbox.getSyncState(TEST_ORG, account.id))?.cursor.pageToken).toBe('PAGE4');

    const secondRun = await syncInboxAccount(actor(), store, account.id, {
      adminRepo: store,
      keyring: KEYRING,
      http,
      now: () => new Date(NOW.getTime() + 60_000),
    });
    expect(secondRun.ok).toBe(true);
    if (!secondRun.ok) return;
    expect(secondRun.data.hasMore).toBe(false);
    expect((await store.inbox.getSyncState(TEST_ORG, account.id))?.cursor.pageToken).toBeUndefined();
    expect((await store.inbox.listConversations(TEST_ORG, { limit: 10, offset: 0 })).rows).toHaveLength(4);
  });

  it('links only CRM clients owned by the conversation organization', async () => {
    const store = repo();
    const { conversation } = await syncedConversation(store);
    const ownClient = await store.clients.insert({
      organization_id: TEST_ORG,
      name: 'Acme Studio',
      company: 'Acme',
      email: null,
      phone: null,
      status: 'active',
      tags: [],
      notes: null,
      created_by: actor().userId,
    });
    const foreignClient = await store.clients.insert({
      organization_id: OTHER_ORG,
      name: 'Other Tenant Client',
      company: null,
      email: null,
      phone: null,
      status: 'active',
      tags: [],
      notes: null,
      created_by: actor().userId,
    });

    const linked = await updateInboxConversation(actor(), store, conversation.id, { client_id: ownClient.id });
    expect(linked.ok).toBe(true);
    if (linked.ok) expect(linked.data.client_id).toBe(ownClient.id);

    const crossTenant = await updateInboxConversation(actor(), store, conversation.id, { client_id: foreignClient.id });
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) expect(crossTenant.error.code).toBe('INBOX_CLIENT_NOT_FOUND');
  });

  it('requires the actually stored provider scope before making any external request', async () => {
    const store = repo();
    const account = await seedAccount(store, 'youtube', { scopes: ['openid', 'youtube.upload'] });
    const http = scriptedHttp([]);
    const result = await syncInboxAccount(actor(), store, account.id, {
      adminRepo: store,
      keyring: KEYRING,
      http,
      now: () => NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INBOX_REAUTH_REQUIRED');
    expect(http.calls).toHaveLength(0);
  });

  it('isolates conversation and account reads across organizations', async () => {
    const store = repo();
    const own = await seedAccount(store);
    const foreign = await seedAccount(store, 'youtube', {
      id: '00000000-0000-0000-0000-0000000000b3',
      organizationId: OTHER_ORG,
    });
    const wrong = await syncInboxAccount(actor(), store, foreign.id, {
      adminRepo: store,
      keyring: KEYRING,
      http: youtubeSyncHttp(),
      now: () => NOW,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('INBOX_ACCOUNT_NOT_FOUND');
    const created = await syncInboxAccount(actor(), store, own.id, {
      adminRepo: store,
      keyring: KEYRING,
      http: youtubeSyncHttp(),
      now: () => NOW,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ownRows = await store.inbox.listConversations(TEST_ORG, { limit: 10, offset: 0 });
    const otherRows = await store.inbox.listConversations(OTHER_ORG, { limit: 10, offset: 0 });
    expect(ownRows.rows).toHaveLength(1);
    expect(otherRows.rows).toHaveLength(0);
    expect(await store.inbox.getConversation(ownRows.rows[0]!.id, OTHER_ORG)).toBeNull();
  });

  it('limits sending to authorized roles and deduplicates provider replies by idempotency key', async () => {
    const store = repo();
    const { conversation } = await syncedConversation(store);
    const member = actor({ role: 'member' });
    const denied = await sendInboxReply(member, store, conversation.id, 'Not allowed', 'reply-denied-0001', {
      adminRepo: store,
      keyring: KEYRING,
      http: scriptedHttp([]),
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.errorClass).toBe('permission');

    const http = verifiedReplyHttp();
    const sent = await sendInboxReply(actor(), store, conversation.id, 'Happy to help.', 'reply-key-00000001', {
      adminRepo: store,
      keyring: KEYRING,
      http,
      now: () => NOW,
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.data.status).toBe('sent');
    expect(sent.data.message.direction).toBe('outbound');
    expect(http.calls).toHaveLength(2);

    const duplicate = await sendInboxReply(actor(), store, conversation.id, 'Happy to help.', 'reply-key-00000001', {
      adminRepo: store,
      keyring: KEYRING,
      http: scriptedHttp([]),
      now: () => NOW,
    });
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) expect(duplicate.data.status).toBe('already_sent');
  });

  it('blocks additional replies after provider acceptance becomes uncertain', async () => {
    const store = repo();
    const { conversation } = await syncedConversation(store);
    const http = scriptedHttp([
      { match: (url, init) => urlContains('/youtube/v3/comments?part=snippet')(url) && init.method === 'POST', status: 200, body: { id: 'REPLY-UNKNOWN' } },
      { match: (url, init) => urlContains('/youtube/v3/comments?')(url) && init.method === 'GET', status: 500, body: { error: 'temporary' } },
    ]);
    const first = await sendInboxReply(actor(), store, conversation.id, 'Hello.', 'reply-unknown-0001', {
      adminRepo: store,
      keyring: KEYRING,
      http,
      now: () => NOW,
    });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.code).toBe('INBOX_REPLY_UNCERTAIN');
    expect(http.calls).toHaveLength(2);

    const secondHttp = scriptedHttp([]);
    const second = await sendInboxReply(actor(), store, conversation.id, 'Hello again.', 'reply-new-key-00001', {
      adminRepo: store,
      keyring: KEYRING,
      http: secondHttp,
      now: () => NOW,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('INBOX_REPLY_UNCERTAIN');
    expect(secondHttp.calls).toHaveLength(0);
  });

  it('serializes concurrent distinct reply keys for the same thread', async () => {
    const store = repo();
    const { conversation } = await syncedConversation(store);
    const http = verifiedReplyHttp();
    const deps = { adminRepo: store, keyring: KEYRING, http, now: () => NOW };
    const [first, second] = await Promise.all([
      sendInboxReply(actor(), store, conversation.id, 'Happy to help.', 'concurrent-key-0001', deps),
      sendInboxReply(actor(), store, conversation.id, 'Second.', 'concurrent-key-0002', deps),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(http.calls).toHaveLength(2);
    const attempts = await store.inbox.findUnresolvedReplyAttempt(TEST_ORG, conversation.id);
    expect(attempts).toBeNull();
  });

  it('stores drafts without invoking a provider and audits inbox actions', async () => {
    const store = repo();
    const { conversation } = await syncedConversation(store);
    const detail = await store.inbox.listMessages(conversation.id, TEST_ORG, { limit: 10 });
    const message = detail[0]!;
    const saved = await saveReplyDraft(actor(), store, conversation.id, message.id, 'Draft only.', { adminRepo: store });
    expect(saved.ok).toBe(true);
    expect((await store.inbox.getMessage(message.id, conversation.id, TEST_ORG))?.ai_draft).toBe('Draft only.');
    const logs = await store.activityLogs.list(TEST_ORG, { limit: 50 });
    expect(logs.some((entry) => entry.action === 'inbox.reply.draft_saved')).toBe(true);
    expect(logs.some((entry) => entry.action === 'inbox.sync.completed')).toBe(true);
  });

  it('does not expose a Facebook reply composer in normalized detail', async () => {
    const store = repo();
    const account = await seedAccount(store, 'facebook');
    const created = await store.inbox.upsertConversation({
      organization_id: TEST_ORG,
      account_id: account.id,
      platform: 'facebook',
      external_thread_id: 'POST_COMMENT1',
      participant_name: 'Viewer',
      status: 'open',
      kind: 'comment_thread',
      last_message_at: NOW.toISOString(),
      last_message_preview: 'Comment',
      is_read: false,
      read_at: null,
      client_id: null,
      external_url: null,
      metadata: { readOnly: true },
      sync_error: null,
    });
    const detail = await getInboxConversation(actor(), store, created.row.id, { limit: 20 }, { adminRepo: store });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.replySupported).toBe(false);
    expect(detail.data.replyLimitation).toContain('Page API documents moderation/respond-to-comment tasks');
  });

  it('reports per-account connected providers, unread filters and tenant-scoped search', async () => {
    const store = repo();
    await syncedConversation(store);
    const unread = await listInbox(actor(), store, {
      limit: 30, offset: 0, unreadOnly: true, query: 'help',
    });
    expect(unread.ok).toBe(true);
    if (!unread.ok) return;
    expect(unread.data.unreadCount).toBe(1);
    expect(unread.data.conversations).toHaveLength(1);
    expect(unread.data.accounts[0]!.platform).toBe('youtube');
    expect(unread.data.providers.find((entry) => entry.platform === 'youtube')?.syncMode).toBe('polling');
  });
});

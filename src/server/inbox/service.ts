import { createHash } from 'node:crypto';
import { fail, ok, type ServiceResult } from '@/lib/result';
import { checkPermission } from '@/server/auth/permissions';
import { getJobRepository } from '@/server/db';
import type { NibrexoRepository } from '@/server/db/types';
import { inboxProviderStatuses, getInboxAdapter, type NormalizedInboxThread } from '@/server/integrations/social/inbox';
import type { ProviderError, ProviderHttp } from '@/server/social/providers';
import { defaultProviderHttp } from '@/server/social/providers';
import { resolveTokenKeyring, type TokenKeyring } from '@/server/social/crypto';
import { ensureFreshAccessToken } from '@/server/social/service';
import { writeAudit } from '@/server/manager/audit';
import type { ActorContext, SocialAccount, SocialPlatform, UUID } from '@/types/domain';
import type { ManagerIssue } from '@/types/manager';
import type {
  InboxConversation,
  InboxConversationQuery,
  InboxMessage,
  InboxMessageQuery,
  InboxParticipant,
  InboxReplyAttemptStatus,
  InboxSyncState,
} from '@/types/inbox';
import type { InboxListQueryInput } from './validation';

const NIL_USER = '00000000-0000-0000-0000-000000000000';
const DEFAULT_POLL_SECONDS = 10 * 60;
const SYNC_LEASE_SECONDS = 90;
const MAX_PAGES_PER_SYNC = 3;
const MAX_SYNC_ACCOUNTS = 1000;

export interface InboxServiceDeps {
  /** Service-role repository; injectable so tests never need live Supabase. */
  adminRepo?: NibrexoRepository;
  keyring?: TokenKeyring;
  http?: ProviderHttp;
  now?: () => Date;
}

export interface InboxListResult {
  conversations: InboxConversation[];
  unreadCount: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  accounts: Array<Pick<SocialAccount, 'id' | 'platform' | 'name' | 'status'>>;
  providers: ReturnType<typeof inboxProviderStatuses>;
}

export interface InboxConversationDetail {
  conversation: InboxConversation;
  messages: InboxMessage[];
  participants: InboxParticipant[];
  account: Pick<SocialAccount, 'id' | 'platform' | 'name' | 'status'> | null;
  replySupported: boolean;
  replyLimitation: string | null;
  syncState: Pick<InboxSyncState, 'last_attempt_at' | 'last_success_at' | 'next_poll_at' | 'consecutive_failures' | 'last_error'> | null;
}

export interface InboxSyncResult {
  accountId: UUID;
  platform: SocialPlatform;
  syncedThreads: number;
  newMessages: number;
  pagesRead: number;
  hasMore: boolean;
  nextPollAt: string;
}

export type SyncActor = ActorContext | null;

const failInbox = (
  code: string,
  message: string,
  errorClass: ManagerIssue['errorClass'],
  retryable = false,
): ServiceResult<never> => fail(code, message, { errorClass, retryable, severity: 'error' });

function can(actor: ActorContext, action: 'view' | 'edit' | 'send'): boolean {
  return checkPermission(actor, { module: 'inbox', action }).allowed;
}

function permissionFailure(actor: ActorContext, action: 'view' | 'edit' | 'send'): ServiceResult<never> {
  const decision = checkPermission(actor, { module: 'inbox', action });
  return failInbox('INBOX_PERMISSION_DENIED', decision.reason, 'permission');
}

function accountView(account: SocialAccount) {
  return {
    id: account.id,
    platform: account.platform,
    name: account.name,
    status: account.status,
  };
}

function nowFrom(deps: InboxServiceDeps): Date {
  return deps.now?.() ?? new Date();
}

function getHttp(deps: InboxServiceDeps): ProviderHttp {
  return deps.http ?? defaultProviderHttp();
}

function getKeyring(deps: InboxServiceDeps): { keyring: TokenKeyring } | { issue: ManagerIssue } {
  if (deps.keyring) return { keyring: deps.keyring };
  const result = resolveTokenKeyring();
  if (!result.ok) return { issue: result.error };
  return { keyring: result.keyring };
}

async function getAdminRepo(deps: InboxServiceDeps): Promise<{ repo: NibrexoRepository } | { issue: ManagerIssue }> {
  if (deps.adminRepo) return { repo: deps.adminRepo };
  const result = getJobRepository();
  if (!result.ok) return { issue: result.error };
  return { repo: result.data };
}

function providerFailure(error: unknown, platform: SocialPlatform): {
  code: string;
  message: string;
  retryable: boolean;
  errorClass: ManagerIssue['errorClass'];
} {
  const provider = error as Partial<ProviderError>;
  if (provider && typeof provider === 'object' && typeof provider.code === 'string') {
    if (provider.code === 'INVALID_GRANT' || provider.code === 'REFRESH_NOT_GRANTED') {
      return {
        code: 'INBOX_REAUTH_REQUIRED',
        message: `${platformLabel(platform)} authorization expired or was revoked. Reconnect the account before syncing again.`,
        retryable: false,
        errorClass: 'auth',
      };
    }
    if (provider.code === 'RATE_LIMITED') {
      return {
        code: 'INBOX_PROVIDER_RATE_LIMITED',
        message: `${platformLabel(platform)} is rate limiting inbox requests. The sync will retry later.`,
        retryable: true,
        errorClass: 'rate_limit',
      };
    }
    if (provider.status === 401 || provider.status === 403) {
      return {
        code: 'INBOX_PROVIDER_PERMISSION',
        message: `${platformLabel(platform)} rejected inbox access. Reauthorize the account and confirm the listed inbox permissions.`,
        retryable: false,
        errorClass: 'auth',
      };
    }
    if (provider.retryable) {
      return {
        code: 'INBOX_PROVIDER_TEMPORARY',
        message: `${platformLabel(platform)} inbox service is temporarily unavailable. The sync will retry.`,
        retryable: true,
        errorClass: 'network',
      };
    }
  }
  if (error instanceof Error && /fetch failed|timeout|network|ECONN/i.test(error.message)) {
    return {
      code: 'INBOX_PROVIDER_TEMPORARY',
      message: `${platformLabel(platform)} inbox service could not be reached. The sync will retry.`,
      retryable: true,
      errorClass: 'network',
    };
  }
  return {
    code: 'INBOX_PROVIDER_ERROR',
    message: `${platformLabel(platform)} could not complete the inbox request. Review the connection and try again.`,
    retryable: false,
    errorClass: 'server',
  };
}

function platformLabel(platform: SocialPlatform): string {
  return platform === 'youtube' ? 'YouTube' : platform === 'facebook' ? 'Facebook' : platform;
}

function systemActor(account: SocialAccount, actor: SyncActor): ActorContext {
  if (actor) return actor;
  return {
    userId: account.connected_by ?? NIL_USER,
    organizationId: account.organization_id,
    role: 'owner',
    email: null,
    fullName: null,
    isDevIdentity: false,
  };
}

async function logInboxAudit(
  repo: NibrexoRepository,
  organizationId: UUID,
  actor: SyncActor,
  action: string,
  entityType: string,
  entityId: UUID | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await repo.activityLogs.insert({
      organization_id: organizationId,
      actor_id: actor?.userId ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    } as never);
  } catch {
    // Inbox writes are never rolled back because an audit sink is unavailable.
  }
}

async function findCredentialScopes(
  repo: NibrexoRepository,
  organizationId: UUID,
  accountId: UUID,
): Promise<string[] | null> {
  const credentials = await repo.socialCredentials.list(organizationId, { limit: 100 });
  const credential = credentials.find((row) => row.account_id === accountId);
  return credential ? credential.scopes : null;
}

function missingScope(adapter: NonNullable<ReturnType<typeof getInboxAdapter>>, scopes: string[], required: string[]): string | null {
  const missing = required.filter((scope) => !scopes.includes(scope));
  if (missing.length === 0) return null;
  return `${adapter.label} inbox access needs reauthorization for: ${missing.join(', ')}. Existing token scopes are not expanded by refresh.`;
}

async function tokenForAccount(
  repo: NibrexoRepository,
  account: SocialAccount,
  actor: SyncActor,
  requiredScopes: string[],
  deps: InboxServiceDeps,
): Promise<{ accessToken: string } | { issue: ManagerIssue }> {
  const adapter = getInboxAdapter(account.platform);
  if (!adapter) {
    return { issue: { code: 'INBOX_UNSUPPORTED', message: `${platformLabel(account.platform)} inbox sync is not supported.`, severity: 'warning', retryable: false, errorClass: 'unsupported' } };
  }
  const scopes = await findCredentialScopes(repo, account.organization_id, account.id);
  if (!scopes) {
    return { issue: { code: 'INBOX_REAUTH_REQUIRED', message: 'Stored social credentials are missing. Reconnect the account.', severity: 'error', retryable: false, errorClass: 'auth' } };
  }
  const missing = missingScope(adapter, scopes, requiredScopes);
  if (missing) {
    return { issue: { code: 'INBOX_REAUTH_REQUIRED', message: missing, severity: 'error', retryable: false, errorClass: 'auth' } };
  }
  const keyring = getKeyring(deps);
  if ('issue' in keyring) return { issue: keyring.issue };
  const refreshed = await ensureFreshAccessToken(
    repo,
    systemActor(account, actor),
    account,
    keyring.keyring,
    getHttp(deps),
    nowFrom(deps),
  );
  if (!refreshed.ok) {
    return {
      issue: {
        code: refreshed.reauth ? 'INBOX_REAUTH_REQUIRED' : 'INBOX_TOKEN_UNAVAILABLE',
        message: refreshed.reauth
          ? `${platformLabel(account.platform)} authorization needs attention. Reconnect the account before syncing.`
          : `${platformLabel(account.platform)} credentials could not be refreshed. Try again later.`,
        severity: 'error',
        retryable: 'retryable' in refreshed ? refreshed.retryable : false,
        errorClass: refreshed.reauth ? 'auth' : 'network',
      },
    };
  }
  return { accessToken: refreshed.accessToken };
}

function previewFor(thread: NormalizedInboxThread): string | null {
  const preview = thread.lastMessagePreview ?? thread.messages.at(-1)?.body ?? null;
  return preview?.trim().slice(0, 500) || null;
}

async function persistThread(
  repo: NibrexoRepository,
  account: SocialAccount,
  thread: NormalizedInboxThread,
): Promise<{ newMessages: number; conversationId: UUID | null }> {
  if (thread.messages.length === 0) return { newMessages: 0, conversationId: null };
  const result = await repo.inbox.upsertConversation({
    organization_id: account.organization_id,
    account_id: account.id,
    platform: account.platform,
    external_thread_id: thread.externalId,
    participant_name: thread.participantName,
    status: thread.status,
    kind: thread.kind,
    last_message_at: thread.lastMessageAt,
    last_message_preview: previewFor(thread),
    is_read: true,
    read_at: null,
    client_id: null,
    external_url: thread.externalUrl,
    metadata: thread.metadata,
    sync_error: null,
  });

  let newMessages = 0;
  const participantCache = new Map<string, InboxParticipant>();
  let inboundAdded = false;
  for (const message of thread.messages) {
    const participant = participantCache.get(message.participant.externalId) ?? await repo.inbox.upsertParticipant({
      organization_id: account.organization_id,
      conversation_id: result.row.id,
      external_participant_id: message.participant.externalId,
      display_name: message.participant.displayName,
      username: message.participant.username ?? null,
      avatar_url: message.participant.avatarUrl ?? null,
      profile_url: message.participant.profileUrl ?? null,
      participant_type: message.participant.type,
      metadata: {},
    });
    participantCache.set(message.participant.externalId, participant);
    const stored = await repo.inbox.upsertMessage({
      organization_id: account.organization_id,
      conversation_id: result.row.id,
      external_message_id: message.externalId,
      direction: message.direction,
      kind: message.kind,
      body: message.body,
      participant_id: participant.id,
      status: message.direction === 'outbound' ? 'sent' : 'received',
      sent_at: message.sentAt,
      attachments: message.attachments,
      provider_url: message.providerUrl,
      metadata: message.metadata,
      ai_draft: null,
    });
    if (stored.inserted) {
      newMessages += 1;
      if (message.direction === 'inbound') inboundAdded = true;
    }
  }
  if (inboundAdded) {
    await repo.inbox.updateConversation(result.row.id, account.organization_id, {
      is_read: false,
      read_at: null,
    });
  }
  return { newMessages, conversationId: result.row.id };
}

function retryDelaySeconds(failureCount: number): number {
  return Math.min(60 * 60, 60 * 2 ** Math.min(Math.max(0, failureCount - 1), 6));
}

async function syncAccountInternal(
  actor: SyncActor,
  repo: NibrexoRepository,
  account: SocialAccount,
  deps: InboxServiceDeps,
): Promise<ServiceResult<InboxSyncResult>> {
  const adapter = getInboxAdapter(account.platform);
  if (!adapter || !adapter.readComments) {
    return failInbox('INBOX_UNSUPPORTED', `${platformLabel(account.platform)} inbox reading is not implemented.`, 'unsupported');
  }
  if (account.status !== 'connected') {
    return failInbox('INBOX_ACCOUNT_DISCONNECTED', 'Reconnect this social account before syncing inbox conversations.', 'auth');
  }

  const now = nowFrom(deps);
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + SYNC_LEASE_SECONDS * 1000).toISOString();
  const claimed = await repo.inbox.claimSyncLease(account.organization_id, account.id, account.platform, nowIso, leaseUntil);
  if (!claimed) {
    return failInbox('INBOX_SYNC_IN_PROGRESS', 'An inbox sync is already running for this connected account.', 'validation', true);
  }

  const currentState = await repo.inbox.getSyncState(account.organization_id, account.id);
  const cursor: Record<string, unknown> = currentState?.cursor ?? {};
  try {
    const token = await tokenForAccount(repo, account, actor, adapter.readScopes, deps);
    if ('issue' in token) {
      const failureCount = (currentState?.consecutive_failures ?? 0) + 1;
      const retryAt = new Date(now.getTime() + retryDelaySeconds(failureCount) * 1000).toISOString();
      await repo.inbox.upsertSyncState({
        organization_id: account.organization_id,
        account_id: account.id,
        platform: account.platform,
        cursor,
        last_attempt_at: nowIso,
        last_success_at: currentState?.last_success_at ?? null,
        next_poll_at: retryAt,
        lease_until: null,
        consecutive_failures: failureCount,
        last_error: token.issue.code,
      });
      return { ok: false, error: token.issue };
    }

    let pageToken = typeof cursor.pageToken === 'string' ? cursor.pageToken : undefined;
    let hasMore = false;
    let pagesRead = 0;
    let syncedThreads = 0;
    let newMessages = 0;
    let nextCursor = cursor;

    do {
      const page = await adapter.syncPage({
        account,
        accessToken: token.accessToken,
        ...(pageToken ? { pageToken } : {}),
        cursor: nextCursor,
        http: getHttp(deps),
      });
      pagesRead += page.pageCount;
      nextCursor = page.cursor;
      hasMore = page.hasMore;
      for (const thread of page.threads) {
        const persisted = await persistThread(repo, account, thread);
        if (persisted.conversationId) syncedThreads += 1;
        newMessages += persisted.newMessages;
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && pagesRead < MAX_PAGES_PER_SYNC);

    const nextPollAt = new Date(now.getTime() + DEFAULT_POLL_SECONDS * 1000).toISOString();
    const updatedCursor: Record<string, unknown> = { ...nextCursor };
    updatedCursor.lastSuccessAt = account.platform === 'facebook' && hasMore && typeof cursor.lastSuccessAt === 'string'
      ? cursor.lastSuccessAt
      : nowIso;
    if (pageToken) updatedCursor.pageToken = pageToken;
    else delete updatedCursor.pageToken;
    await repo.inbox.upsertSyncState({
      organization_id: account.organization_id,
      account_id: account.id,
      platform: account.platform,
      cursor: updatedCursor,
      last_attempt_at: nowIso,
      last_success_at: nowIso,
      next_poll_at: nextPollAt,
      lease_until: null,
      consecutive_failures: 0,
      last_error: null,
    });
    await logInboxAudit(
      repo,
      account.organization_id,
      actor,
      'inbox.sync.completed',
      'social_account',
      account.id,
      { platform: account.platform, syncedThreads, newMessages, pagesRead, hasMore },
    );
    return ok({ accountId: account.id, platform: account.platform, syncedThreads, newMessages, pagesRead, hasMore, nextPollAt });
  } catch (error) {
    const failure = providerFailure(error, account.platform);
    const failureCount = (currentState?.consecutive_failures ?? 0) + 1;
    const retryAt = new Date(now.getTime() + retryDelaySeconds(failureCount) * 1000).toISOString();
    await repo.inbox.upsertSyncState({
      organization_id: account.organization_id,
      account_id: account.id,
      platform: account.platform,
      cursor,
      last_attempt_at: nowIso,
      last_success_at: currentState?.last_success_at ?? null,
      next_poll_at: retryAt,
      lease_until: null,
      consecutive_failures: failureCount,
      last_error: failure.code,
    });
    await logInboxAudit(
      repo,
      account.organization_id,
      actor,
      'inbox.sync.failed',
      'social_account',
      account.id,
      { platform: account.platform, errorCode: failure.code, retryAt },
    );
    return failInbox(failure.code, failure.message, failure.errorClass, failure.retryable);
  }
}

export async function listInbox(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: InboxListQueryInput,
): Promise<ServiceResult<InboxListResult>> {
  if (!can(actor, 'view')) return permissionFailure(actor, 'view');
  const query: InboxConversationQuery = {
    limit: input.limit,
    offset: input.offset,
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.unreadOnly ? { unreadOnly: true } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.query ? { query: input.query } : {}),
  };
  const [page, unreadCount, accounts] = await Promise.all([
    repo.inbox.listConversations(actor.organizationId, query),
    repo.inbox.unreadCount(actor.organizationId),
    repo.socialAccounts.list(actor.organizationId, { limit: 100 }),
  ]);
  return ok({
    conversations: page.rows,
    unreadCount,
    hasMore: page.hasMore,
    limit: input.limit,
    offset: input.offset,
    accounts: accounts.map(accountView),
    providers: inboxProviderStatuses(),
  });
}

export async function getInboxConversation(
  actor: ActorContext,
  repo: NibrexoRepository,
  conversationId: UUID,
  query: InboxMessageQuery,
  deps: InboxServiceDeps = {},
): Promise<ServiceResult<InboxConversationDetail>> {
  if (!can(actor, 'view')) return permissionFailure(actor, 'view');
  const conversation = await repo.inbox.getConversation(conversationId, actor.organizationId);
  if (!conversation) return failInbox('INBOX_CONVERSATION_NOT_FOUND', 'Conversation not found.', 'validation');
  const [messages, participants, account, syncState] = await Promise.all([
    repo.inbox.listMessages(conversationId, actor.organizationId, query),
    repo.inbox.listParticipants(conversationId, actor.organizationId),
    conversation.account_id ? repo.socialAccounts.get(conversation.account_id, actor.organizationId) : null,
    conversation.account_id ? repo.inbox.getSyncState(actor.organizationId, conversation.account_id) : null,
  ]);

  let replySupported = false;
  let replyLimitation: string | null = null;
  const adapter = getInboxAdapter(conversation.platform);
  const providerStatus = inboxProviderStatuses().find((item) => item.platform === conversation.platform);
  if (!adapter?.replyComments || conversation.kind !== 'comment_thread') {
    replyLimitation = providerStatus?.comments.reply.note ?? 'Replies are not available for this provider.';
  } else if (!account || account.status !== 'connected') {
    replyLimitation = 'Reconnect this account before replying.';
  } else if (conversation.metadata.canReply !== true) {
    replyLimitation = 'The provider has not confirmed that this comment thread accepts replies.';
  } else {
    const admin = await getAdminRepo(deps);
    if ('repo' in admin) {
      const scopes = await findCredentialScopes(admin.repo, actor.organizationId, account.id);
      const missing = scopes ? missingScope(adapter, scopes, adapter.replyScopes) : 'Stored credentials are missing.';
      if (missing) replyLimitation = missing;
      else replySupported = true;
    } else {
      replyLimitation = 'Reply readiness could not be checked on the server.';
    }
  }

  return ok({
    conversation,
    messages,
    participants,
    account: account ? accountView(account) : null,
    replySupported,
    replyLimitation,
    syncState: syncState ? {
      last_attempt_at: syncState.last_attempt_at,
      last_success_at: syncState.last_success_at,
      next_poll_at: syncState.next_poll_at,
      consecutive_failures: syncState.consecutive_failures,
      last_error: syncState.last_error,
    } : null,
  });
}

export async function updateInboxConversation(
  actor: ActorContext,
  repo: NibrexoRepository,
  conversationId: UUID,
  patch: Partial<Pick<InboxConversation, 'is_read' | 'status' | 'client_id'>>,
): Promise<ServiceResult<InboxConversation>> {
  if (!can(actor, 'edit')) return permissionFailure(actor, 'edit');
  const existing = await repo.inbox.getConversation(conversationId, actor.organizationId);
  if (!existing) return failInbox('INBOX_CONVERSATION_NOT_FOUND', 'Conversation not found.', 'validation');
  if (patch.client_id !== null && patch.client_id !== undefined) {
    const client = await repo.clients.get(patch.client_id, actor.organizationId);
    if (!client) return failInbox('INBOX_CLIENT_NOT_FOUND', 'Client record not found in this organization.', 'validation');
  }
  const updated = await repo.inbox.updateConversation(conversationId, actor.organizationId, {
    ...patch,
    ...(patch.is_read !== undefined ? { read_at: patch.is_read ? nowFrom({}).toISOString() : null } : {}),
  });
  if (!updated) return failInbox('INBOX_CONVERSATION_NOT_FOUND', 'Conversation not found.', 'validation');
  await writeAudit(repo, actor, {
    action: 'inbox.conversation.updated',
    entityType: 'conversation',
    entityId: conversationId,
    metadata: {
      ...(patch.is_read !== undefined ? { isRead: patch.is_read } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.client_id !== undefined ? { clientLinked: patch.client_id !== null } : {}),
    },
  });
  return ok(updated);
}

export async function saveReplyDraft(
  actor: ActorContext,
  repo: NibrexoRepository,
  conversationId: UUID,
  messageId: UUID,
  draft: string | null,
  deps: InboxServiceDeps = {},
): Promise<ServiceResult<{ messageId: UUID; draft: string | null }>> {
  if (!can(actor, 'edit')) return permissionFailure(actor, 'edit');
  const conversation = await repo.inbox.getConversation(conversationId, actor.organizationId);
  if (!conversation) return failInbox('INBOX_CONVERSATION_NOT_FOUND', 'Conversation not found.', 'validation');
  const message = await repo.inbox.getMessage(messageId, conversationId, actor.organizationId);
  if (!message) return failInbox('INBOX_MESSAGE_NOT_FOUND', 'Message not found in this conversation.', 'validation');
  const admin = await getAdminRepo(deps);
  if ('issue' in admin) return { ok: false, error: admin.issue };
  const updated = await admin.repo.inbox.updateMessageDraft(messageId, conversationId, actor.organizationId, draft?.trim() || null);
  if (!updated) return failInbox('INBOX_MESSAGE_NOT_FOUND', 'Message not found in this conversation.', 'validation');
  await writeAudit(repo, actor, {
    action: 'inbox.reply.draft_saved',
    entityType: 'message',
    entityId: messageId,
    metadata: { conversationId, hasDraft: Boolean(updated.ai_draft) },
  });
  return ok({ messageId, draft: updated.ai_draft });
}

export async function syncInboxAccount(
  actor: ActorContext,
  requestRepo: NibrexoRepository,
  accountId: UUID,
  deps: InboxServiceDeps = {},
): Promise<ServiceResult<InboxSyncResult>> {
  if (!can(actor, 'edit')) return permissionFailure(actor, 'edit');
  const visibleAccount = await requestRepo.socialAccounts.get(accountId, actor.organizationId);
  if (!visibleAccount) return failInbox('INBOX_ACCOUNT_NOT_FOUND', 'Connected account not found.', 'validation');
  const adapter = getInboxAdapter(visibleAccount.platform);
  if (!adapter) return failInbox('INBOX_UNSUPPORTED', `${platformLabel(visibleAccount.platform)} inbox sync is not implemented.`, 'unsupported');
  const admin = await getAdminRepo(deps);
  if ('issue' in admin) return { ok: false, error: admin.issue };
  const account = await admin.repo.socialAccounts.get(accountId, actor.organizationId);
  if (!account || account.platform !== visibleAccount.platform) {
    return failInbox('INBOX_ACCOUNT_NOT_FOUND', 'Connected account not found.', 'validation');
  }
  return syncAccountInternal(actor, admin.repo, account, deps);
}

export async function syncAllDueInboxAccounts(
  deps: InboxServiceDeps = {},
): Promise<ServiceResult<{ checked: number; synced: number; failed: number; skipped: number }>> {
  const admin = await getAdminRepo(deps);
  if ('issue' in admin) return { ok: false, error: admin.issue };
  const repo = admin.repo;
  const accounts = await repo.inbox.listAccountsForSync(['youtube', 'facebook']);
  const now = nowFrom(deps);
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  for (const account of accounts.slice(0, MAX_SYNC_ACCOUNTS)) {
    const state = await repo.inbox.getSyncState(account.organization_id, account.id);
    if (state?.next_poll_at && Date.parse(state.next_poll_at) > now.getTime()) {
      skipped += 1;
      continue;
    }
    if (state?.lease_until && Date.parse(state.lease_until) > now.getTime()) {
      skipped += 1;
      continue;
    }
    const result = await syncAccountInternal(null, repo, account, deps);
    if (result.ok) synced += 1;
    else if (result.error.code === 'INBOX_SYNC_IN_PROGRESS') skipped += 1;
    else failed += 1;
  }
  return ok({ checked: Math.min(accounts.length, MAX_SYNC_ACCOUNTS), synced, failed, skipped });
}

export async function sendInboxReply(
  actor: ActorContext,
  requestRepo: NibrexoRepository,
  conversationId: UUID,
  body: string,
  idempotencyKey: string,
  deps: InboxServiceDeps = {},
): Promise<ServiceResult<{ status: 'sent' | 'already_sent'; message: InboxMessage }>> {
  if (!can(actor, 'send')) return permissionFailure(actor, 'send');
  const visibleConversation = await requestRepo.inbox.getConversation(conversationId, actor.organizationId);
  if (!visibleConversation) return failInbox('INBOX_CONVERSATION_NOT_FOUND', 'Conversation not found.', 'validation');
  if (!visibleConversation.account_id) return failInbox('INBOX_ACCOUNT_NOT_FOUND', 'This conversation is no longer connected to a social account.', 'validation');
  const visibleAccount = await requestRepo.socialAccounts.get(visibleConversation.account_id, actor.organizationId);
  if (!visibleAccount || visibleAccount.platform !== visibleConversation.platform) {
    return failInbox('INBOX_ACCOUNT_NOT_FOUND', 'Connected account not found.', 'validation');
  }
  const adapter = getInboxAdapter(visibleConversation.platform);
  if (!adapter?.replyComments || !adapter.reply) {
    return failInbox('INBOX_REPLY_UNSUPPORTED', inboxProviderStatuses().find((entry) => entry.platform === visibleConversation.platform)?.comments.reply.note ?? 'Replies are not supported for this provider.', 'unsupported');
  }
  if (visibleConversation.kind !== 'comment_thread' || visibleConversation.metadata.canReply !== true) {
    return failInbox('INBOX_REPLY_UNAVAILABLE', 'The provider has not confirmed that this comment thread accepts replies.', 'unsupported');
  }
  if (visibleConversation.status !== 'open') {
    return failInbox('INBOX_CONVERSATION_CLOSED', 'Reopen this conversation before replying.', 'validation');
  }

  const admin = await getAdminRepo(deps);
  if ('issue' in admin) return { ok: false, error: admin.issue };
  const conversation = await admin.repo.inbox.getConversation(conversationId, actor.organizationId);
  const account = await admin.repo.socialAccounts.get(visibleAccount.id, actor.organizationId);
  if (
    !conversation ||
    !account ||
    conversation.account_id !== account.id ||
    conversation.platform !== account.platform ||
    account.status !== 'connected'
  ) {
    return failInbox('INBOX_ACCOUNT_NOT_FOUND', 'Connected account not found.', 'validation');
  }

  const token = await tokenForAccount(admin.repo, account, actor, adapter.replyScopes, deps);
  if ('issue' in token) return { ok: false, error: token.issue };

  const hash = createHash('sha256')
    .update(`${actor.organizationId}\n${account.id}\n${conversationId}\n${body.trim()}`)
    .digest('hex');
  const prior = await admin.repo.inbox.findReplyAttempt(actor.organizationId, idempotencyKey);
  if (prior) {
    if (prior.request_hash !== hash || prior.conversation_id !== conversationId || prior.account_id !== account.id) {
      return failInbox('INBOX_IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different reply.', 'validation');
    }
    if (prior.status === 'sent' && prior.provider_message_id) {
      const storedMessages = await admin.repo.inbox.listMessages(conversationId, actor.organizationId, { limit: 100 });
      const message = storedMessages.find((item) => item.external_message_id === prior.provider_message_id);
      if (message) return ok({ status: 'already_sent', message });
      return failInbox('INBOX_REPLY_ALREADY_SENT', 'This reply was already sent. Refresh the conversation to load it.', 'validation');
    }
    if (prior.status === 'unknown') {
      return failInbox('INBOX_REPLY_UNCERTAIN', 'The provider may have accepted this reply. Refresh the thread before attempting another send.', 'validation');
    }
    if (prior.status === 'pending') {
      return failInbox('INBOX_REPLY_IN_PROGRESS', 'This reply is already being processed.', 'validation', true);
    }
    return failInbox('INBOX_REPLY_FAILED', 'This idempotency key already records a failed attempt. Use a new key only after checking the provider thread.', 'validation');
  }
  const unresolved = await admin.repo.inbox.findUnresolvedReplyAttempt(actor.organizationId, conversationId);
  if (unresolved) {
    return failInbox(
      unresolved.status === 'unknown' ? 'INBOX_REPLY_UNCERTAIN' : 'INBOX_REPLY_IN_PROGRESS',
      unresolved.status === 'unknown'
        ? 'A prior reply may have been accepted. Refresh the provider thread and resolve that attempt before sending another reply.'
        : 'A reply is already being processed for this thread.',
      'validation',
      unresolved.status === 'pending',
    );
  }

  const claimed = await admin.repo.inbox.claimReplyAttempt({
    organization_id: actor.organizationId,
    account_id: account.id,
    conversation_id: conversationId,
    idempotency_key: idempotencyKey,
    request_hash: hash,
    status: 'pending',
    provider_message_id: null,
    error_code: null,
    created_by: actor.userId,
  });
  if (!claimed.created) {
    return failInbox('INBOX_REPLY_IN_PROGRESS', 'This reply is already being processed. Refresh the conversation before retrying.', 'validation', true);
  }

  try {
    const sent = await adapter.reply({
      account,
      accessToken: token.accessToken,
      externalThreadId: conversation.external_thread_id,
      text: body.trim(),
      http: getHttp(deps),
    });
    const participant = await admin.repo.inbox.upsertParticipant({
      organization_id: actor.organizationId,
      conversation_id: conversationId,
      external_participant_id: sent.participant.externalId,
      display_name: sent.participant.displayName,
      username: sent.participant.username ?? null,
      avatar_url: sent.participant.avatarUrl ?? null,
      profile_url: sent.participant.profileUrl ?? null,
      participant_type: 'account',
      metadata: {},
    });
    const messageResult = await admin.repo.inbox.upsertMessage({
      organization_id: actor.organizationId,
      conversation_id: conversationId,
      external_message_id: sent.externalMessageId,
      direction: 'outbound',
      kind: 'comment_reply',
      body: sent.body,
      participant_id: participant.id,
      status: 'sent',
      sent_at: sent.sentAt,
      attachments: [],
      provider_url: sent.providerUrl,
      metadata: sent.metadata,
      ai_draft: null,
    });
    await admin.repo.inbox.updateConversation(conversationId, actor.organizationId, {
      last_message_at: sent.sentAt,
      last_message_preview: sent.body.slice(0, 500),
    });
    const attempt = await admin.repo.inbox.updateReplyAttempt(claimed.row.id, actor.organizationId, {
      status: 'sent',
      provider_message_id: sent.externalMessageId,
      error_code: null,
    });
    if (!attempt) return failInbox('INBOX_REPLY_STATE_FAILED', 'The reply was sent but its delivery record could not be updated. Refresh the thread.', 'server');
    await writeAudit(requestRepo, actor, {
      action: 'inbox.reply.sent',
      entityType: 'conversation',
      entityId: conversationId,
      metadata: {
        platform: account.platform,
        messageId: messageResult.row.id,
        idempotencyKeyHash: createHash('sha256').update(idempotencyKey).digest('hex'),
        verification: sent.verification,
        humanConfirmed: true,
      },
    });
    return ok({ status: 'sent', message: messageResult.row });
  } catch (error) {
    const provider = error as Partial<ProviderError>;
    const safeFailure = providerFailure(error, account.platform);
    const uncertain =
      !(error && typeof error === 'object' && typeof provider.code === 'string') ||
      provider.code === 'PROVIDER_MALFORMED' ||
      provider.retryable === true ||
      (typeof provider.status === 'number' && provider.status >= 500);
    const status: InboxReplyAttemptStatus = uncertain ? 'unknown' : 'failed';
    await admin.repo.inbox.updateReplyAttempt(claimed.row.id, actor.organizationId, {
      status,
      error_code: uncertain ? 'PROVIDER_ACCEPTANCE_UNCONFIRMED' : safeFailure.code,
    });
    await logInboxAudit(
      requestRepo,
      actor.organizationId,
      actor,
      'inbox.reply.failed',
      'conversation',
      conversationId,
      { platform: account.platform, errorCode: safeFailure.code, outcome: status },
    );
    return failInbox(
      uncertain ? 'INBOX_REPLY_UNCERTAIN' : safeFailure.code,
      uncertain
        ? 'The provider may have accepted this reply, but confirmation failed. Refresh the thread before attempting another send.'
        : safeFailure.message,
      uncertain ? 'unknown' : safeFailure.errorClass,
      false,
    );
  }
}

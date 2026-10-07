import { newId } from '@/lib/id';
import type { SocialAccount, SocialPlatform, UUID } from '@/types/domain';
import type {
  InboxConversation,
  InboxConversationInsert,
  InboxConversationQuery,
  InboxDataAccess,
  InboxMessage,
  InboxMessageInsert,
  InboxMessageQuery,
  InboxParticipant,
  InboxParticipantInsert,
  InboxReplyAttempt,
  InboxReplyAttemptInsert,
  InboxSyncState,
  InboxSyncStateUpsert,
  InboxWebhookReceipt,
  InboxWebhookReceiptInsert,
} from '@/types/inbox';
import type { Store } from './memory-repository';

function now(): string {
  return new Date().toISOString();
}

function table(store: Store, name: string): Map<string, Record<string, unknown>> {
  let value = store.get(name);
  if (!value) {
    value = new Map();
    store.set(name, value);
  }
  return value;
}

function complete<T extends { id?: UUID; created_at?: string; updated_at?: string }>(row: T) {
  const timestamp = now();
  return {
    ...row,
    id: row.id ?? newId(),
    created_at: row.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

function contains(value: unknown, query: string): boolean {
  return typeof value === 'string' && value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function newestFirst(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')) ||
    String(b.id ?? '').localeCompare(String(a.id ?? ''));
}

export function createMemoryInboxRepository(store: Store): InboxDataAccess {
  const conversations = () => table(store, 'conversations');
  const messages = () => table(store, 'messages');
  const participants = () => table(store, 'inbox_participants');
  const syncStates = () => table(store, 'inbox_sync_states');
  const replyAttempts = () => table(store, 'inbox_reply_attempts');
  const webhookReceipts = () => table(store, 'inbox_webhook_receipts');

  return {
    async listConversations(organizationId: UUID, filters: InboxConversationQuery) {
      const search = filters.query?.trim() ?? '';
      const matching = [...conversations().values()].filter((row) => {
        if (row.organization_id !== organizationId) return false;
        if (filters.platform && row.platform !== filters.platform) return false;
        if (filters.accountId && row.account_id !== filters.accountId) return false;
        if (filters.unreadOnly && row.is_read !== false) return false;
        if (filters.status && row.status !== filters.status) return false;
        if (!search) return true;
        const hasMessage = [...messages().values()].some(
          (message) => message.conversation_id === row.id && message.organization_id === organizationId && contains(message.body, search),
        );
        return contains(row.participant_name, search) || contains(row.last_message_preview, search) || hasMessage;
      });
      matching.sort(newestFirst);
      const offset = Math.max(0, filters.offset);
      const limit = Math.max(1, Math.min(100, filters.limit));
      const page = matching.slice(offset, offset + limit + 1);
      return { rows: page.slice(0, limit) as unknown as InboxConversation[], hasMore: page.length > limit };
    },

    async unreadCount(organizationId) {
      return [...conversations().values()].filter(
        (row) => row.organization_id === organizationId && row.is_read === false,
      ).length;
    },

    async getConversation(id, organizationId) {
      const row = conversations().get(id);
      if (!row || row.organization_id !== organizationId) return null;
      return row as unknown as InboxConversation;
    },

    async findConversationByExternal(organizationId, accountId, platform, externalThreadId) {
      const row = [...conversations().values()].find(
        (entry) => entry.organization_id === organizationId &&
          entry.account_id === accountId &&
          entry.platform === platform &&
          entry.external_thread_id === externalThreadId,
      );
      return (row as unknown as InboxConversation) ?? null;
    },

    async listMessages(conversationId, organizationId, query: InboxMessageQuery) {
      const parent = conversations().get(conversationId);
      if (!parent || parent.organization_id !== organizationId) return [];
      const found = [...messages().values()].filter((row) => {
        if (row.organization_id !== organizationId || row.conversation_id !== conversationId) return false;
        if (query.before && String(row.sent_at ?? '') >= query.before) return false;
        return true;
      });
      found.sort((a, b) => String(b.sent_at ?? '').localeCompare(String(a.sent_at ?? '')) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
      return found.slice(0, Math.max(1, Math.min(100, query.limit))).reverse() as unknown as InboxMessage[];
    },

    async getMessage(id, conversationId, organizationId) {
      const row = messages().get(id);
      if (!row || row.organization_id !== organizationId || row.conversation_id !== conversationId) return null;
      return row as unknown as InboxMessage;
    },

    async updateMessageDraft(id, conversationId, organizationId, draft) {
      const row = messages().get(id);
      if (!row || row.organization_id !== organizationId || row.conversation_id !== conversationId) return null;
      const updated = { ...row, ai_draft: draft, updated_at: now() };
      messages().set(id, updated);
      return updated as unknown as InboxMessage;
    },

    async listParticipants(conversationId, organizationId) {
      const parent = conversations().get(conversationId);
      if (!parent || parent.organization_id !== organizationId) return [];
      return [...participants().values()]
        .filter((row) => row.organization_id === organizationId && row.conversation_id === conversationId)
        .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))) as unknown as InboxParticipant[];
    },

    async upsertConversation(row: InboxConversationInsert) {
      const existing = await this.findConversationByExternal(
        row.organization_id,
        row.account_id as UUID,
        row.platform,
        row.external_thread_id,
      );
      if (existing) {
        const next: Record<string, unknown> = {
          ...existing,
          participant_name: row.participant_name,
          kind: row.kind,
          external_url: row.external_url,
          metadata: row.metadata,
          sync_error: row.sync_error,
          updated_at: now(),
        };
        if (row.last_message_at && (!existing.last_message_at || row.last_message_at > existing.last_message_at)) {
          next.last_message_at = row.last_message_at;
          next.last_message_preview = row.last_message_preview;
        }
        conversations().set(existing.id, next);
        return { row: next as unknown as InboxConversation, inserted: false };
      }
      const created = complete(row);
      conversations().set(created.id, created as unknown as Record<string, unknown>);
      return { row: created as unknown as InboxConversation, inserted: true };
    },

    async updateConversation(id, organizationId, patch) {
      const existing = conversations().get(id);
      if (!existing || existing.organization_id !== organizationId) return null;
      const next = {
        ...existing,
        ...patch,
        id: existing.id,
        organization_id: existing.organization_id,
        account_id: existing.account_id,
        platform: existing.platform,
        external_thread_id: existing.external_thread_id,
        updated_at: now(),
      };
      conversations().set(id, next as unknown as Record<string, unknown>);
      return next as unknown as InboxConversation;
    },

    async upsertMessage(row: InboxMessageInsert) {
      const existing = [...messages().values()].find(
        (entry) => entry.organization_id === row.organization_id &&
          entry.conversation_id === row.conversation_id &&
          entry.external_message_id === row.external_message_id,
      );
      if (existing) {
        const next = {
          ...existing,
          ...row,
          ai_draft: existing.ai_draft ?? row.ai_draft,
          id: existing.id,
          created_at: existing.created_at,
          updated_at: now(),
        };
        messages().set(existing.id as string, next as unknown as Record<string, unknown>);
        return { row: next as unknown as InboxMessage, inserted: false };
      }
      const created = complete(row);
      messages().set(created.id, created as unknown as Record<string, unknown>);
      return { row: created as unknown as InboxMessage, inserted: true };
    },

    async upsertParticipant(row: InboxParticipantInsert) {
      const existing = [...participants().values()].find(
        (entry) => entry.organization_id === row.organization_id &&
          entry.conversation_id === row.conversation_id &&
          entry.external_participant_id === row.external_participant_id,
      );
      if (existing) {
        const next = { ...existing, ...row, id: existing.id, created_at: existing.created_at, updated_at: now() };
        participants().set(existing.id as string, next as unknown as Record<string, unknown>);
        return next as unknown as InboxParticipant;
      }
      const created = complete(row);
      participants().set(created.id, created as unknown as Record<string, unknown>);
      return created as unknown as InboxParticipant;
    },

    async getSyncState(organizationId, accountId) {
      const row = [...syncStates().values()].find(
        (entry) => entry.organization_id === organizationId && entry.account_id === accountId,
      );
      return (row as unknown as InboxSyncState) ?? null;
    },

    async claimSyncLease(organizationId, accountId, platform, nowIso, leaseUntil) {
      const existing = await this.getSyncState(organizationId, accountId);
      if (existing) {
        if (existing.lease_until && Date.parse(existing.lease_until) > Date.parse(nowIso)) return false;
        const updated = {
          ...existing,
          platform,
          lease_until: leaseUntil,
          last_attempt_at: nowIso,
          updated_at: nowIso,
        };
        syncStates().set(existing.id, updated as unknown as Record<string, unknown>);
        return true;
      }
      const leaseRow: InboxSyncStateUpsert = {
        organization_id: organizationId,
        account_id: accountId,
        platform,
        cursor: {},
        last_attempt_at: nowIso,
        last_success_at: null,
        next_poll_at: null,
        lease_until: leaseUntil,
        consecutive_failures: 0,
        last_error: null,
      };
      const created = complete(leaseRow);
      syncStates().set(created.id, created as unknown as Record<string, unknown>);
      return true;
    },

    async upsertSyncState(row: InboxSyncStateUpsert) {
      const existing = await this.getSyncState(row.organization_id, row.account_id);
      const next = complete({ ...row, ...(existing ? { id: existing.id, created_at: existing.created_at } : {}) });
      syncStates().set(next.id, next as unknown as Record<string, unknown>);
      return next as unknown as InboxSyncState;
    },

    async claimReplyAttempt(row: InboxReplyAttemptInsert) {
      const existing = [...replyAttempts().values()].find(
        (entry) => entry.organization_id === row.organization_id && entry.idempotency_key === row.idempotency_key,
      );
      if (existing) return { row: existing as unknown as InboxReplyAttempt, created: false };
      const unresolved = [...replyAttempts().values()].find(
        (entry) => entry.organization_id === row.organization_id &&
          entry.conversation_id === row.conversation_id &&
          (entry.status === 'pending' || entry.status === 'unknown'),
      );
      if (unresolved) return { row: unresolved as unknown as InboxReplyAttempt, created: false };
      const created = complete(row);
      replyAttempts().set(created.id, created as unknown as Record<string, unknown>);
      return { row: created as unknown as InboxReplyAttempt, created: true };
    },

    async findReplyAttempt(organizationId, idempotencyKey) {
      const row = [...replyAttempts().values()].find(
        (entry) => entry.organization_id === organizationId && entry.idempotency_key === idempotencyKey,
      );
      return (row as unknown as InboxReplyAttempt) ?? null;
    },

    async findUnresolvedReplyAttempt(organizationId, conversationId) {
      const row = [...replyAttempts().values()]
        .filter((entry) => entry.organization_id === organizationId &&
          entry.conversation_id === conversationId &&
          (entry.status === 'pending' || entry.status === 'unknown'))
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
      return (row as unknown as InboxReplyAttempt) ?? null;
    },

    async updateReplyAttempt(id, organizationId, patch) {
      const existing = replyAttempts().get(id);
      if (!existing || existing.organization_id !== organizationId) return null;
      const next = { ...existing, ...patch, id: existing.id, organization_id: existing.organization_id, updated_at: now() };
      replyAttempts().set(id, next as unknown as Record<string, unknown>);
      return next as unknown as InboxReplyAttempt;
    },

    async findWebhookAccounts(platform: SocialPlatform, externalAccountId: string) {
      return [...table(store, 'social_accounts').values()].filter(
        (row) => row.platform === platform && row.external_account_id === externalAccountId && row.status === 'connected',
      ) as unknown as SocialAccount[];
    },

    async claimWebhookReceipt(row: InboxWebhookReceiptInsert) {
      const existing = [...webhookReceipts().values()].find(
        (entry) => entry.account_id === row.account_id && entry.provider_event_key === row.provider_event_key,
      );
      if (existing && existing.status !== 'failed') return { row: existing as unknown as InboxWebhookReceipt, claimed: false };
      if (existing) {
        const retried = { ...existing, status: 'processing', error_code: null, updated_at: now() };
        webhookReceipts().set(existing.id as string, retried as unknown as Record<string, unknown>);
        return { row: retried as unknown as InboxWebhookReceipt, claimed: true };
      }
      const created = complete(row);
      webhookReceipts().set(created.id, created as unknown as Record<string, unknown>);
      return { row: created as unknown as InboxWebhookReceipt, claimed: true };
    },

    async updateWebhookReceipt(id, organizationId, patch) {
      const existing = webhookReceipts().get(id);
      if (!existing || existing.organization_id !== organizationId) return null;
      const next = { ...existing, ...patch, id: existing.id, organization_id: existing.organization_id, updated_at: now() };
      webhookReceipts().set(id, next as unknown as Record<string, unknown>);
      return next as unknown as InboxWebhookReceipt;
    },

    async listAccountsForSync(platforms: SocialPlatform[]) {
      const allowed = new Set(platforms);
      return [...table(store, 'social_accounts').values()].filter(
        (row) => allowed.has(row.platform as SocialPlatform) && row.status === 'connected',
      ) as unknown as SocialAccount[];
    },
  };
}

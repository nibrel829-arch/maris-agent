import type { SupabaseClient } from '@supabase/supabase-js';
import { newId } from '@/lib/id';
import type { SocialAccount, SocialPlatform, UUID } from '@/types/domain';
import type {
  InboxConversation,
  InboxConversationInsert,
  InboxConversationQuery,
  InboxDataAccess,
  InboxMessage,
  InboxMessageInsert,
  InboxParticipant,
  InboxParticipantInsert,
  InboxReplyAttempt,
  InboxReplyAttemptInsert,
  InboxSyncState,
  InboxSyncStateUpsert,
  InboxWebhookReceipt,
  InboxWebhookReceiptInsert,
} from '@/types/inbox';

function databaseError(label: string): Error {
  // Do not include provider URLs, tokens, raw request payloads or SQL parameters.
  return new Error(`Supabase inbox ${label} failed.`);
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505' || error?.code === '409';
}

function withIdentity<T extends { id?: UUID; created_at?: string; updated_at?: string }>(row: T) {
  const now = new Date().toISOString();
  return {
    ...row,
    id: row.id ?? newId(),
    created_at: row.created_at ?? now,
    updated_at: now,
  };
}

export function createSupabaseInboxRepository(client: SupabaseClient): InboxDataAccess {
  const selectConversations = (organizationId: UUID, filters: InboxConversationQuery) => {
    const query = client.from('conversations').select('*').eq('organization_id', organizationId);
    if (filters.platform) query.eq('platform', filters.platform);
    if (filters.accountId) query.eq('account_id', filters.accountId);
    if (filters.unreadOnly) query.eq('is_read', false);
    if (filters.status) query.eq('status', filters.status);
    return query;
  };

  const findConversationByExternal = async (
    organizationId: UUID,
    accountId: UUID,
    platform: SocialPlatform,
    externalThreadId: string,
  ): Promise<InboxConversation | null> => {
    const { data, error } = await client
      .from('conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('account_id', accountId)
      .eq('platform', platform)
      .eq('external_thread_id', externalThreadId)
      .maybeSingle();
    if (error) throw databaseError('conversation lookup');
    return (data as unknown as InboxConversation) ?? null;
  };

  return {
    async listConversations(organizationId, filters) {
      const limit = Math.max(1, Math.min(100, filters.limit));
      const offset = Math.max(0, filters.offset);
      let rows: InboxConversation[];

      if (!filters.query) {
        const { data, error } = await selectConversations(organizationId, filters)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false })
          .range(offset, offset + limit);
        if (error) throw databaseError('conversation list');
        rows = (data ?? []) as unknown as InboxConversation[];
      } else {
        const pattern = `%${filters.query}%`;
        const base = (column: string) =>
          selectConversations(organizationId, filters).ilike(column, pattern).limit(500);
        const [byName, byPreview, byMessage] = await Promise.all([
          base('participant_name'),
          base('last_message_preview'),
          client
            .from('messages')
            .select('conversation_id')
            .eq('organization_id', organizationId)
            .ilike('body', pattern)
            .limit(500),
        ]);
        const [names, previews, messages] = await Promise.all([
          byName,
          byPreview,
          byMessage,
        ]);
        if (names.error || previews.error || messages.error) throw databaseError('conversation search');
        const ids = new Set<string>();
        for (const row of [...(names.data ?? []), ...(previews.data ?? [])] as Array<{ id: string }>) ids.add(row.id);
        for (const row of (messages.data ?? []) as Array<{ conversation_id: string }>) ids.add(row.conversation_id);
        if (ids.size === 0) return { rows: [], hasMore: false };
        const { data, error } = await selectConversations(organizationId, filters)
          .in('id', [...ids])
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false });
        if (error) throw databaseError('conversation search results');
        rows = (data ?? []) as unknown as InboxConversation[];
        rows = rows.slice(offset, offset + limit + 1);
      }

      const hasMore = rows.length > limit;
      return { rows: rows.slice(0, limit), hasMore };
    },

    async unreadCount(organizationId) {
      const { count, error } = await client
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('is_read', false);
      if (error) throw databaseError('unread count');
      return count ?? 0;
    },

    async getConversation(id, organizationId) {
      const { data, error } = await client
        .from('conversations')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error) throw databaseError('conversation detail');
      return (data as unknown as InboxConversation) ?? null;
    },

    findConversationByExternal,

    async listMessages(conversationId, organizationId, query) {
      const parent = await this.getConversation(conversationId, organizationId);
      if (!parent) return [];
      let request = client
        .from('messages')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('conversation_id', conversationId);
      if (query.before) request = request.lt('sent_at', query.before);
      const { data, error } = await request
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(Math.max(1, Math.min(100, query.limit)));
      if (error) throw databaseError('message list');
      return ((data ?? []) as unknown as InboxMessage[]).reverse();
    },

    async getMessage(id, conversationId, organizationId) {
      const { data, error } = await client
        .from('messages')
        .select('*')
        .eq('id', id)
        .eq('conversation_id', conversationId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error) throw databaseError('message detail');
      return (data as unknown as InboxMessage) ?? null;
    },

    async updateMessageDraft(id, conversationId, organizationId, draft) {
      const { data, error } = await client
        .from('messages')
        .update({ ai_draft: draft, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('conversation_id', conversationId)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
      if (error) throw databaseError('message draft update');
      return (data as unknown as InboxMessage) ?? null;
    },

    async listParticipants(conversationId, organizationId) {
      const parent = await this.getConversation(conversationId, organizationId);
      if (!parent) return [];
      const { data, error } = await client
        .from('inbox_participants')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('conversation_id', conversationId)
        .order('display_name', { ascending: true });
      if (error) throw databaseError('participant list');
      return (data ?? []) as unknown as InboxParticipant[];
    },

    async upsertConversation(row: InboxConversationInsert) {
      const payload = withIdentity(row);
      const { data, error } = await client.from('conversations').insert(payload).select('*').single();
      if (!error && data) return { row: data as unknown as InboxConversation, inserted: true };
      if (!isUniqueViolation(error)) throw databaseError('conversation upsert');
      const existing = await findConversationByExternal(
        row.organization_id,
        row.account_id as UUID,
        row.platform,
        row.external_thread_id,
      );
      if (!existing) throw databaseError('conversation conflict lookup');
      const patch: Partial<InboxConversation> = {
        participant_name: row.participant_name,
        kind: row.kind,
        external_url: row.external_url,
        metadata: row.metadata,
        sync_error: row.sync_error,
      };
      if (row.last_message_at && (!existing.last_message_at || row.last_message_at > existing.last_message_at)) {
        patch.last_message_at = row.last_message_at;
        patch.last_message_preview = row.last_message_preview;
      }
      const updated = await this.updateConversation(existing.id, row.organization_id, patch);
      if (!updated) throw databaseError('conversation update');
      return { row: updated, inserted: false };
    },

    async updateConversation(id, organizationId, patch) {
      const payload = { ...patch, updated_at: new Date().toISOString() } as Record<string, unknown>;
      delete payload.id;
      delete payload.organization_id;
      delete payload.account_id;
      delete payload.platform;
      delete payload.external_thread_id;
      const { data, error } = await client
        .from('conversations')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
      if (error) throw databaseError('conversation update');
      return (data as unknown as InboxConversation) ?? null;
    },

    async upsertMessage(row: InboxMessageInsert) {
      const payload = withIdentity(row);
      const { data, error } = await client.from('messages').insert(payload).select('*').single();
      if (!error && data) return { row: data as unknown as InboxMessage, inserted: true };
      if (!isUniqueViolation(error)) throw databaseError('message upsert');
      const { data: existing, error: lookupError } = await client
        .from('messages')
        .select('*')
        .eq('organization_id', row.organization_id)
        .eq('conversation_id', row.conversation_id)
        .eq('external_message_id', row.external_message_id)
        .maybeSingle();
      if (lookupError || !existing) throw databaseError('message conflict lookup');
      const previous = existing as unknown as InboxMessage;
      const { data: updated, error: updateError } = await client
        .from('messages')
        .update({
          body: row.body,
          direction: row.direction,
          kind: row.kind,
          participant_id: row.participant_id,
          sent_at: row.sent_at,
          attachments: row.attachments,
          provider_url: row.provider_url,
          metadata: row.metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', previous.id)
        .eq('organization_id', row.organization_id)
        .select('*')
        .single();
      if (updateError || !updated) throw databaseError('message update');
      return { row: updated as unknown as InboxMessage, inserted: false };
    },

    async upsertParticipant(row: InboxParticipantInsert) {
      const payload = withIdentity(row);
      const { data, error } = await client.from('inbox_participants').insert(payload).select('*').single();
      if (!error && data) return data as unknown as InboxParticipant;
      if (!isUniqueViolation(error)) throw databaseError('participant upsert');
      const { data: existing, error: lookupError } = await client
        .from('inbox_participants')
        .select('*')
        .eq('organization_id', row.organization_id)
        .eq('conversation_id', row.conversation_id)
        .eq('external_participant_id', row.external_participant_id)
        .maybeSingle();
      if (lookupError || !existing) throw databaseError('participant conflict lookup');
      const previous = existing as unknown as InboxParticipant;
      const { data: updated, error: updateError } = await client
        .from('inbox_participants')
        .update({
          display_name: row.display_name,
          username: row.username,
          avatar_url: row.avatar_url,
          profile_url: row.profile_url,
          participant_type: row.participant_type,
          metadata: row.metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', previous.id)
        .eq('organization_id', row.organization_id)
        .select('*')
        .single();
      if (updateError || !updated) throw databaseError('participant update');
      return updated as unknown as InboxParticipant;
    },

    async getSyncState(organizationId, accountId) {
      const { data, error } = await client
        .from('inbox_sync_states')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (error) throw databaseError('sync state read');
      return (data as unknown as InboxSyncState) ?? null;
    },

    async claimSyncLease(organizationId, accountId, platform, now, leaseUntil) {
      const existing = await this.getSyncState(organizationId, accountId);
      if (existing) {
        const { data, error } = await client
          .from('inbox_sync_states')
          .update({ lease_until: leaseUntil, last_attempt_at: now, updated_at: now })
          .eq('id', existing.id)
          .eq('organization_id', organizationId)
          .eq('account_id', accountId)
          .or(`lease_until.is.null,lease_until.lte.${now}`)
          .select('id')
          .maybeSingle();
        if (error) throw databaseError('sync lease claim');
        return Boolean(data);
      }
      const { error } = await client.from('inbox_sync_states').insert({
        organization_id: organizationId,
        account_id: accountId,
        platform,
        cursor: {},
        last_attempt_at: now,
        lease_until: leaseUntil,
      });
      if (!error) return true;
      if (isUniqueViolation(error)) return false;
      throw databaseError('sync lease create');
    },

    async upsertSyncState(row: InboxSyncStateUpsert) {
      const payload = withIdentity(row);
      const { data, error } = await client
        .from('inbox_sync_states')
        .upsert(payload, { onConflict: 'organization_id,account_id' })
        .select('*')
        .single();
      if (error || !data) throw databaseError('sync state write');
      return data as unknown as InboxSyncState;
    },

    async claimReplyAttempt(row: InboxReplyAttemptInsert) {
      const payload = withIdentity(row);
      const { data, error } = await client.from('inbox_reply_attempts').insert(payload).select('*').single();
      if (!error && data) return { row: data as unknown as InboxReplyAttempt, created: true };
      if (!isUniqueViolation(error)) throw databaseError('reply claim');
      const existing = await this.findReplyAttempt(row.organization_id, row.idempotency_key);
      if (existing) return { row: existing, created: false };
      const unresolved = await this.findUnresolvedReplyAttempt(row.organization_id, row.conversation_id);
      if (unresolved) return { row: unresolved, created: false };
      throw databaseError('reply idempotency lookup');
    },

    async findReplyAttempt(organizationId, idempotencyKey) {
      const { data, error } = await client
        .from('inbox_reply_attempts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (error) throw databaseError('reply lookup');
      return (data as unknown as InboxReplyAttempt) ?? null;
    },

    async findUnresolvedReplyAttempt(organizationId, conversationId) {
      const { data, error } = await client
        .from('inbox_reply_attempts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('conversation_id', conversationId)
        .in('status', ['pending', 'unknown'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw databaseError('unresolved reply lookup');
      return (data as unknown as InboxReplyAttempt) ?? null;
    },

    async updateReplyAttempt(id, organizationId, patch) {
      const payload = { ...patch, updated_at: new Date().toISOString() } as Record<string, unknown>;
      delete payload.id;
      delete payload.organization_id;
      delete payload.account_id;
      delete payload.conversation_id;
      delete payload.idempotency_key;
      const { data, error } = await client
        .from('inbox_reply_attempts')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
      if (error) throw databaseError('reply state update');
      return (data as unknown as InboxReplyAttempt) ?? null;
    },

    async findWebhookAccounts(platform, externalAccountId) {
      const { data, error } = await client
        .from('social_accounts')
        .select('*')
        .eq('platform', platform)
        .eq('external_account_id', externalAccountId)
        .eq('status', 'connected')
        .limit(100);
      if (error) throw databaseError('webhook account lookup');
      return (data ?? []) as unknown as SocialAccount[];
    },

    async claimWebhookReceipt(row: InboxWebhookReceiptInsert) {
      const payload = withIdentity(row);
      const { data, error } = await client.from('inbox_webhook_receipts').insert(payload).select('*').single();
      if (!error && data) return { row: data as unknown as InboxWebhookReceipt, claimed: true };
      if (!isUniqueViolation(error)) throw databaseError('webhook event claim');
      const { data: existing, error: lookupError } = await client
        .from('inbox_webhook_receipts')
        .select('*')
        .eq('account_id', row.account_id)
        .eq('provider_event_key', row.provider_event_key)
        .maybeSingle();
      if (lookupError || !existing) throw databaseError('webhook replay lookup');
      const receipt = existing as unknown as InboxWebhookReceipt;
      if (receipt.status === 'failed') {
        const { data: retry, error: retryError } = await client
          .from('inbox_webhook_receipts')
          .update({ status: 'processing', error_code: null, updated_at: new Date().toISOString() })
          .eq('id', receipt.id)
          .eq('organization_id', row.organization_id)
          .eq('status', 'failed')
          .select('*')
          .maybeSingle();
        if (retryError) throw databaseError('webhook retry claim');
        if (retry) return { row: retry as unknown as InboxWebhookReceipt, claimed: true };
      }
      return { row: receipt, claimed: false };
    },

    async updateWebhookReceipt(id, organizationId, patch) {
      const payload = { ...patch, updated_at: new Date().toISOString() } as Record<string, unknown>;
      delete payload.id;
      delete payload.organization_id;
      delete payload.account_id;
      delete payload.provider_event_key;
      const { data, error } = await client
        .from('inbox_webhook_receipts')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
      if (error) throw databaseError('webhook receipt update');
      return (data as unknown as InboxWebhookReceipt) ?? null;
    },

    async listAccountsForSync(platforms) {
      if (platforms.length === 0) return [];
      const { data, error } = await client
        .from('social_accounts')
        .select('*')
        .in('platform', platforms)
        .eq('status', 'connected')
        .limit(1000);
      if (error) throw databaseError('connected inbox account list');
      return (data ?? []) as unknown as SocialAccount[];
    },
  };
}

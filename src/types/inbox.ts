import type { SocialAccount, SocialPlatform, UUID } from './domain';

export type InboxConversationKind = 'direct_message' | 'comment_thread';
export type InboxMessageKind = 'direct_message' | 'comment' | 'comment_reply';
export type InboxMessageDirection = 'inbound' | 'outbound';
export type InboxMessageStatus = 'received' | 'sent' | 'failed' | 'unknown' | 'deleted';

export interface InboxConversation {
  id: UUID;
  organization_id: UUID;
  account_id: UUID | null;
  platform: SocialPlatform;
  external_thread_id: string;
  participant_name: string | null;
  status: 'open' | 'closed' | 'archived';
  kind: InboxConversationKind;
  last_message_at: string | null;
  last_message_preview: string | null;
  is_read: boolean;
  read_at: string | null;
  client_id: UUID | null;
  external_url: string | null;
  metadata: Record<string, unknown>;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboxParticipant {
  id: UUID;
  organization_id: UUID;
  conversation_id: UUID;
  external_participant_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  participant_type: 'person' | 'account';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface InboxAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'link' | 'unknown';
  label: string;
}

export interface InboxMessage {
  id: UUID;
  organization_id: UUID;
  conversation_id: UUID;
  external_message_id: string;
  direction: InboxMessageDirection;
  kind: InboxMessageKind;
  body: string | null;
  participant_id: UUID | null;
  status: InboxMessageStatus;
  sent_at: string | null;
  attachments: InboxAttachment[];
  provider_url: string | null;
  metadata: Record<string, unknown>;
  ai_draft: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboxSyncState {
  id: UUID;
  organization_id: UUID;
  account_id: UUID;
  platform: SocialPlatform;
  cursor: Record<string, unknown>;
  last_attempt_at: string | null;
  last_success_at: string | null;
  next_poll_at: string | null;
  lease_until: string | null;
  consecutive_failures: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type InboxReplyAttemptStatus = 'pending' | 'sent' | 'failed' | 'unknown';

export interface InboxReplyAttempt {
  id: UUID;
  organization_id: UUID;
  account_id: UUID;
  conversation_id: UUID;
  idempotency_key: string;
  request_hash: string;
  status: InboxReplyAttemptStatus;
  provider_message_id: string | null;
  error_code: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface InboxWebhookReceipt {
  id: UUID;
  organization_id: UUID;
  account_id: UUID;
  provider_event_key: string;
  event_type: string;
  status: 'processing' | 'processed' | 'failed';
  error_code: string | null;
  received_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboxConversationQuery {
  limit: number;
  offset: number;
  platform?: SocialPlatform;
  accountId?: UUID;
  unreadOnly?: boolean;
  status?: InboxConversation['status'];
  query?: string;
}

export interface InboxMessageQuery {
  limit: number;
  before?: string;
}

export type InboxConversationInsert = Omit<InboxConversation, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<InboxConversation, 'id' | 'created_at' | 'updated_at'>>;
export type InboxParticipantInsert = Omit<InboxParticipant, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<InboxParticipant, 'id' | 'created_at' | 'updated_at'>>;
export type InboxMessageInsert = Omit<InboxMessage, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<InboxMessage, 'id' | 'created_at' | 'updated_at'>>;
export type InboxSyncStateUpsert = Omit<InboxSyncState, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<InboxSyncState, 'id' | 'created_at' | 'updated_at'>>;
export type InboxReplyAttemptInsert = Omit<InboxReplyAttempt, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<InboxReplyAttempt, 'id' | 'created_at' | 'updated_at'>>;
export type InboxWebhookReceiptInsert = Omit<InboxWebhookReceipt, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<InboxWebhookReceipt, 'id' | 'created_at' | 'updated_at'>>;

export interface InboxDataAccess {
  listConversations(
    organizationId: UUID,
    query: InboxConversationQuery,
  ): Promise<{ rows: InboxConversation[]; hasMore: boolean }>;
  unreadCount(organizationId: UUID): Promise<number>;
  getConversation(id: UUID, organizationId: UUID): Promise<InboxConversation | null>;
  findConversationByExternal(
    organizationId: UUID,
    accountId: UUID,
    platform: SocialPlatform,
    externalThreadId: string,
  ): Promise<InboxConversation | null>;
  listMessages(
    conversationId: UUID,
    organizationId: UUID,
    query: InboxMessageQuery,
  ): Promise<InboxMessage[]>;
  getMessage(id: UUID, conversationId: UUID, organizationId: UUID): Promise<InboxMessage | null>;
  updateMessageDraft(
    id: UUID,
    conversationId: UUID,
    organizationId: UUID,
    draft: string | null,
  ): Promise<InboxMessage | null>;
  listParticipants(conversationId: UUID, organizationId: UUID): Promise<InboxParticipant[]>;
  upsertConversation(row: InboxConversationInsert): Promise<{ row: InboxConversation; inserted: boolean }>;
  updateConversation(
    id: UUID,
    organizationId: UUID,
    patch: Partial<InboxConversation>,
  ): Promise<InboxConversation | null>;
  upsertMessage(row: InboxMessageInsert): Promise<{ row: InboxMessage; inserted: boolean }>;
  upsertParticipant(row: InboxParticipantInsert): Promise<InboxParticipant>;
  getSyncState(organizationId: UUID, accountId: UUID): Promise<InboxSyncState | null>;
  claimSyncLease(
    organizationId: UUID,
    accountId: UUID,
    platform: SocialPlatform,
    now: string,
    leaseUntil: string,
  ): Promise<boolean>;
  upsertSyncState(row: InboxSyncStateUpsert): Promise<InboxSyncState>;
  claimReplyAttempt(row: InboxReplyAttemptInsert): Promise<{ row: InboxReplyAttempt; created: boolean }>;
  findReplyAttempt(organizationId: UUID, idempotencyKey: string): Promise<InboxReplyAttempt | null>;
  findUnresolvedReplyAttempt(organizationId: UUID, conversationId: UUID): Promise<InboxReplyAttempt | null>;
  updateReplyAttempt(
    id: UUID,
    organizationId: UUID,
    patch: Partial<InboxReplyAttempt>,
  ): Promise<InboxReplyAttempt | null>;
  findWebhookAccounts(platform: SocialPlatform, externalAccountId: string): Promise<SocialAccount[]>;
  claimWebhookReceipt(row: InboxWebhookReceiptInsert): Promise<{ row: InboxWebhookReceipt; claimed: boolean }>;
  updateWebhookReceipt(
    id: UUID,
    organizationId: UUID,
    patch: Partial<InboxWebhookReceipt>,
  ): Promise<InboxWebhookReceipt | null>;
  listAccountsForSync(platforms: SocialPlatform[]): Promise<SocialAccount[]>;
}

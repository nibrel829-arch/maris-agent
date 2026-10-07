import type { SocialAccount, SocialPlatform, UUID } from '@/types/domain';
import type { InboxAttachment, InboxConversationKind, InboxMessageDirection, InboxMessageKind } from '@/types/inbox';
import type { ProviderHttp } from '@/server/social/providers';

export interface NormalizedInboxParticipant {
  externalId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  type: 'person' | 'account';
}

export interface NormalizedInboxMessage {
  externalId: string;
  direction: InboxMessageDirection;
  kind: InboxMessageKind;
  body: string | null;
  participant: NormalizedInboxParticipant;
  sentAt: string | null;
  attachments: InboxAttachment[];
  providerUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface NormalizedInboxThread {
  externalId: string;
  kind: InboxConversationKind;
  status: 'open' | 'closed' | 'archived';
  participantName: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  externalUrl: string | null;
  metadata: Record<string, unknown>;
  messages: NormalizedInboxMessage[];
}

export interface SyncPageInput {
  account: SocialAccount;
  accessToken: string;
  pageToken?: string;
  cursor: Record<string, unknown>;
  http: ProviderHttp;
}

export interface SyncPageOutput {
  threads: NormalizedInboxThread[];
  nextPageToken: string | null;
  cursor: Record<string, unknown>;
  hasMore: boolean;
  pageCount: number;
}

export interface VerifiedReplyInput {
  account: SocialAccount;
  accessToken: string;
  externalThreadId: string;
  text: string;
  http: ProviderHttp;
}

export interface VerifiedReply {
  externalMessageId: string;
  sentAt: string;
  participant: NormalizedInboxParticipant;
  body: string;
  providerUrl: string | null;
  metadata: Record<string, unknown>;
  verification: 'provider_read_back';
}

export interface InboxProviderAdapter {
  platform: 'youtube' | 'facebook';
  label: string;
  readScopes: string[];
  replyScopes: string[];
  readComments: boolean;
  readDirectMessages: boolean;
  replyComments: boolean;
  replyDirectMessages: boolean;
  syncPage(input: SyncPageInput): Promise<SyncPageOutput>;
  reply?(input: VerifiedReplyInput): Promise<VerifiedReply>;
}

export interface InboxAccountRef {
  accountId: UUID;
  organizationId: UUID;
  platform: SocialPlatform;
}

import type { SocialPlatform } from '@/types/domain';
import type { InboxProviderAdapter } from './types';
import { facebookInboxAdapter } from './facebook';
import { youtubeInboxAdapter } from './youtube';

export type InboxCapabilityState = 'active' | 'available_not_integrated' | 'unsupported';

export interface InboxCapability {
  state: InboxCapabilityState;
  note: string;
  docsUrl: string[];
}

export interface InboxProviderStatus {
  platform: SocialPlatform;
  label: string;
  syncMode: 'polling' | 'webhook_and_polling' | 'none';
  comments: { read: InboxCapability; reply: InboxCapability };
  directMessages: { read: InboxCapability; reply: InboxCapability };
  messageTypes: string[];
}

const ADAPTERS: Partial<Record<SocialPlatform, InboxProviderAdapter>> = {
  youtube: youtubeInboxAdapter,
  facebook: facebookInboxAdapter,
};

const supported = (note: string, docsUrl: string[]): InboxCapability => ({ state: 'active', note, docsUrl });
const notIntegrated = (note: string, docsUrl: string[]): InboxCapability => ({
  state: 'available_not_integrated',
  note,
  docsUrl,
});
const unsupported = (note: string, docsUrl: string[]): InboxCapability => ({ state: 'unsupported', note, docsUrl });

/**
 * Official capability matrix reviewed 2026-10-07. `active` means this codebase
 * has an adapter for the capability. `available_not_integrated` means the
 * platform exposes an official API but Nibrexo does not yet call it. `unsupported`
 * means the connected-account API surface cannot provide this inbox capability;
 * no scraping or alternate-platform workaround is attempted.
 */
export const INBOX_PROVIDER_STATUS: Record<SocialPlatform, InboxProviderStatus> = {
  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    syncMode: 'polling',
    comments: {
      read: supported(
        'Reads channel-associated comment threads using YouTube Data API v3. Requires reauthorization with youtube.force-ssl; channels must resolve unambiguously.',
        ['https://developers.google.com/youtube/v3/docs/commentThreads/list', 'https://developers.google.com/youtube/v3/guides/implementation/comments'],
      ),
      reply: supported(
        'Text replies are sent with comments.insert and confirmed by comments.list read-back. Only threads where the API reports canReply are enabled.',
        ['https://developers.google.com/youtube/v3/docs/comments/insert', 'https://developers.google.com/youtube/v3/docs/comments/list'],
      ),
    },
    directMessages: {
      read: unsupported('YouTube Data API v3 does not expose a creator/customer DM inbox.', ['https://developers.google.com/youtube/v3/docs']),
      reply: unsupported('No official YouTube Data API DM reply endpoint is available.', ['https://developers.google.com/youtube/v3/docs']),
    },
    messageTypes: ['text comments and text replies'],
  },
  facebook: {
    platform: 'facebook',
    label: 'Facebook Pages',
    syncMode: 'polling',
    comments: {
      read: supported(
        'Reads comment streams on the 10 most recent managed Page posts through the Page Feed/Comments API, with at most two 100-item comment pages per post per poll. Requires pages_read_engagement and pages_read_user_content. Older feed posts are not paginated. Meta offers Page feed change webhooks, but this adapter currently polls; webhook delivery is not integrated.',
        ['https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed', 'https://developers.facebook.com/docs/graph-api/reference/v26.0/post/comments'],
      ),
      reply: notIntegrated(
        'The Page API documents moderation/respond-to-comment tasks, but the inbox does not send Facebook replies until the current write endpoint and app permission path are integrated and verified.',
        ['https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed', 'https://developers.facebook.com/docs/graph-api/reference/v26.0/comment'],
      ),
    },
    directMessages: {
      read: notIntegrated(
        'Messenger Platform supports Page conversations and webhooks, but Nibrexo currently ingests Page comments only.',
        ['https://developers.facebook.com/docs/messenger-platform/conversations/', 'https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview'],
      ),
      reply: notIntegrated(
        'Messenger Send API is official, but DM ingestion, policy-window enforcement and send are not part of this adapter.',
        ['https://developers.facebook.com/docs/messenger-platform/reference/send-api/'],
      ),
    },
    messageTypes: ['text Page comments; attachment presence/type metadata only'],
  },
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    syncMode: 'none',
    comments: {
      read: notIntegrated(
        'Instagram Login officially supports professional-account comments; the current connection does not request instagram_business_manage_comments.',
        ['https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/', 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/comments/'],
      ),
      reply: notIntegrated(
        'The official Instagram API supports replying to comments, but this adapter and required scope are not yet integrated.',
        ['https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/'],
      ),
    },
    directMessages: {
      read: notIntegrated(
        'The official Instagram Messaging API exposes professional-account messaging and webhooks, but Nibrexo does not ingest DMs.',
        ['https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/', 'https://developers.facebook.com/docs/messenger-platform/conversations/'],
      ),
      reply: notIntegrated(
        'The official Instagram Messaging API can send in-window replies; no DM send adapter is integrated.',
        ['https://developers.facebook.com/docs/messenger-platform/reference/send-api/'],
      ),
    },
    messageTypes: ['not integrated'],
  },
  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn',
    syncMode: 'none',
    comments: {
      read: notIntegrated(
        'Community Management API can read organization comments with approved product access and r_organization_social_feed; it is not in the current OAuth grant.',
        ['https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api?view=li-lms-2026-05', 'https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-01'],
      ),
      reply: notIntegrated(
        'Community Management API can create organization comments with approved access and w_organization_social_feed; it is not integrated.',
        ['https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api?view=li-lms-2026-05'],
      ),
    },
    directMessages: {
      read: unsupported('No general-purpose member DM inbox is exposed by the current LinkedIn social/Community Management API grant.', ['https://learn.microsoft.com/en-us/linkedin/marketing/getting-started']),
      reply: unsupported('No general-purpose member DM reply capability is exposed by the current LinkedIn social API grant.', ['https://learn.microsoft.com/en-us/linkedin/marketing/getting-started']),
    },
    messageTypes: ['not integrated'],
  },
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    syncMode: 'none',
    comments: {
      read: unsupported(
        'The connected Login Kit/Display API does not provide an organic creator comment inbox. The Research API comment query is read-only and restricted to approved research use.',
        ['https://developers.tiktok.com/docs/en/research-api-specs-query-video-comments', 'https://developers.tiktok.com/products/research-api/'],
      ),
      reply: unsupported(
        'No organic creator-comment reply endpoint is available through the connected TikTok API. Ads comment operations are limited to eligible ad comments and are not an account inbox.',
        ['https://developers.tiktok.com/docs/en/research-api-specs-query-video-comments', 'https://business-api.tiktok.com/portal/docs/reply-to-a-comment/v1.3'],
      ),
    },
    directMessages: {
      read: unsupported(
        'Data Portability can provide authorized message-history exports in eligible regions; it is not a live conversation inbox or sync endpoint.',
        ['https://developers.tiktok.com/products/data-portability-api/', 'https://developers.tiktok.com/docs/en/data-portability-data-types'],
      ),
      reply: unsupported('TikTok Data Portability message exports do not provide an official DM reply endpoint.', ['https://developers.tiktok.com/products/data-portability-api/']),
    },
    messageTypes: ['not available for connected creator-account API'],
  },
  pinterest: {
    platform: 'pinterest',
    label: 'Pinterest',
    syncMode: 'none',
    comments: {
      read: unsupported('Pinterest API v5 documents Pins, boards, ads and analytics, but no comment inbox endpoint.', ['https://developers.pinterest.com/docs/api/v5/']),
      reply: unsupported('Pinterest API v5 exposes no comment reply endpoint.', ['https://developers.pinterest.com/docs/api/v5/']),
    },
    directMessages: {
      read: unsupported('Pinterest API v5 exposes no direct-message conversation endpoint.', ['https://developers.pinterest.com/docs/api/v5/']),
      reply: unsupported('Pinterest API v5 exposes no direct-message send endpoint.', ['https://developers.pinterest.com/docs/api/v5/']),
    },
    messageTypes: ['not available'],
  },
  contra: {
    platform: 'contra',
    label: 'Contra',
    syncMode: 'none',
    comments: {
      read: unsupported('No public Contra inbox/comment endpoint is documented for the connected provider surface.', ['https://contra.com/']),
      reply: unsupported('No public Contra inbox/comment reply endpoint is documented.', ['https://contra.com/']),
    },
    directMessages: {
      read: unsupported('No public Contra direct-message inbox endpoint is documented.', ['https://contra.com/']),
      reply: unsupported('No public Contra direct-message send endpoint is documented.', ['https://contra.com/']),
    },
    messageTypes: ['not available'],
  },
};

export function getInboxAdapter(platform: SocialPlatform): InboxProviderAdapter | null {
  return ADAPTERS[platform] ?? null;
}

export function inboxProviderStatuses(): InboxProviderStatus[] {
  const order: SocialPlatform[] = ['youtube', 'facebook', 'instagram', 'linkedin', 'tiktok', 'pinterest', 'contra'];
  return order.map((platform) => INBOX_PROVIDER_STATUS[platform]);
}

export type {
  InboxProviderAdapter,
  NormalizedInboxMessage,
  NormalizedInboxParticipant,
  NormalizedInboxThread,
  SyncPageInput,
  SyncPageOutput,
  VerifiedReply,
  VerifiedReplyInput,
} from './types';
export { youtubeInboxAdapter } from './youtube';
export { facebookInboxAdapter } from './facebook';

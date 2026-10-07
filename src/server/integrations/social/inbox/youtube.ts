import { ProviderError, parseProviderJson, type ProviderHttp } from '@/server/social/providers';
import type {
  InboxProviderAdapter,
  NormalizedInboxMessage,
  NormalizedInboxParticipant,
  NormalizedInboxThread,
  SyncPageInput,
  SyncPageOutput,
  VerifiedReply,
  VerifiedReplyInput,
} from './types';

const API = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_INBOX_READ_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function bool(source: Record<string, unknown> | null, key: string): boolean | null {
  const value = source?.[key];
  return typeof value === 'boolean' ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function authorChannelId(snippet: Record<string, unknown> | null): string | null {
  const channelId = record(snippet?.authorChannelId);
  return str(channelId, 'value');
}

function participantFrom(
  comment: Record<string, unknown>,
  channelId: string,
  channelName: string,
): NormalizedInboxParticipant {
  const snippet = record(comment.snippet);
  const externalId = authorChannelId(snippet) ?? `comment:${str(comment, 'id') ?? 'unknown'}`;
  const accountAuthor = externalId === channelId;
  return {
    externalId,
    displayName: accountAuthor ? channelName : (str(snippet, 'authorDisplayName') ?? 'YouTube user'),
    avatarUrl: str(snippet, 'authorProfileImageUrl'),
    profileUrl: str(snippet, 'authorChannelUrl'),
    type: accountAuthor ? 'account' : 'person',
  };
}

async function providerJson(http: ProviderHttp, url: string, init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string } = { method: 'GET' }): Promise<Record<string, unknown>> {
  const payload = await parseProviderJson(await http(url, init), {
    platform: 'YouTube',
    isInvalidGrant: (_payload, status) => status === 401,
  });
  const parsed = record(payload);
  if (!parsed) throw new ProviderError('PROVIDER_MALFORMED', 'YouTube returned an unreadable response.');
  return parsed;
}

async function resolveChannel(http: ProviderHttp, accessToken: string): Promise<{ id: string; name: string }> {
  const url = `${API}/channels?${new URLSearchParams({ part: 'id,snippet', mine: 'true', maxResults: '50' })}`;
  const payload = await providerJson(http, url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
  const channels = list(payload.items).map(record).filter((item): item is Record<string, unknown> => item !== null);
  if (channels.length !== 1) {
    throw new ProviderError(
      'PROVIDER_MALFORMED',
      channels.length === 0
        ? 'YouTube: the connected Google identity has no accessible channel.'
        : 'YouTube: the connected identity resolves to multiple channels; reconnect with a single channel selected.',
    );
  }
  const channel = channels[0]!;
  const id = str(channel, 'id');
  const name = str(record(channel.snippet), 'title');
  if (!id) throw new ProviderError('PROVIDER_MALFORMED', 'YouTube did not return a channel ID.');
  return { id, name: name ?? 'YouTube channel' };
}

function messageFromComment(
  commentValue: unknown,
  fallbackId: string,
  channelId: string,
  channelName: string,
  threadId: string,
  videoId: string | null,
  kind: 'comment' | 'comment_reply',
): NormalizedInboxMessage | null {
  const comment = record(commentValue);
  if (!comment) return null;
  const snippet = record(comment.snippet);
  if (!snippet) return null;
  const externalId = str(comment, 'id') ?? fallbackId;
  const body = str(snippet, 'textOriginal') ?? str(snippet, 'textDisplay');
  const participant = participantFrom({ ...comment, id: externalId }, channelId, channelName);
  const direction = participant.type === 'account' ? 'outbound' : 'inbound';
  return {
    externalId,
    direction,
    kind,
    body,
    participant,
    sentAt: cleanDate(str(snippet, 'publishedAt')),
    attachments: [],
    providerUrl: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(externalId)}` : null,
    metadata: {
      parentThreadId: threadId,
      ...(videoId ? { videoId } : {}),
      authorChannelId: authorChannelId(snippet),
    },
  };
}

async function syncPage(input: SyncPageInput): Promise<SyncPageOutput> {
  const channel = await resolveChannel(input.http, input.accessToken);
  const query = new URLSearchParams({
    part: 'snippet,replies',
    allThreadsRelatedToChannelId: channel.id,
    maxResults: '100',
    order: 'time',
    textFormat: 'plainText',
  });
  if (input.pageToken) query.set('pageToken', input.pageToken);
  const payload = await providerJson(
    input.http,
    `${API}/commentThreads?${query.toString()}`,
    { method: 'GET', headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  const rawThreads = list(payload.items);
  const threads: NormalizedInboxThread[] = [];

  for (const rawThread of rawThreads) {
    const thread = record(rawThread);
    const snippet = record(thread?.snippet);
    const rootComment = record(snippet?.topLevelComment);
    const threadId = str(thread, 'id');
    if (!threadId || !snippet || !rootComment) continue;
    const videoId = str(snippet, 'videoId');
    const messages: NormalizedInboxMessage[] = [];
    const root = messageFromComment(
      rootComment,
      threadId,
      channel.id,
      channel.name,
      threadId,
      videoId,
      'comment',
    );
    if (root) messages.push(root);

    const rawReplies = list(record(thread?.replies)?.comments);
    for (const rawReply of rawReplies) {
      const reply = record(rawReply);
      if (!reply) continue;
      const normalized = messageFromComment(
        reply,
        `${threadId}:reply:${messages.length}`,
        channel.id,
        channel.name,
        threadId,
        videoId,
        'comment_reply',
      );
      if (normalized) messages.push(normalized);
    }
    messages.sort((a, b) => (Date.parse(a.sentAt ?? '') || 0) - (Date.parse(b.sentAt ?? '') || 0));
    const newest = messages[messages.length - 1] ?? root;
    const replyCount = typeof snippet.totalReplyCount === 'number' ? snippet.totalReplyCount : rawReplies.length;
    const canReply = bool(snippet, 'canReply') === true;
    threads.push({
      externalId: threadId,
      kind: 'comment_thread',
      status: 'open',
      participantName: root?.participant.displayName ?? null,
      lastMessageAt: newest?.sentAt ?? null,
      lastMessagePreview: newest?.body?.slice(0, 500) ?? null,
      externalUrl: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${root?.externalId ? `&lc=${encodeURIComponent(root.externalId)}` : ''}` : null,
      metadata: {
        provider: 'youtube',
        channelId: channel.id,
        channelName: channel.name,
        ...(videoId ? { videoId } : {}),
        canReply,
        replyCount,
        loadedReplyCount: Math.max(0, messages.length - 1),
        repliesComplete: messages.length - 1 >= replyCount,
      },
      messages: root ? messages : [],
    });
  }

  const nextPageToken = str(payload, 'nextPageToken');
  return {
    threads,
    nextPageToken,
    cursor: {
      channelId: channel.id,
      channelName: channel.name,
      lastObservedAt: threads
        .flatMap((thread) => thread.messages.map((message) => message.sentAt).filter((value): value is string => value !== null))
        .sort()
        .at(-1) ?? (typeof input.cursor.lastObservedAt === 'string' ? input.cursor.lastObservedAt : null),
    },
    hasMore: Boolean(nextPageToken),
    pageCount: 1,
  };
}

async function reply(input: VerifiedReplyInput): Promise<VerifiedReply> {
  const url = `${API}/comments?part=snippet`;
  const inserted = await providerJson(input.http, url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        parentId: input.externalThreadId,
        textOriginal: input.text,
      },
    }),
  });
  const insertedId = str(inserted, 'id');
  if (!insertedId) throw new ProviderError('PROVIDER_MALFORMED', 'YouTube accepted no verifiable comment ID.');

  // YouTube returns a durable comment ID, then comments.list verifies that the
  // stored ID belongs to this exact parent and text before Nibrexo reports sent.
  const verifyQuery = new URLSearchParams({ part: 'snippet', id: insertedId, textFormat: 'plainText' });
  const verification = await providerJson(
    input.http,
    `${API}/comments?${verifyQuery.toString()}`,
    { method: 'GET', headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  const verifiedComment = record(list(verification.items)[0]);
  const verifiedSnippet = record(verifiedComment?.snippet);
  const verifiedText = str(verifiedSnippet, 'textOriginal') ?? str(verifiedSnippet, 'textDisplay');
  if (
    str(verifiedComment, 'id') !== insertedId ||
    str(verifiedSnippet, 'parentId') !== input.externalThreadId ||
    verifiedText !== input.text
  ) {
    throw new ProviderError('PROVIDER_MALFORMED', 'YouTube did not confirm the submitted reply.');
  }

  const authorId = authorChannelId(verifiedSnippet) ?? `youtube-account:${input.account.id}`;
  return {
    externalMessageId: insertedId,
    sentAt: cleanDate(str(verifiedSnippet, 'publishedAt')) ?? new Date().toISOString(),
    participant: {
      externalId: authorId,
      displayName: str(verifiedSnippet, 'authorDisplayName') ?? input.account.name,
      type: 'account',
    },
    body: input.text,
    providerUrl: null,
    metadata: { provider: 'youtube', parentThreadId: input.externalThreadId },
    verification: 'provider_read_back',
  };
}

export const youtubeInboxAdapter: InboxProviderAdapter = {
  platform: 'youtube',
  label: 'YouTube',
  readScopes: [YOUTUBE_INBOX_READ_SCOPE],
  replyScopes: [YOUTUBE_INBOX_READ_SCOPE],
  readComments: true,
  readDirectMessages: false,
  replyComments: true,
  replyDirectMessages: false,
  syncPage,
  reply,
};

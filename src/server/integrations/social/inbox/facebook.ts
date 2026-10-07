import { FACEBOOK_GRAPH_VERSION } from '@/server/social/providers/facebook';
import { ProviderError, parseProviderJson, type ProviderHttp } from '@/server/social/providers';
import type {
  InboxProviderAdapter,
  NormalizedInboxMessage,
  NormalizedInboxParticipant,
  NormalizedInboxThread,
  SyncPageInput,
  SyncPageOutput,
} from './types';

const API = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;
const PAGE_SIZE = 10;
const COMMENT_PAGE_SIZE = 100;
const MAX_COMMENT_PAGES_PER_POST = 2;
export const FACEBOOK_COMMENT_READ_SCOPES = ['pages_read_engagement', 'pages_read_user_content'];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeDate(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function graphUrl(path: string, token: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ ...params, access_token: token });
  return `${API}/${path}?${query.toString()}`;
}

async function providerJson(http: ProviderHttp, url: string): Promise<Record<string, unknown>> {
  const payload = await parseProviderJson(await http(url, { method: 'GET' }), {
    platform: 'Facebook',
    isInvalidGrant: (_payload, status) => status === 401,
  });
  const parsed = record(payload);
  if (!parsed) throw new ProviderError('PROVIDER_MALFORMED', 'Facebook returned an unreadable response.');
  return parsed;
}

function attachmentFor(comment: Record<string, unknown>): NormalizedInboxMessage['attachments'] {
  const attachment = record(comment.attachment);
  const kind = str(attachment, 'type');
  if (!kind) return [];
  const normalizedKind = kind.toLowerCase();
  const type = normalizedKind.includes('photo') || normalizedKind.includes('image')
    ? 'image'
    : normalizedKind.includes('video')
      ? 'video'
      : normalizedKind.includes('audio')
        ? 'audio'
        : normalizedKind.includes('link')
          ? 'link'
          : 'unknown';
  return [{ type, label: `Facebook ${type} attachment` }];
}

function normalizeComment(
  comment: Record<string, unknown>,
  pageId: string,
  pageName: string,
  postId: string,
): NormalizedInboxMessage | null {
  const id = str(comment, 'id');
  if (!id) return null;
  const author = record(comment.from);
  const authorId = str(author, 'id') ?? `comment:${id}`;
  const isPage = authorId === pageId;
  const body = str(comment, 'message');
  const parentId = str(record(comment.parent), 'id');
  const created = safeDate(str(comment, 'created_time'));
  const attachmentType = str(record(comment.attachment), 'type');
  const participant: NormalizedInboxParticipant = {
    externalId: authorId,
    displayName: isPage ? pageName : (str(author, 'name') ?? 'Facebook user'),
    type: isPage ? 'account' : 'person',
  };
  return {
    externalId: id,
    direction: isPage ? 'outbound' : 'inbound',
    kind: parentId && parentId !== postId ? 'comment_reply' : 'comment',
    body,
    participant,
    sentAt: created,
    attachments: attachmentFor(comment),
    providerUrl: str(comment, 'permalink_url'),
    metadata: { postId, parentId, ...(attachmentType ? { attachmentType } : {}) },
  };
}

async function syncPage(input: SyncPageInput): Promise<SyncPageOutput> {
  const pageId = input.account.external_account_id;
  const postQuery: Record<string, string> = { fields: 'id,created_time', limit: String(PAGE_SIZE) };
  const cursorTime = typeof input.cursor.lastSuccessAt === 'string' ? Date.parse(input.cursor.lastSuccessAt) : NaN;
  // Page feed is a bounded poll. Overlap the last hour so late provider
  // updates cannot create a gap between scheduled polls.
  const since = Number.isFinite(cursorTime) ? Math.max(0, Math.floor(cursorTime / 1000) - 3600) : null;
  const feedQuery = await providerJson(
    input.http,
    graphUrl(`${encodeURIComponent(pageId)}/feed`, input.accessToken, postQuery),
  );
  const posts = list(feedQuery.data)
    .map(record)
    .filter((post): post is Record<string, unknown> => post !== null && typeof post.id === 'string')
    .slice(0, PAGE_SIZE);

  const commentsByThread = new Map<string, {
    postId: string;
    root: Record<string, unknown> | null;
    messages: NormalizedInboxMessage[];
  }>();
  const savedAfterByPost = record(input.cursor.afterByPost) ?? {};
  const nextAfterByPost: Record<string, string> = { ...savedAfterByPost } as Record<string, string>;
  let hasMore = false;
  let pageCount = 1;

  for (const post of posts) {
    const postId = str(post, 'id');
    if (!postId) continue;
    let pageZeroAfter: string | null = null;
    for (let commentPage = 0; commentPage < MAX_COMMENT_PAGES_PER_POST; commentPage += 1) {
      const params: Record<string, string> = {
        filter: 'stream',
        order: 'reverse_chronological',
        fields: 'id,message,from,created_time,parent,permalink_url,attachment',
        limit: String(COMMENT_PAGE_SIZE),
      };
      if (since !== null) params.since = String(since);
      if (commentPage > 0) {
        const savedAfter = savedAfterByPost[postId];
        const after = typeof savedAfter === 'string' && savedAfter ? savedAfter : pageZeroAfter;
        if (!after) break;
        params.after = after;
      }
      const commentPagePayload = await providerJson(
        input.http,
        graphUrl(`${encodeURIComponent(postId)}/comments`, input.accessToken, params),
      );
      pageCount += 1;
      const rawComments = list(commentPagePayload.data)
        .map(record)
        .filter((comment): comment is Record<string, unknown> => comment !== null);

      // `filter=stream` supplies replies alongside parent IDs. Each top-level
      // comment is a thread; reply comments normalize into that same thread.
      for (const comment of rawComments) {
        const commentId = str(comment, 'id');
        if (!commentId) continue;
        const parentId = str(record(comment.parent), 'id');
        const rootId = parentId && parentId !== postId ? parentId : commentId;
        let group = commentsByThread.get(rootId);
        if (!group) {
          group = { postId, root: null, messages: [] };
          commentsByThread.set(rootId, group);
        }
        const normalized = normalizeComment(comment, pageId, input.account.name, postId);
        if (normalized) group.messages.push(normalized);
        if (commentId === rootId) group.root = comment;
      }

      const paging = record(commentPagePayload.paging);
      const cursors = record(paging?.cursors);
      const next = str(cursors, 'after');
      if (commentPage === 0) pageZeroAfter = next;
      const pageHasNext = Boolean(str(paging, 'next')) && Boolean(next);
      if (commentPage === MAX_COMMENT_PAGES_PER_POST - 1 && pageHasNext) hasMore = true;
      if (!pageHasNext || rawComments.length === 0) {
        if (commentPage > 0) delete nextAfterByPost[postId];
        break;
      }
      if (commentPage === 1 && next) nextAfterByPost[postId] = next;
    }
  }

  const threads: NormalizedInboxThread[] = [];
  for (const [externalId, group] of commentsByThread) {
    const messages = group.messages.sort(
      (a, b) => (Date.parse(a.sentAt ?? '') || 0) - (Date.parse(b.sentAt ?? '') || 0),
    );
    const rootMessage = messages.find((message) => message.externalId === externalId) ?? messages[0];
    const latest = messages[messages.length - 1];
    threads.push({
      externalId,
      kind: 'comment_thread',
      status: 'open',
      participantName: rootMessage?.participant.displayName ?? null,
      lastMessageAt: latest?.sentAt ?? null,
      lastMessagePreview: latest?.body?.slice(0, 500) ?? null,
      externalUrl: rootMessage?.providerUrl ?? null,
      metadata: { provider: 'facebook', pageId, postId: group.postId, readOnly: true },
      messages,
    });
  }

  return {
    threads,
    nextPageToken: null,
    cursor: {
      lastSuccessAt: hasMore && typeof input.cursor.lastSuccessAt === 'string'
        ? input.cursor.lastSuccessAt
        : new Date().toISOString(),
      postCount: posts.length,
      afterByPost: nextAfterByPost,
    },
    hasMore,
    pageCount,
  };
}

export const facebookInboxAdapter: InboxProviderAdapter = {
  platform: 'facebook',
  label: 'Facebook Pages',
  readScopes: FACEBOOK_COMMENT_READ_SCOPES,
  replyScopes: [],
  readComments: true,
  readDirectMessages: false,
  replyComments: false,
  replyDirectMessages: false,
  syncPage,
};

import { describe, expect, it } from 'vitest';
import type { SocialAccount } from '@/types/domain';
import { facebookInboxAdapter } from '@/server/integrations/social/inbox/facebook';
import { youtubeInboxAdapter } from '@/server/integrations/social/inbox/youtube';
import { scriptedHttp, urlContains } from '../helpers/social-http';

const ORG = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = '00000000-0000-0000-0000-0000000000b1';

function account(platform: 'youtube' | 'facebook', externalId: string): SocialAccount {
  return {
    id: ACCOUNT_ID,
    organization_id: ORG,
    platform,
    external_account_id: externalId,
    name: platform === 'youtube' ? 'Test channel' : 'Test Page',
    status: 'connected',
    capabilities: { publish: false, schedule: false, readDm: false, sendDm: false, readComments: false, replyComments: false, analytics: false },
    connected_by: '00000000-0000-0000-0000-0000000000a1',
    last_error: null,
    created_at: '2026-10-07T10:00:00.000Z',
    updated_at: '2026-10-07T10:00:00.000Z',
  };
}

describe('YouTube inbox provider', () => {
  it('reads channel comment threads and normalizes replies without claiming DM support', async () => {
    const http = scriptedHttp([
      {
        match: urlContains('/youtube/v3/channels?'),
        status: 200,
        body: { items: [{ id: 'CHANNEL1', snippet: { title: 'Nibrexo' } }] },
      },
      {
        match: urlContains('/youtube/v3/commentThreads?'),
        status: 200,
        body: {
          items: [{
            id: 'THREAD1',
            snippet: {
              videoId: 'VIDEO1',
              canReply: true,
              totalReplyCount: 1,
              topLevelComment: {
                id: 'COMMENT1',
                snippet: {
                  authorChannelId: { value: 'VIEWER1' },
                  authorDisplayName: 'A viewer',
                  textDisplay: 'Question?',
                  publishedAt: '2026-10-07T10:00:00Z',
                },
              },
            },
            replies: { comments: [{
              id: 'REPLY0',
              snippet: {
                authorChannelId: { value: 'CHANNEL1' },
                authorDisplayName: 'Nibrexo',
                parentId: 'COMMENT1',
                textDisplay: 'We can help.',
                publishedAt: '2026-10-07T10:02:00Z',
              },
            }] },
          }],
          nextPageToken: 'PAGE2',
        },
      },
    ]);
    const result = await youtubeInboxAdapter.syncPage({
      account: account('youtube', 'OPENID1'),
      accessToken: 'SERVER-ONLY-TOKEN',
      cursor: {},
      http,
    });

    expect(http.calls).toHaveLength(2);
    expect(http.calls.every((call) => call.init.headers?.Authorization === 'Bearer SERVER-ONLY-TOKEN')).toBe(true);
    const query = new URL(http.calls[1]!.url).searchParams;
    expect(query.get('allThreadsRelatedToChannelId')).toBe('CHANNEL1');
    expect(query.get('part')).toBe('snippet,replies');
    expect(query.get('textFormat')).toBe('plainText');
    expect(result.nextPageToken).toBe('PAGE2');
    expect(result.hasMore).toBe(true);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]!.metadata.canReply).toBe(true);
    expect(result.threads[0]!.messages.map((message) => message.direction)).toEqual(['inbound', 'outbound']);
    expect(result.threads[0]!.messages[0]!.kind).toBe('comment');
    expect(result.threads[0]!.messages[1]!.kind).toBe('comment_reply');
    expect(youtubeInboxAdapter.readDirectMessages).toBe(false);
  });

  it('refuses an ambiguous Google identity rather than guessing a channel', async () => {
    const http = scriptedHttp([
      {
        match: urlContains('/youtube/v3/channels?'),
        status: 200,
        body: { items: [{ id: 'A' }, { id: 'B' }] },
      },
    ]);
    await expect(youtubeInboxAdapter.syncPage({
      account: account('youtube', 'OPENID1'),
      accessToken: 'TOKEN',
      cursor: {},
      http,
    })).rejects.toMatchObject({ code: 'PROVIDER_MALFORMED' });
  });

  it('inserts only to the verified comment thread and confirms by read-back', async () => {
    const http = scriptedHttp([
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
            textOriginal: 'Thanks for asking.',
            authorChannelId: { value: 'CHANNEL1' },
            authorDisplayName: 'Nibrexo',
            publishedAt: '2026-10-07T10:03:00Z',
          },
        }] },
      },
    ]);
    const reply = await youtubeInboxAdapter.reply!({
      account: account('youtube', 'OPENID1'),
      accessToken: 'SERVER-ONLY-TOKEN',
      externalThreadId: 'THREAD1',
      text: 'Thanks for asking.',
      http,
    });
    expect(http.calls).toHaveLength(2);
    expect(JSON.parse(String(http.calls[0]!.init.body))).toEqual({
      snippet: { parentId: 'THREAD1', textOriginal: 'Thanks for asking.' },
    });
    expect(http.calls[0]!.init.headers?.Authorization).toBe('Bearer SERVER-ONLY-TOKEN');
    expect(reply.externalMessageId).toBe('REPLY1');
    expect(reply.verification).toBe('provider_read_back');
    expect(reply.participant.externalId).toBe('CHANNEL1');
  });

  it('does not report a reply as sent when read-back does not match', async () => {
    const http = scriptedHttp([
      { match: (url, init) => urlContains('/youtube/v3/comments?part=snippet')(url) && init.method === 'POST', status: 200, body: { id: 'REPLY1' } },
      { match: (url, init) => urlContains('/youtube/v3/comments?')(url) && init.method === 'GET', status: 200, body: { items: [] } },
    ]);
    await expect(youtubeInboxAdapter.reply!({
      account: account('youtube', 'OPENID1'),
      accessToken: 'TOKEN',
      externalThreadId: 'THREAD1',
      text: 'Hi',
      http,
    })).rejects.toMatchObject({ code: 'PROVIDER_MALFORMED' });
  });
});

describe('Facebook Pages inbox provider', () => {
  it('polls recent Page posts and comment streams, preserving replies and read-only status', async () => {
    const http = scriptedHttp([
      {
        match: urlContains('/PAGE1/feed?'),
        status: 200,
        body: { data: [{ id: 'POST1', created_time: '2026-10-06T09:00:00Z' }] },
      },
      {
        match: urlContains('/POST1/comments?'),
        status: 200,
        body: {
          data: [
            {
              id: 'ROOT1', message: 'A question', from: { id: 'PERSON1', name: 'A person' },
              created_time: '2026-10-07T09:00:00Z', parent: { id: 'POST1' }, permalink_url: 'https://facebook.com/post/1',
            },
            {
              id: 'PAGE_REPLY1', message: 'A Page response', from: { id: 'PAGE1', name: 'Test Page' },
              created_time: '2026-10-07T09:10:00Z', parent: { id: 'ROOT1' },
            },
          ],
        },
      },
    ]);
    const result = await facebookInboxAdapter.syncPage({
      account: account('facebook', 'PAGE1'),
      accessToken: 'PAGE-SECRET-TOKEN',
      cursor: {},
      http,
    });
    expect(http.calls).toHaveLength(2);
    expect(http.calls[0]!.url).toContain('access_token=PAGE-SECRET-TOKEN');
    expect(new URL(http.calls[1]!.url).searchParams.get('filter')).toBe('stream');
    expect(new URL(http.calls[1]!.url).searchParams.get('order')).toBe('reverse_chronological');
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]!.externalId).toBe('ROOT1');
    expect(result.threads[0]!.messages.map((message) => message.direction)).toEqual(['inbound', 'outbound']);
    expect(result.threads[0]!.metadata.readOnly).toBe(true);
    expect(facebookInboxAdapter.replyComments).toBe(false);
    expect(facebookInboxAdapter.readDirectMessages).toBe(false);
  });
});

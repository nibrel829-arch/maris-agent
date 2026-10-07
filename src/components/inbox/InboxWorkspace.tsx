'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { ArrowUpRightIcon, InboxIcon, PaperPlaneIcon, RefreshIcon, SearchIcon } from '@/components/ui/icons';
import type { InboxConversationDetail, InboxListResult } from '@/server/inbox/service';
import type { InboxConversation, InboxMessage } from '@/types/inbox';
import type { SocialPlatform } from '@/types/domain';

interface InboxWorkspaceProps {
  initialList: InboxListResult;
  initialDetail: InboxConversationDetail | null;
  clientOptions: Array<{ id: string; name: string; company: string | null }>;
  canEdit: boolean;
  canSend: boolean;
  canAssociateClients: boolean;
}

interface ApiError {
  error?: { code?: string; message?: string };
}

const PAGE_SIZE = 30;

function displayPlatform(platform: SocialPlatform): string {
  if (platform === 'facebook') return 'Facebook';
  if (platform === 'youtube') return 'YouTube';
  return platform[0]!.toUpperCase() + platform.slice(1);
}

function stateTone(state: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'active') return 'success';
  if (state === 'available_not_integrated') return 'warning';
  if (state === 'unsupported') return 'neutral';
  return 'danger';
}

function stateLabel(state: string): string {
  if (state === 'active') return 'Integrated';
  if (state === 'available_not_integrated') return 'Not integrated';
  if (state === 'unsupported') return 'Unsupported';
  return state;
}

function formatTime(value: string | null, includeDate = false): string {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, includeDate
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' });
}

function initials(value: string | null): string {
  const parts = (value ?? '?').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiError;
    return payload.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function InboxWorkspace({
  initialList,
  initialDetail,
  clientOptions,
  canEdit,
  canSend,
  canAssociateClients,
}: InboxWorkspaceProps) {
  const [listData, setListData] = useState(initialList);
  const paginationRef = useRef({ offset: initialList.offset, limit: initialList.limit });
  const [detail, setDetail] = useState<InboxConversationDetail | null>(initialDetail);
  const [hasOlderMessages, setHasOlderMessages] = useState(initialDetail?.messages.length === 100);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(initialDetail?.conversation.id ?? null);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [accountId, setAccountId] = useState('');
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [status, setStatus] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const detailRequestRef = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectedAccountCount = listData.accounts.filter((account) => account.status === 'connected').length;
  const syncableAccountIds = useMemo(() => {
    const supported = new Set(
      listData.providers
        .filter((provider) => provider.comments.read.state === 'active')
        .map((provider) => provider.platform),
    );
    return listData.accounts
      .filter((account) => account.status === 'connected' && supported.has(account.platform))
      .map((account) => account.id);
  }, [listData.accounts, listData.providers]);

  const refreshList = useCallback(async (append = false) => {
    setLoadingList(true);
    setError(null);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: append ? String(paginationRef.current.offset + paginationRef.current.limit) : '0' });
    if (search.trim()) query.set('query', search.trim());
    if (platform) query.set('platform', platform);
    if (accountId) query.set('accountId', accountId);
    if (readFilter === 'unread') query.set('unreadOnly', 'true');
    if (status) query.set('status', status);
    try {
      const response = await fetch(`/api/workspace/inbox?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = (await response.json()) as { data: InboxListResult };
      paginationRef.current = { offset: payload.data.offset, limit: payload.data.limit };
      setListData((current) => append
        ? { ...payload.data, conversations: [...current.conversations, ...payload.data.conversations] }
        : payload.data);
      if (!append && activeId && !payload.data.conversations.some((row) => row.id === activeId)) {
        detailRequestRef.current += 1;
        setActiveId(null);
        setDetail(null);
        setLoadingDetail(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load inbox conversations.');
    } finally {
      setLoadingList(false);
    }
  }, [accountId, activeId, platform, readFilter, search, status]);

  const loadDetail = useCallback(async (conversationId: string) => {
    const requestId = ++detailRequestRef.current;
    setActiveId(conversationId);
    setLoadingDetail(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/inbox/${conversationId}?limit=100`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = (await response.json()) as { data: InboxConversationDetail };
      if (requestId !== detailRequestRef.current) return;
      setDetail(payload.data);
      setHasOlderMessages(payload.data.messages.length === 100);
      setReplyText(payload.data.messages.slice().reverse().find((message) => message.ai_draft)?.ai_draft ?? '');
    } catch (caught) {
      if (requestId !== detailRequestRef.current) return;
      setDetail(null);
      setError(caught instanceof Error ? caught.message : 'Could not load this conversation.');
    } finally {
      if (requestId === detailRequestRef.current) setLoadingDetail(false);
    }
  }, []);

  const loadOlderMessages = async () => {
    if (!detail || !hasOlderMessages || loadingOlder) return;
    const requestId = detailRequestRef.current;
    const oldest = detail.messages[0];
    const before = oldest?.sent_at ?? oldest?.created_at;
    if (!oldest || !before) {
      setHasOlderMessages(false);
      return;
    }
    setLoadingOlder(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: '100', before });
      const response = await fetch(`/api/workspace/inbox/${detail.conversation.id}?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = (await response.json()) as { data: InboxConversationDetail };
      if (requestId !== detailRequestRef.current) return;
      setDetail((current) => current?.conversation.id === detail.conversation.id
        ? { ...current, messages: [...payload.data.messages, ...current.messages] }
        : current);
      setHasOlderMessages(payload.data.messages.length === 100);
    } catch (caught) {
      if (requestId !== detailRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshList(false);
    }, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [accountId, platform, readFilter, refreshList, search, status]);

  useEffect(() => {
    if (!activeId && listData.conversations[0]) void loadDetail(listData.conversations[0].id);
  }, [activeId, listData.conversations, loadDetail]);

  const updateConversation = async (patch: Partial<Pick<InboxConversation, 'is_read' | 'status' | 'client_id'>>) => {
    if (!detail || !canEdit) return;
    setUpdating(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/inbox/${detail.conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = (await response.json()) as { data: InboxConversation };
      setDetail((current) => current ? { ...current, conversation: payload.data } : current);
      await refreshList(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the conversation.');
    } finally {
      setUpdating(false);
    }
  };

  const syncAccounts = async () => {
    if (syncing || syncableAccountIds.length === 0) return;
    setSyncing(true);
    setNotice(null);
    setError(null);
    const results: Array<
      | { status: 'success'; platform: SocialPlatform; newMessages: number; hasMore: boolean }
      | { status: 'error'; message: string }
    > = [];
    for (const id of syncableAccountIds) {
      try {
        const response = await fetch(`/api/workspace/inbox/accounts/${id}/sync`, { method: 'POST' });
        if (!response.ok) {
          results.push({ status: 'error', message: await responseError(response) });
          continue;
        }
        const payload = (await response.json()) as { data: { newMessages: number; platform: SocialPlatform; hasMore: boolean } };
        results.push({
          status: 'success',
          platform: payload.data.platform,
          newMessages: payload.data.newMessages,
          hasMore: payload.data.hasMore,
        });
      } catch (caught) {
        results.push({ status: 'error', message: caught instanceof Error ? caught.message : 'Provider sync failed.' });
      }
    }
    let imported = 0;
    for (const result of results) {
      if (result.status === 'success') imported += result.newMessages;
    }
    const failures = results.filter((result) => result.status === 'error');
    const continuationPending = results.some((result) => result.status === 'success' && result.hasMore);
    setNotice(failures.length === 0
      ? `Inbox sync complete. ${imported} new message${imported === 1 ? '' : 's'} imported.${continuationPending ? ' More provider pages remain; run sync again to continue the bounded backfill.' : ''}`
      : `Sync finished with ${failures.length} issue${failures.length === 1 ? '' : 's'}; ${imported} new messages imported. ${failures[0]?.message ?? ''}`);
    setSyncing(false);
    await refreshList(false);
    if (activeId) await loadDetail(activeId);
  };

  const saveDraft = async () => {
    if (!detail || !canEdit || detail.messages.length === 0) return;
    const target = [...detail.messages].reverse().find((message) => message.direction === 'inbound') ?? detail.messages.at(-1);
    if (!target) return;
    setSavingDraft(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/inbox/${detail.conversation.id}/messages/${target.id}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: replyText || null }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(replyText.trim() ? 'Draft saved. It has not been sent.' : 'Draft cleared.');
      await loadDetail(detail.conversation.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || !canSend || !detail.replySupported || !replyText.trim()) return;
    setSending(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/inbox/${detail.conversation.id}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ body: replyText }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setReplyText('');
      setNotice('Reply sent and confirmed by YouTube.');
      await Promise.all([refreshList(false), loadDetail(detail.conversation.id)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reply could not be confirmed.');
    } finally {
      setSending(false);
    }
  };

  const currentRow = detail?.conversation ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-surface-border/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-eyebrow">NIBREXO CEO OPERATING COCKPIT</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="page-title">Unified Inbox</h1>
            <Badge tone="info">{listData.unreadCount} unread</Badge>
          </div>
          <p className="page-description">Tenant-scoped Page comments and YouTube comment threads, with provider limits shown honestly.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-slate-500">{connectedAccountCount} connected accounts</span>
          <button className="btn-primary" disabled={syncing || syncableAccountIds.length === 0} onClick={() => void syncAccounts()} type="button">
            <RefreshIcon className={syncing ? 'animate-spin' : ''} size={16} />
            {syncing ? 'Syncing…' : 'Sync supported accounts'}
          </button>
        </div>
      </div>

      {notice ? <div aria-live="polite" className="rounded-xl border border-brand-300/20 bg-brand-400/[0.08] px-4 py-3 text-sm text-brand-100">{notice}</div> : null}
      {error ? <ErrorState message={error} /> : null}

      <Card className="p-4" title="Conversation filters" action={<span className="text-xs text-slate-500">Search includes participant names and message text</span>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_minmax(130px,0.7fr)_minmax(180px,1fr)_minmax(130px,0.7fr)_minmax(130px,0.7fr)]">
          <label className="relative block">
            <span className="sr-only">Search inbox</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input className="input pl-9" maxLength={120} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" value={search} />
          </label>
          <label>
            <span className="sr-only">Filter by platform</span>
            <select className="input" onChange={(event) => setPlatform(event.target.value)} value={platform}>
              <option value="">All platforms</option>
              {listData.providers.map((provider) => <option key={provider.platform} value={provider.platform}>{provider.label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by account</span>
            <select className="input" onChange={(event) => setAccountId(event.target.value)} value={accountId}>
              <option value="">All connected accounts</option>
              {listData.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {displayPlatform(account.platform)}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by unread state</span>
            <select className="input" onChange={(event) => setReadFilter(event.target.value as 'all' | 'unread')} value={readFilter}>
              <option value="all">Read and unread</option>
              <option value="unread">Unread only</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by conversation status</span>
            <select className="input" onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>
      </Card>

      <div className="grid min-h-[540px] gap-5 xl:grid-cols-[minmax(320px,0.42fr)_minmax(0,0.95fr)]">
        <Card className="flex min-h-[540px] flex-col p-0" title="Conversations" action={<Badge tone={loadingList ? 'warning' : 'neutral'}>{loadingList ? 'Updating' : `${listData.conversations.length}${listData.hasMore ? '+' : ''}`}</Badge>}>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {listData.conversations.length === 0 ? (
              <div className="p-2">
                <EmptyState
                  icon={<InboxIcon size={20} />}
                  title="No matching conversations"
                  description={syncableAccountIds.length > 0
                    ? 'Run a sync for officially supported accounts, or adjust the filters.'
                    : 'Connect an eligible account or review the provider capability notes below.'}
                  action={syncableAccountIds.length > 0 ? <button className="btn-secondary" onClick={() => void syncAccounts()} type="button">Sync now</button> : undefined}
                />
              </div>
            ) : (
              <div className="space-y-1">
                {listData.conversations.map((conversation) => <ConversationListItem
                  active={activeId === conversation.id}
                  conversation={conversation}
                  key={conversation.id}
                  onClick={() => void loadDetail(conversation.id)}
                />)}
              </div>
            )}
            {listData.hasMore ? <button className="btn-ghost mt-2 w-full text-xs" disabled={loadingList} onClick={() => void refreshList(true)} type="button">Load more conversations</button> : null}
          </div>
        </Card>

        <Card className="flex min-h-[540px] flex-col p-0" title="Message timeline" action={currentRow ? <Badge tone={currentRow.is_read ? 'neutral' : 'info'}>{currentRow.is_read ? 'Read' : 'Unread'}</Badge> : null}>
          {!currentRow ? (
            <div className="m-4 flex-1"><EmptyState title="Choose a conversation" description="Select a conversation to review its timeline, provider context and reply options." icon={<InboxIcon size={20} />} /></div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-surface-border/70 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-300/20 bg-brand-400/10 text-xs font-semibold text-brand-100">{initials(currentRow.participant_name)}</span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-white">{currentRow.participant_name ?? 'Conversation'}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone="info">{displayPlatform(currentRow.platform)}</Badge>
                      <span className="text-xs text-slate-500">{detail?.account?.name ?? 'Account disconnected'}</span>
                      <Badge tone={currentRow.status === 'open' ? 'success' : 'neutral'}>{currentRow.status}</Badge>
                    </div>
                    {canEdit && canAssociateClients ? (
                      <label className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-slate-500">CRM client</span>
                        <select
                          aria-label="Associate conversation with a CRM client"
                          className="input min-h-8 max-w-[280px] py-1 text-xs"
                          disabled={updating}
                          onChange={(event) => void updateConversation({ client_id: event.target.value || null })}
                          value={currentRow.client_id ?? ''}
                        >
                          <option value="">No client linked</option>
                          {currentRow.client_id && !clientOptions.some((client) => client.id === currentRow.client_id)
                            ? <option value={currentRow.client_id}>Linked CRM client</option>
                            : null}
                          {clientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}{client.company ? ` · ${client.company}` : ''}</option>)}
                        </select>
                      </label>
                    ) : currentRow.client_id ? <p className="mt-2 text-[11px] text-slate-500">A CRM client is linked to this conversation.</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {currentRow.external_url ? <a className="btn-ghost h-9 px-2 text-xs" href={currentRow.external_url} rel="noreferrer" target="_blank">Open on platform <ArrowUpRightIcon size={14} /></a> : null}
                  {canEdit ? <button className="btn-secondary min-h-9 px-3 text-xs" disabled={updating} onClick={() => void updateConversation({ is_read: !currentRow.is_read })} type="button">Mark {currentRow.is_read ? 'unread' : 'read'}</button> : null}
                  {canEdit ? <select aria-label="Conversation status" className="input min-h-9 w-auto py-1.5 text-xs" disabled={updating} onChange={(event) => void updateConversation({ status: event.target.value as InboxConversation['status'] })} value={currentRow.status}>
                    <option value="open">Open</option><option value="closed">Closed</option><option value="archived">Archived</option>
                  </select> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-surface-border/60 bg-surface/20 px-5 py-2 text-[10px] text-slate-500">
                <span>Last attempt: {formatTime(detail?.syncState?.last_attempt_at ?? null, true)}</span>
                <span>Last success: {formatTime(detail?.syncState?.last_success_at ?? null, true)}</span>
                <span>Next poll: {formatTime(detail?.syncState?.next_poll_at ?? null, true)}</span>
                {detail?.syncState?.consecutive_failures ? <Badge tone="warning">{detail.syncState.consecutive_failures} consecutive sync failures</Badge> : null}
                {detail?.syncState?.last_error ? <span className="text-amber-200">{detail.syncState.last_error}</span> : null}
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
                {hasOlderMessages ? <button className="btn-ghost mx-auto block text-xs" disabled={loadingOlder} onClick={() => void loadOlderMessages()} type="button">{loadingOlder ? 'Loading older messages…' : 'Load older messages'}</button> : null}
                {detail?.conversation.platform === 'youtube' && detail.conversation.metadata.repliesComplete === false ? (
                  <p className="rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100">
                    Partial YouTube thread: showing {Number(detail.conversation.metadata.loadedReplyCount ?? 0)} of {Number(detail.conversation.metadata.replyCount ?? 0)} replies returned in the thread summary. Additional replies are not fetched yet.
                  </p>
                ) : null}
                {loadingDetail ? <div aria-live="polite" className="text-sm text-slate-500">Loading messages…</div> : null}
                {!loadingDetail && detail?.messages.length === 0 ? <EmptyState title="No messages loaded" description="Sync this connected account to retrieve provider-visible comment messages." /> : null}
                {detail?.messages.map((message) => {
                  const participant = detail.participants.find((candidate) => candidate.id === message.participant_id);
                  return <MessageBubble key={message.id} message={message} senderName={participant?.display_name ?? null} />;
                })}
              </div>

              <div className="border-t border-surface-border/70 bg-surface/35 px-4 py-4 sm:px-5">
                {detail?.replySupported ? (
                  <form className="space-y-3" onSubmit={(event) => void sendReply(event)}>
                    <label className="block">
                      <span className="mb-2 block text-xs font-medium text-slate-300">YouTube reply</span>
                      <textarea className="input min-h-24 resize-y" maxLength={10_000} onChange={(event) => setReplyText(event.target.value)} placeholder="Write a reply…" value={replyText} />
                    </label>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[11px] leading-5 text-slate-500">Manual send only. Drafts are never sent automatically; provider acceptance is read back before success is reported.</p>
                      <div className="flex items-center gap-2">
                        {canEdit ? <button className="btn-secondary min-h-9 px-3 text-xs" disabled={savingDraft || sending} onClick={() => void saveDraft()} type="button">{savingDraft ? 'Saving…' : 'Save draft'}</button> : null}
                        <button className="btn-primary min-h-9 px-3 text-xs" disabled={!canSend || sending || !replyText.trim() || currentRow.status !== 'open'} type="submit"><PaperPlaneIcon size={15} />{sending ? 'Sending…' : 'Send reply'}</button>
                      </div>
                    </div>
                    {currentRow.status !== 'open'
                      ? <p className="text-right text-xs text-amber-200">Reopen this conversation before sending a reply.</p>
                      : !canSend ? <p className="text-right text-xs text-amber-200">Your role can prepare a draft but does not have inbox send permission.</p> : null}
                  </form>
                ) : (
                  <div className="rounded-xl border border-amber-300/15 bg-amber-400/[0.06] px-4 py-3">
                    <p className="text-xs font-semibold text-amber-100">Replies are not available here</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{detail?.replyLimitation ?? 'This platform or thread does not currently support an integrated reply.'}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <Card title="Official provider capabilities and limits" action={<span className="text-[11px] text-slate-500">Reviewed 7 Oct 2026</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="table-header"><tr><th className="px-2 py-3">Provider</th><th className="px-2 py-3">Comment read</th><th className="px-2 py-3">Comment reply</th><th className="px-2 py-3">Direct messages</th><th className="px-2 py-3">Change stream</th></tr></thead>
            <tbody>
              {listData.providers.map((provider) => <tr className="table-row align-top" key={provider.platform}>
                <td className="px-2 py-3 font-medium text-slate-200">{provider.label}</td>
                <td className="px-2 py-3"><CapabilityCell capability={provider.comments.read} /></td>
                <td className="px-2 py-3"><CapabilityCell capability={provider.comments.reply} /></td>
                <td className="px-2 py-3"><div className="space-y-2"><CapabilityCell capability={provider.directMessages.read} /><CapabilityCell capability={provider.directMessages.reply} /></div></td>
                <td className="px-2 py-3 text-xs text-slate-400">{provider.syncMode === 'polling' ? 'Polling' : provider.syncMode === 'webhook_and_polling' ? 'Webhook + polling' : 'Not connected'}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">YouTube comment threads are polled (YouTube push notifications do not report comments); threads with more replies than the API returned are marked partial. Facebook polls the 10 most recent Page posts and at most two 100-comment pages per post per run; older Page posts are not paginated and comments remain read-only here. Facebook Messenger and Instagram messaging APIs are not wired into this phase. No platform is scraped or bypassed.</p>
      </Card>
    </div>
  );
}

function ConversationListItem({
  active,
  conversation,
  onClick,
}: {
  active: boolean;
  conversation: InboxConversation;
  onClick: () => void;
}) {
  return (
    <button className={`w-full rounded-xl border px-3 py-3 text-left transition ${active ? 'border-brand-300/30 bg-brand-400/[0.09]' : 'border-transparent hover:border-surface-border hover:bg-white/[0.025]'}`} onClick={onClick} type="button">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface-raised text-[11px] font-semibold text-slate-300">{initials(conversation.participant_name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-slate-100">{conversation.participant_name ?? displayPlatform(conversation.platform)}</span>
            <time className="shrink-0 text-[10px] text-slate-500">{formatTime(conversation.last_message_at, true)}</time>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{conversation.last_message_preview ?? 'No text preview available.'}</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={conversation.platform === 'youtube' ? 'danger' : 'info'}>{displayPlatform(conversation.platform)}</Badge>
            <span className="text-[10px] text-slate-500">{conversation.kind === 'comment_thread' ? 'Comment thread' : 'Direct message'}</span>
            {conversation.platform === 'youtube' && conversation.metadata.repliesComplete === false ? <Badge tone="warning">Partial history</Badge> : null}
            {!conversation.is_read ? <span aria-label="Unread" className="ml-auto h-2 w-2 rounded-full bg-brand-300" /> : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ message, senderName }: { message: InboxMessage; senderName: string | null }) {
  const outbound = message.direction === 'outbound';
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <article className={`max-w-[min(85%,680px)] rounded-2xl border px-4 py-3 ${outbound ? 'border-brand-300/20 bg-brand-500/[0.13]' : 'border-surface-border bg-surface-raised/80'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
          <span className="font-medium text-slate-300">{senderName ?? (outbound ? 'Connected account' : message.kind === 'comment' ? 'Comment author' : 'Thread participant')}</span>
          <time dateTime={message.sent_at ?? undefined}>{formatTime(message.sent_at, true)}</time>
          {message.status === 'failed' || message.status === 'unknown' ? <Badge tone="warning">{message.status}</Badge> : null}
        </div>
        {message.body ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">{message.body}</p> : null}
        {message.attachments.length > 0 ? <p className="mt-2 text-xs text-slate-400">{message.attachments.map((item) => item.label).join(' · ')}. Media is represented as provider metadata only.</p> : null}
        {message.provider_url ? <a className="mt-2 inline-flex items-center gap-1 text-xs text-brand-200 hover:text-white" href={message.provider_url} rel="noreferrer" target="_blank">View on platform <ArrowUpRightIcon size={13} /></a> : null}
        {message.ai_draft ? <div className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[0.05] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200">Saved reply draft · not sent</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-300">{message.ai_draft}</p></div> : null}
      </article>
    </div>
  );
}

function CapabilityCell({ capability }: { capability: InboxListResult['providers'][number]['comments']['read'] }) {
  return (
    <div className="min-w-[195px] space-y-1.5">
      <Badge tone={stateTone(capability.state)}>{stateLabel(capability.state)}</Badge>
      <p className="max-w-[340px] text-xs leading-5 text-slate-400">{capability.note}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {capability.docsUrl.map((url) => <a className="text-[10px] text-brand-200 hover:text-white" href={url} key={url} rel="noreferrer" target="_blank">Official docs <ArrowUpRightIcon size={11} className="inline" /></a>)}
      </div>
    </div>
  );
}

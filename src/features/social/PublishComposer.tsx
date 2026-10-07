'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, ErrorState } from '@/components/ui/primitives';
import type { SocialPlatform } from '@/types/domain';

export interface PublishTargetAccount {
  id: string;
  platform: SocialPlatform;
  platformLabel: string;
  name: string;
}

interface TargetValidationView {
  accountId: string;
  platform: string;
  accountName: string;
  ok: boolean;
  issues: string[];
  warnings: string[];
  nativeSchedule: boolean;
}

interface ValidationResponse {
  ok: boolean;
  data?: { scheduled: boolean; runAt: string; targets: TargetValidationView[] };
  error?: { message: string };
}

interface CreateResponse {
  ok: boolean;
  data?: {
    runAt: string;
    scheduled: boolean;
    jobs: Array<{ job: { id: string; status: string }; duplicate: boolean; nativeSchedule: boolean }>;
  };
  error?: { message: string };
}

interface BoardsResponse {
  ok: boolean;
  data?: { boards: Array<{ id: string; name: string }>; truncated: boolean };
  error?: { message: string };
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function PublishComposer({
  contentId,
  accounts,
  canPublish,
}: {
  contentId: string;
  accounts: PublishTargetAccount[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [options, setOptions] = useState<Record<string, Record<string, string>>>({});
  const [boards, setBoards] = useState<
    Record<string, { state: 'loading' } | { state: 'ready'; boards: Array<{ id: string; name: string }>; truncated: boolean } | { state: 'error'; message: string }>
  >({});
  const [runAt, setRunAt] = useState('');
  const [validation, setValidation] = useState<TargetValidationView[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selected.includes(account.id)),
    [accounts, selected],
  );

  // Load Pinterest boards lazily when a Pinterest target is selected.
  useEffect(() => {
    for (const account of selectedAccounts) {
      if (account.platform !== 'pinterest' || boards[account.id]) continue;
      setBoards((current) => ({ ...current, [account.id]: { state: 'loading' } }));
      fetch(`/api/workspace/social/publish/boards?accountId=${account.id}`)
        .then(async (response) => {
          const payload = (await response.json()) as BoardsResponse;
          const data = payload.ok ? payload.data : undefined;
          if (!data) {
            setBoards((current) => ({
              ...current,
              [account.id]: { state: 'error', message: payload.error?.message ?? 'Could not load boards.' },
            }));
            return;
          }
          setBoards((current) => ({
            ...current,
            [account.id]: { state: 'ready', boards: data.boards, truncated: data.truncated },
          }));
        })
        .catch(() => {
          setBoards((current) => ({
            ...current,
            [account.id]: { state: 'error', message: 'Could not reach the server.' },
          }));
        });
    }
  }, [selectedAccounts, boards]);

  if (!canPublish) {
    return (
      <p className="text-sm leading-6 text-slate-400">
        Your role cannot publish. Ask an owner or admin to publish this item.
      </p>
    );
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm leading-6 text-slate-400">
        No connected accounts can publish yet.{' '}
        <Link className="font-medium text-brand-300 hover:text-brand-200" href="/social">
          Connect an account
        </Link>{' '}
        first.
      </p>
    );
  }

  function toggle(accountId: string) {
    setSelected((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
    setValidation(null);
    setNotice(null);
  }

  function setOption(accountId: string, key: string, value: string) {
    setOptions((current) => ({ ...current, [accountId]: { ...current[accountId], [key]: value } }));
    setValidation(null);
  }

  function buildTargets() {
    return selectedAccounts.map((account) => {
      const picked = options[account.id] ?? {};
      const targetOptions: Record<string, string> = {};
      if (account.platform === 'pinterest' && picked.boardId) {
        targetOptions.boardId = picked.boardId;
      }
      if (account.platform === 'youtube') {
        targetOptions.privacyStatus = picked.privacyStatus || 'public';
        if (picked.categoryId?.trim()) targetOptions.categoryId = picked.categoryId.trim();
      }
      if (account.platform === 'tiktok' && picked.privacy?.trim()) {
        targetOptions.privacy = picked.privacy.trim();
      }
      return { accountId: account.id, options: targetOptions };
    });
  }

  function missingBoard(): boolean {
    return selectedAccounts.some(
      (account) =>
        account.platform === 'pinterest' && !(options[account.id]?.boardId ?? '').trim(),
    );
  }

  function runAtIso(): string | undefined {
    if (!runAt.trim()) return undefined;
    const parsed = new Date(runAt);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  async function check() {
    if (checking || submitting || selected.length === 0) return;
    if (missingBoard()) {
      setError('Choose a Pinterest board for every Pinterest target.');
      return;
    }
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/workspace/social/publish/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentId,
          targets: buildTargets(),
          runAt: runAtIso(),
          timezone: browserTimezone(),
        }),
      });
      const payload = (await response.json()) as ValidationResponse;
      if (!payload.ok || !payload.data) {
        setValidation(null);
        setError(payload.error?.message ?? 'Validation failed.');
        return;
      }
      setValidation(payload.data.targets);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    if (checking || submitting || selected.length === 0) return;
    if (missingBoard()) {
      setError('Choose a Pinterest board for every Pinterest target.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/workspace/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentId,
          targets: buildTargets(),
          runAt: runAtIso(),
          timezone: browserTimezone(),
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const payload = (await response.json()) as CreateResponse;
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'Could not create the publish jobs.');
        return;
      }
      const created = payload.data.jobs.filter((entry) => !entry.duplicate).length;
      const duplicates = payload.data.jobs.length - created;
      setNotice(
        payload.data.scheduled
          ? `Scheduled ${created} job${created === 1 ? '' : 's'}${duplicates > 0 ? ` (${duplicates} already queued)` : ''}. The scheduler publishes each at its time.`
          : `Published to ${created} account${created === 1 ? '' : 's'}${duplicates > 0 ? ` (${duplicates} already queued)` : ''}. See delivery results below.`,
      );
      idempotencyKey.current = newIdempotencyKey();
      setValidation(null);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Accounts
        </legend>
        <div className="mt-2 space-y-2">
          {accounts.map((account) => {
            const checked = selected.includes(account.id);
            return (
              <label
                className="flex cursor-pointer items-center gap-2 text-sm text-slate-200"
                key={account.id}
              >
                <input
                  checked={checked}
                  className="h-4 w-4 accent-brand-400"
                  onChange={() => toggle(account.id)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="font-medium">{account.platformLabel}</span>
                  <span className="text-slate-500"> · {account.name}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {selectedAccounts.map((account) => {
        if (account.platform === 'pinterest') {
          const boardState = boards[account.id];
          return (
            <div key={account.id}>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`board-${account.id}`}>
                Pinterest board · {account.name}
              </label>
              {!boardState || boardState.state === 'loading' ? (
                <p className="mt-1 text-xs text-slate-500">Loading boards…</p>
              ) : boardState.state === 'error' ? (
                <p className="mt-1 text-xs leading-5 text-red-200/90">{boardState.message}</p>
              ) : (
                <>
                  <select
                    className="input mt-1"
                    id={`board-${account.id}`}
                    onChange={(event) => setOption(account.id, 'boardId', event.target.value)}
                    value={options[account.id]?.boardId ?? ''}
                  >
                    <option value="">Choose a board…</option>
                    {boardState.boards.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.name}
                      </option>
                    ))}
                  </select>
                  {boardState.truncated ? (
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Showing the first page of boards.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          );
        }
        if (account.platform === 'youtube') {
          return (
          <div className="grid gap-2 sm:grid-cols-2" key={account.id}>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`privacy-${account.id}`}>
                YouTube visibility
              </label>
              <select
                className="input mt-1"
                id={`privacy-${account.id}`}
                onChange={(event) => setOption(account.id, 'privacyStatus', event.target.value)}
                value={options[account.id]?.privacyStatus ?? 'public'}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`category-${account.id}`}>
                Category id
              </label>
              <input
                className="input mt-1"
                id={`category-${account.id}`}
                inputMode="numeric"
                onChange={(event) => setOption(account.id, 'categoryId', event.target.value)}
                placeholder="22"
                value={options[account.id]?.categoryId ?? ''}
              />
            </div>
          </div>
          );
        }
        if (account.platform === 'tiktok') {
          return (
            <div key={account.id}>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`privacy-${account.id}`}>
                TikTok privacy (optional)
              </label>
              <input
                className="input mt-1"
                id={`privacy-${account.id}`}
                onChange={(event) => setOption(account.id, 'privacy', event.target.value)}
                placeholder="PUBLIC_TO_EVERYONE"
                value={options[account.id]?.privacy ?? ''}
              />
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Leave empty for the creator&apos;s default. Must match one of the creator&apos;s privacy options.
              </p>
            </div>
          );
        }
        return null;
      })}

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="publish-run-at">
          Schedule (optional)
        </label>
        <input
          className="input mt-1"
          id="publish-run-at"
          onChange={(event) => {
            setRunAt(event.target.value);
            setValidation(null);
          }}
          type="datetime-local"
          value={runAt}
        />
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Empty means publish now. Times use your browser timezone ({browserTimezone()}).
        </p>
      </div>

      {validation ? (
        <ul className="space-y-2">
          {validation.map((target) => (
            <li className="rounded-xl border border-surface-border bg-surface/40 p-3" key={target.accountId}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-200">{target.accountName}</p>
                {target.ok ? <Badge tone="success">Ready</Badge> : <Badge tone="danger">Blocked</Badge>}
                {target.nativeSchedule ? <Badge tone="info">Provider schedule</Badge> : null}
              </div>
              {target.issues.map((issue) => (
                <p className="mt-1 text-xs leading-5 text-red-200/90" key={issue}>
                  {issue}
                </p>
              ))}
              {target.warnings.map((warning) => (
                <p className="mt-1 text-xs leading-5 text-amber-100/90" key={warning}>
                  {warning}
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
      {notice ? <p className="text-sm leading-6 text-emerald-200">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-secondary"
          disabled={checking || submitting || selected.length === 0}
          onClick={check}
          type="button"
        >
          {checking ? 'Checking…' : 'Check'}
        </button>
        <button
          className="btn-primary"
          disabled={checking || submitting || selected.length === 0}
          onClick={submit}
          type="button"
        >
          {submitting ? 'Working…' : runAt.trim() ? 'Schedule' : 'Publish now'}
        </button>
      </div>
    </div>
  );
}

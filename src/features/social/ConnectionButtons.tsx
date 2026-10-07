'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';

interface ApiResponse {
  ok: boolean;
  data?: { authorize_url?: string };
  error?: { message: string };
}

/** Starts OAuth: the server returns the provider URL and the browser goes there. */
export function ConnectButton({ platform, label }: { platform: string; label: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/social/connect/${platform}`, { method: 'POST' });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok || !payload.data?.authorize_url) {
        setError(payload.error?.message ?? 'Could not start the connection.');
        setWorking(false);
        return;
      }
      window.location.href = payload.data.authorize_url;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-primary w-full" disabled={working} onClick={connect} type="button">
        {working ? 'Redirecting…' : `Connect ${label}`}
      </button>
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}

export function RefreshButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    if (working) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/workspace/social/accounts/${id}/refresh`, { method: 'POST' });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not refresh the connection.');
        setWorking(false);
        return;
      }
      setNotice(`${label} tokens refreshed.`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-secondary w-full" disabled={working} onClick={refresh} type="button">
        {working ? 'Refreshing…' : 'Refresh tokens'}
      </button>
      {error ? <ErrorState message={error} /> : null}
      {notice ? (
        <p aria-live="polite" className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

export function DisconnectButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (working) return;
    if (!window.confirm(`Disconnect "${name}"? Stored tokens are deleted and must be re-authorized to publish later.`)) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/social/accounts/${id}`, { method: 'DELETE' });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not disconnect the account.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-danger w-full" disabled={working} onClick={disconnect} type="button">
        {working ? 'Disconnecting…' : 'Disconnect'}
      </button>
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}

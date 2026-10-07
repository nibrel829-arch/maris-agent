'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/primitives';
import type { MediaListItem } from '@/server/content/service';
import { formatBytes, MediaPreview } from './MediaPreview';

const KIND_LABEL: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
};

function MediaCard({
  item,
  canDelete,
  onDeleted,
}: {
  item: MediaListItem;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(item.preview_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — the link is shown below the file.');
    }
  }

  async function remove() {
    if (deleting) return;
    if (!window.confirm(`Delete "${item.filename}"? Drafts linking it will keep a dead link.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/content/media/${item.id}`, { method: 'DELETE' });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not delete the file.');
        return;
      }
      onDeleted();
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
      <MediaPreview
        filename={item.filename}
        kind={item.kind}
        mimeType={item.mime_type}
        url={item.preview_url}
      />
      <div className="space-y-2 p-3">
        <p className="truncate text-sm font-medium text-slate-200" title={item.filename}>
          {item.filename}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="info">{KIND_LABEL[item.kind] ?? item.kind}</Badge>
          <span className="text-[11px] text-slate-500">{formatBytes(item.size_bytes)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <a className="btn-ghost px-2 py-1 text-xs" href={item.preview_url} rel="noreferrer" target="_blank">
            Open
          </a>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={copyLink} type="button">
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          {canDelete ? (
            <button
              className="btn-ghost px-2 py-1 text-xs text-red-200/90 hover:text-red-100"
              disabled={deleting}
              onClick={remove}
              type="button"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : null}
        </div>
        {error ? <p className="text-xs leading-5 text-red-200/90">{error}</p> : null}
      </div>
    </article>
  );
}

export function MediaGrid({ items, canDelete }: { items: MediaListItem[]; canDelete: boolean }) {
  const [, setVersion] = useState(0);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          canDelete={canDelete}
          item={item}
          onDeleted={() => setVersion((version) => version + 1)}
        />
      ))}
    </div>
  );
}

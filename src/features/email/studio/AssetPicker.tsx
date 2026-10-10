'use client';

import { useEffect, useRef, useState } from 'react';
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/server/content/validation';
import type { EmailImage } from '@/types/email-design';

/**
 * Content Library asset picker (Phase 16 §2).
 *
 * Reuses the existing Phase 6 media library — there is no second media system.
 * Files are listed through `/api/workspace/content/media`, uploaded through the
 * same multipart route the Content page uses, and referenced by media id. The
 * bytes stay in the private bucket and are only ever delivered through the
 * authorized file route or the signed email asset route.
 */

interface MediaItem {
  id: string;
  filename: string;
  preview_url: string;
  kind: string;
  mime_type: string;
  size_bytes: number;
}

export interface AssetPickerProps {
  /** Current value, so the picker can highlight the selected asset. */
  value: EmailImage;
  /** Accessible label for the trigger, e.g. "Hero image". */
  label: string;
  /** Called whenever the image (asset, URL or alt text) changes. */
  onChange: (image: EmailImage) => void;
}

const ACCEPT = [...ALLOWED_MIME_TYPES].join(',');

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssetPicker({ value, label, onChange }: AssetPickerProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [alt, setAlt] = useState(value.alt);
  const [externalUrl, setExternalUrl] = useState(value.url ?? '');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAlt(value.alt);
    setExternalUrl(value.url ?? '');
  }, [value.alt, value.url, open]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/workspace/content/media?kind=image&limit=60');
      const payload = (await response.json()) as { ok: boolean; data?: { items: MediaItem[] }; error?: { message: string } };
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'Could not load the Content Library.');
        return;
      }
      setItems(payload.data.items);
    } catch {
      setError('Could not reach the server to load the Content Library.');
    } finally {
      setLoading(false);
    }
  }

  function choose(item: MediaItem) {
    onChange({ mediaId: item.id, url: null, alt: alt.trim() || item.filename });
    setNotice(`${item.filename} selected.`);
  }

  async function upload(file: File) {
    setError(null);
    setNotice(null);
    if (file.size === 0) {
      setError('The file is empty.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Files must be 10 MB or smaller.');
      return;
    }
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
      setError('Unsupported file type. Upload an image, video, audio file or PDF.');
      return;
    }
    const form = new FormData();
    form.set('file', file);
    setLoading(true);
    try {
      const response = await fetch('/api/workspace/content/media', { method: 'POST', body: form });
      const payload = (await response.json()) as { ok: boolean; data?: MediaItem; error?: { message: string } };
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'Could not upload the file.');
        return;
      }
      await load();
      onChange({ mediaId: payload.data.id, url: null, alt: alt.trim() || payload.data.filename });
      setNotice(`${payload.data.filename} uploaded and selected.`);
    } catch {
      setError('Could not reach the server to upload the file.');
    } finally {
      setLoading(false);
    }
  }

  const filtered = items.filter((item) =>
    search.trim() ? item.filename.toLowerCase().includes(search.trim().toLowerCase()) : true,
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => { setOpen((v) => !v); if (!open) void load(); }}>
          {open ? 'Close library' : 'Choose from Content Library'}
        </button>
        {value.mediaId ? (
          <button
            className="btn-ghost px-2 py-1 text-xs"
            type="button"
            onClick={() => onChange({ mediaId: null, url: externalUrl.trim() || null, alt })}
          >
            Remove asset
          </button>
        ) : null}
        <span className="text-[11px] text-slate-500">
          {value.mediaId ? `Library asset ${value.mediaId.slice(0, 8)}…` : value.url ? 'External URL' : 'No image selected'}
        </span>
      </div>

      <label className="block text-xs font-medium text-slate-300" htmlFor={`alt-${label}`}>
        Alt text (shown when images are blocked)
        <input
          className="input mt-1"
          id={`alt-${label}`}
          maxLength={300}
          placeholder="Describe the image"
          value={alt}
          onChange={(event) => {
            setAlt(event.target.value);
            onChange({ mediaId: value.mediaId, url: value.url, alt: event.target.value });
          }}
        />
      </label>

      <label className="block text-xs font-medium text-slate-300" htmlFor={`url-${label}`}>
        Or use an external image URL (https://)
        <input
          className="input mt-1"
          id={`url-${label}`}
          maxLength={2048}
          placeholder="https://…"
          value={externalUrl}
          onChange={(event) => {
            setExternalUrl(event.target.value);
            onChange({ mediaId: null, url: event.target.value.trim() || null, alt });
          }}
        />
      </label>

      {notice ? <p className="text-xs text-emerald-200">{notice}</p> : null}
      {error ? <p className="text-xs text-red-200">{error}</p> : null}

      {open ? (
        <div className="panel-subtle max-h-72 overflow-y-auto p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[220px] py-1.5 text-xs"
              placeholder="Search the library…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => fileInput.current?.click()}>
              Upload image
            </button>
            <input
              accept={ACCEPT}
              className="hidden"
              ref={fileInput}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = '';
              }}
            />
            <button className="btn-ghost px-2 py-1 text-xs" type="button" onClick={() => void load()}>
              Refresh
            </button>
          </div>

          {loading && items.length === 0 ? <p className="text-xs text-slate-400">Loading the Content Library…</p> : null}
          {!loading && filtered.length === 0 ? (
            <p className="text-xs text-slate-400">
              No images in the Content Library yet. Upload one, or use an external URL above.
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {filtered.map((item) => (
              <button
                key={item.id}
                className={`group rounded-xl border p-1 text-left transition ${
                  value.mediaId === item.id ? 'border-brand-400' : 'border-surface-border hover:border-slate-500'
                }`}
                type="button"
                onClick={() => choose(item)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={item.filename}
                  className="h-20 w-full rounded-lg object-cover"
                  src={item.preview_url}
                  loading="lazy"
                />
                <span className="mt-1 block truncate text-[10px] text-slate-400" title={item.filename}>
                  {item.filename}
                </span>
                <span className="block text-[10px] text-slate-600">{formatBytes(item.size_bytes)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

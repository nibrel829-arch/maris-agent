'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/server/content/validation';
import { formatBytes } from './MediaPreview';

interface ApiResponse {
  ok: boolean;
  data?: { preview_url: string; filename?: string };
  error?: { message: string };
}

const ACCEPT = [...ALLOWED_MIME_TYPES].join(',');

export function MediaUploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (uploading) return;

    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
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

    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/workspace/content/media', {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not upload the file.');
        return;
      }
      setFile(null);
      const input = document.getElementById('media-file') as HTMLInputElement | null;
      if (input) input.value = '';
      setNotice('Upload complete. The file is now in the media library.');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="media-file">
          File *
        </label>
        <input
          accept={ACCEPT}
          className="input file:mr-3 file:rounded-lg file:border file:border-surface-border file:bg-surface-raised file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
          id="media-file"
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          Images, video, audio or PDF · max {formatBytes(MAX_UPLOAD_BYTES)} · stored privately per organization
        </p>
      </div>

      {file ? (
        <p className="text-xs text-slate-400">
          {file.name} · {formatBytes(file.size)}
        </p>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
      {notice ? (
        <p aria-live="polite" className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}

      <button className="btn-primary w-full sm:w-auto" disabled={uploading} type="submit">
        {uploading ? 'Uploading…' : 'Upload file'}
      </button>
    </form>
  );
}

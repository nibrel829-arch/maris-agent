'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';
import type { SocialPlatform } from '@/types/domain';
import { CONTENT_PLATFORMS, platformLabel } from './content-statuses';
import { validateContentFields, type ContentFieldErrors } from './field-validation';

interface ApiResponse {
  ok: boolean;
  error?: { message: string };
}

const inputClass = (invalid: boolean) => `input${invalid ? ' border-red-400/60' : ''}`;
const hintClass = 'mt-1 text-xs leading-5 text-red-200/90';

export function CreateContentForm({ initialMediaUrl = '' }: { initialMediaUrl?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [body, setBody] = useState('');
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);
  const [mediaUrl, setMediaUrl] = useState(initialMediaUrl);
  const [fieldErrors, setFieldErrors] = useState<ContentFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function togglePlatform(platform: SocialPlatform) {
    setPlatforms((current) =>
      current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const errors = validateContentFields({ title, caption, body, mediaUrl });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          caption: caption.trim() || undefined,
          body: body.trim() || undefined,
          platforms,
          media_url: mediaUrl.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setSubmitError(payload.error?.message ?? 'Could not create the draft.');
        return;
      }

      setTitle('');
      setCaption('');
      setBody('');
      setPlatforms([]);
      setMediaUrl('');
      setFieldErrors({});
      setNotice('Draft created.');
      router.refresh();
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="content-title">
          Title *
        </label>
        <input
          aria-invalid={Boolean(fieldErrors.title)}
          className={inputClass(Boolean(fieldErrors.title))}
          id="content-title"
          placeholder="Launch announcement"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {fieldErrors.title ? <p className={hintClass}>{fieldErrors.title}</p> : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="content-caption">
          Caption
        </label>
        <textarea
          aria-invalid={Boolean(fieldErrors.caption)}
          className={`${inputClass(Boolean(fieldErrors.caption))} min-h-16`}
          id="content-caption"
          placeholder="Short text that travels with the post…"
          rows={2}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
        />
        {fieldErrors.caption ? <p className={hintClass}>{fieldErrors.caption}</p> : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="content-body">
          Body
        </label>
        <textarea
          aria-invalid={Boolean(fieldErrors.body)}
          className={`${inputClass(Boolean(fieldErrors.body))} min-h-20`}
          id="content-body"
          placeholder="Longer copy, script or article text…"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {fieldErrors.body ? <p className={hintClass}>{fieldErrors.body}</p> : null}
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-slate-300">Target platforms</legend>
        <div className="flex flex-wrap gap-1.5">
          {CONTENT_PLATFORMS.map((platform) => {
            const active = platforms.includes(platform);
            return (
              <button
                aria-pressed={active}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition ${
                  active
                    ? 'bg-brand-400/15 text-brand-200 ring-brand-300/30'
                    : 'bg-slate-400/10 text-slate-400 ring-slate-400/15 hover:text-slate-200'
                }`}
                key={platform}
                onClick={() => togglePlatform(platform)}
                type="button"
              >
                {platformLabel(platform)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="content-media">
          Media link
        </label>
        <input
          aria-invalid={Boolean(fieldErrors.mediaUrl)}
          className={inputClass(Boolean(fieldErrors.mediaUrl))}
          id="content-media"
          placeholder="/api/workspace/content/media/…/file"
          value={mediaUrl}
          onChange={(event) => setMediaUrl(event.target.value)}
        />
        {fieldErrors.mediaUrl ? <p className={hintClass}>{fieldErrors.mediaUrl}</p> : null}
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          Paste a “Copy link” URL from the media library, or leave empty.
        </p>
      </div>

      {submitError ? <ErrorState message={submitError} /> : null}
      {notice ? (
        <p aria-live="polite" className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}

      <button className="btn-primary w-full sm:w-auto" disabled={saving} type="submit">
        {saving ? 'Saving…' : 'Create draft'}
      </button>
    </form>
  );
}

import { DocumentIcon } from '@/components/ui/icons';
import type { MediaKind } from '@/server/content/validation';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Media player/tile by kind. `card` fits the library grid; `full` is the
 * detail-page player. Documents render as an icon tile (card) or an embedded
 * object with a download fallback (full).
 */
export function MediaPreview({
  kind,
  mimeType,
  url,
  filename,
  size = 'card',
}: {
  kind: MediaKind;
  mimeType: string;
  url: string;
  filename: string;
  size?: 'card' | 'full';
}) {
  if (kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={filename}
        className={
          size === 'card'
            ? 'h-36 w-full object-cover'
            : 'max-h-[480px] w-full rounded-xl border border-surface-border object-contain'
        }
        loading="lazy"
        src={url}
      />
    );
  }

  if (kind === 'video') {
    return (
      <video
        className={size === 'card' ? 'h-36 w-full object-cover' : 'max-h-[480px] w-full rounded-xl border border-surface-border'}
        controls={size === 'full'}
        muted={size === 'card'}
        playsInline
        preload="metadata"
        src={url}
      />
    );
  }

  if (kind === 'audio') {
    if (size === 'card') {
      return (
        <div className="flex h-36 flex-col items-center justify-center gap-2 bg-surface/60 p-3 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-raised text-brand-300">
            ♪
          </span>
          <p className="w-full truncate text-xs text-slate-400">{filename}</p>
        </div>
      );
    }
    return <audio className="w-full" controls preload="metadata" src={url} />;
  }

  if (size === 'card') {
    return (
      <div className="flex h-36 flex-col items-center justify-center gap-2 bg-surface/60 p-3 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-raised text-brand-300">
          <DocumentIcon size={19} />
        </span>
        <p className="w-full truncate text-xs text-slate-400">{filename}</p>
        <p className="text-[11px] text-slate-500">{mimeType}</p>
      </div>
    );
  }

  return (
    <div>
      <object className="h-[480px] w-full rounded-xl border border-surface-border" data={url} type={mimeType}>
        <p className="p-4 text-sm text-slate-400">
          Preview is unavailable for this file.{' '}
          <a className="text-brand-300 hover:text-brand-200" href={url} rel="noreferrer" target="_blank">
            Open it directly
          </a>
          .
        </p>
      </object>
    </div>
  );
}

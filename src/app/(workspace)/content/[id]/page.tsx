import Link from 'next/link';
import { Badge, Card, EmptyState, KeyValue } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { EditContentForm } from '@/features/content/EditContentForm';
import { LifecycleButtons } from '@/features/content/LifecycleButtons';
import { DeleteContentButton } from '@/features/content/DeleteContentButton';
import { ContentStatusBadge } from '@/features/content/ContentStatusBadge';
import { MediaPreview, formatBytes } from '@/features/content/MediaPreview';
import { isDraftLifecycleStatus, platformLabel } from '@/features/content/content-statuses';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getContentItem, getMedia, toMediaListItem } from '@/server/content/service';
import { contentIdSchema } from '@/server/content/validation';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import type { SocialPlatform } from '@/types/domain';

export const dynamic = 'force-dynamic';

const FUTURE_ATTACHMENTS = [
  { label: 'Schedule', phase: 'Phase 8' },
  { label: 'Publish', phase: 'Phase 8' },
  { label: 'Delivery results', phase: 'Phase 8' },
] as const;

/** Extracts the media id from an internal file-route URL, if that is what the link is. */
function internalMediaId(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const match = /^\/api\/workspace\/content\/media\/([0-9a-f-]{36})\/file\/?$/i.exec(mediaUrl.trim());
  return match?.[1] ?? null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ContentNotFound() {
  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <Link className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/content">
        ← Back to library
      </Link>
      <PageHeader
        description="The requested item does not exist in this organization."
        title="Content not found"
      />
      <Card>
        <EmptyState
          action={
            <Link className="btn-secondary" href="/content">
              Back to library
            </Link>
          }
          description="It may have been removed, or the link points to a record in another organization."
          title="No such item here"
        />
      </Card>
    </div>
  );
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Unknown and malformed ids render the same state: existence is never
  // leaked, and the API remains the strict 404 boundary.
  if (!contentIdSchema.safeParse(id).success) return <ContentNotFound />;

  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  if (!checkPermission(actor, { module: 'content', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view content items." />;
  }

  const detail = await getContentItem(actor, repo, id);
  if (!detail.ok) {
    if (detail.error.code === 'CONTENT_NOT_FOUND') return <ContentNotFound />;
    return <ConfigurationRequired reason={detail.error.message} />;
  }

  const item = detail.data;
  const canEdit = checkPermission(actor, { module: 'content', action: 'edit' }).allowed;
  const canDelete = checkPermission(actor, { module: 'content', action: 'delete' }).allowed;

  // Resolve an internal media link to its row (same organization only) so the
  // detail page can render the right player. External links stay plain links.
  const mediaId = internalMediaId(item.media_url);
  const media = mediaId ? await getMedia(actor, repo, mediaId) : null;
  const attached = media && media.ok ? toMediaListItem(media.data) : null;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <Link className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/content">
        ← Back to library
      </Link>

      <PageHeader
        description={item.caption ?? 'Content item'}
        title={item.title}
        actions={<ContentStatusBadge status={item.status} />}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-6">
          <Card title="Details">
            <KeyValue label="Status" value={<ContentStatusBadge status={item.status} />} />
            <KeyValue
              label="Platforms"
              value={
                item.platforms.length === 0
                  ? '—'
                  : item.platforms.map((platform) => platformLabel(platform as SocialPlatform)).join(' · ')
              }
            />
            <KeyValue label="Caption" value={item.caption ? <span className="whitespace-pre-wrap">{item.caption}</span> : '—'} />
            <KeyValue label="Created" value={formatDateTime(item.created_at)} />
            <KeyValue label="Last updated" value={formatDateTime(item.updated_at)} />
          </Card>

          <Card title="Body">
            {item.body ? (
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{item.body}</p>
            ) : (
              <p className="text-sm text-slate-500">No body saved with this item.</p>
            )}
          </Card>

          <Card title="Attached media">
            {attached ? (
              <div className="space-y-3">
                <MediaPreview
                  filename={attached.filename}
                  kind={attached.kind}
                  mimeType={attached.mime_type}
                  size="full"
                  url={attached.preview_url}
                />
                <p className="text-xs text-slate-500">
                  {attached.filename} · {attached.mime_type} · {formatBytes(attached.size_bytes)}
                </p>
              </div>
            ) : item.media_url ? (
              <a className="text-sm text-brand-300 hover:text-brand-200" href={item.media_url} rel="noreferrer" target="_blank">
                Open linked media <ArrowRightIcon size={14} className="inline" />
              </a>
            ) : (
              <EmptyState
                description="Paste a media-library link into the edit form to attach a file."
                icon={<DocumentIcon size={19} />}
                title="No media attached"
              />
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          {canEdit && isDraftLifecycleStatus(item.status) ? (
            <Card title="Lifecycle">
              <LifecycleButtons id={item.id} status={item.status} />
              <p className="mt-3 text-[11px] leading-4 text-slate-500">
                Drafts move between Draft and Ready here. Scheduling and publishing arrive in Phase 8.
              </p>
            </Card>
          ) : null}

          {canEdit ? (
            <Card title="Edit item">
              <EditContentForm item={item} />
            </Card>
          ) : (
            <Card title="Edit item">
              <EmptyState
                description="Your role can view this item but cannot make changes."
                icon={<DocumentIcon size={19} />}
                title="Read-only access"
              />
            </Card>
          )}

          <Card title="Publishing">
            <ul className="divide-y divide-surface-border/65">
              {FUTURE_ATTACHMENTS.map((attachment) => (
                <li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0" key={attachment.label}>
                  <span className="text-sm text-slate-400">{attachment.label}</span>
                  <Badge>{attachment.phase}</Badge>
                </li>
              ))}
            </ul>
          </Card>

          {canDelete ? (
            <Card title="Danger zone">
              <DeleteContentButton id={item.id} title={item.title} />
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

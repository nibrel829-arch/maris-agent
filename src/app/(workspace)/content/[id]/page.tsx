import Link from 'next/link';
import { Card, EmptyState, KeyValue } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { EditContentForm } from '@/features/content/EditContentForm';
import { LifecycleButtons } from '@/features/content/LifecycleButtons';
import { DeleteContentButton } from '@/features/content/DeleteContentButton';
import { ContentStatusBadge } from '@/features/content/ContentStatusBadge';
import { MediaPreview, formatBytes } from '@/features/content/MediaPreview';
import { isDraftLifecycleStatus, platformLabel } from '@/features/content/content-statuses';
import { PublishComposer, type PublishTargetAccount } from '@/features/social/PublishComposer';
import { PublishJobsList } from '@/features/social/PublishJobsList';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getContentItem, getMedia, toMediaListItem } from '@/server/content/service';
import { listAccounts } from '@/server/social/service';
import { listPublishJobs } from '@/server/social/publish/service';
import { contentIdSchema } from '@/server/content/validation';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import type { PublishJob, SocialPlatform } from '@/types/domain';

export const dynamic = 'force-dynamic';

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
  const canSeePublishing = checkPermission(actor, { module: 'social', action: 'view' }).allowed;
  const canPublish = checkPermission(actor, { module: 'social', action: 'publish' }).allowed;

  // Publishing data is auxiliary: a failure narrows this section, never the
  // whole page.
  let targetAccounts: PublishTargetAccount[] = [];
  const accountInfo: Record<string, { name: string; platform: string; platformLabel: string }> = {};
  let jobs: PublishJob[] = [];
  let publishingError: string | null = null;
  if (canSeePublishing) {
    const [connections, queue] = await Promise.all([
      listAccounts(actor, repo),
      listPublishJobs(actor, repo, { contentId: id, limit: 50, offset: 0 }),
    ]);
    if (!connections.ok) {
      publishingError = connections.error.message;
    } else {
      for (const account of connections.data.accounts) {
        accountInfo[account.id] = {
          name: account.name,
          platform: account.platform,
          platformLabel: platformLabel(account.platform),
        };
      }
      targetAccounts = connections.data.accounts
        .filter((account) => account.status === 'connected' && account.capabilities.publish)
        .map((account) => ({
          id: account.id,
          platform: account.platform,
          platformLabel: platformLabel(account.platform),
          name: account.name,
        }));
    }
    if (!queue.ok) {
      publishingError = queue.error.message;
    } else {
      jobs = queue.data.jobs;
    }
  }

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
                Drafts move between Draft and Ready here. Publish or schedule below once an item is ready.
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

          {canSeePublishing ? (
            <>
              <Card title="Publish">
                {publishingError ? (
                  <p className="text-sm leading-6 text-amber-100/90">{publishingError}</p>
                ) : (
                  <PublishComposer accounts={targetAccounts} canPublish={canPublish} contentId={item.id} />
                )}
              </Card>

              <Card title={`Delivery results (${jobs.length})`}>
                {publishingError ? (
                  <p className="text-sm leading-6 text-amber-100/90">{publishingError}</p>
                ) : (
                  <PublishJobsList accounts={accountInfo} canPublish={canPublish} jobs={jobs} />
                )}
              </Card>
            </>
          ) : (
            <Card title="Publishing">
              <EmptyState
                description="Your role cannot view publishing."
                icon={<DocumentIcon size={19} />}
                title="No access"
              />
            </Card>
          )}

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

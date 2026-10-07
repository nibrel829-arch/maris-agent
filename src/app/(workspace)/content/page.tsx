import Link from 'next/link';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { CreateContentForm } from '@/features/content/CreateContentForm';
import { ContentToolbar } from '@/features/content/ContentToolbar';
import { MediaToolbar } from '@/features/content/MediaToolbar';
import { MediaGrid } from '@/features/content/MediaGrid';
import { MediaUploadForm } from '@/features/content/MediaUploadForm';
import { ContentStatusBadge } from '@/features/content/ContentStatusBadge';
import {
  isContentPlatform,
  isContentStatus,
  platformLabel,
} from '@/features/content/content-statuses';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { listContentItems, listMedia } from '@/server/content/service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import type { ContentStatus, SocialPlatform } from '@/types/domain';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const MEDIA_PAGE_SIZE = 12;
const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;

type MediaKindParam = (typeof MEDIA_KINDS)[number];

function isMediaKindParam(value: unknown): value is MediaKindParam {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value);
}

interface LibraryParams {
  search: string;
  status: string;
  platform: string;
  page: number;
  msearch: string;
  mkind: string;
  mpage: number;
}

function libraryHref(params: LibraryParams, overrides: Partial<LibraryParams>): string {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (merged.search) query.set('search', merged.search);
  if (merged.status) query.set('status', merged.status);
  if (merged.platform) query.set('platform', merged.platform);
  if (merged.page > 1) query.set('page', String(merged.page));
  if (merged.msearch) query.set('msearch', merged.msearch);
  if (merged.mkind) query.set('mkind', merged.mkind);
  if (merged.mpage > 1) query.set('mpage', String(merged.mpage));
  const text = query.toString();
  return text ? `/content?${text}` : '/content';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function ContentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    platform?: string;
    page?: string;
    msearch?: string;
    mkind?: string;
    mpage?: string;
  }>;
}) {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  if (!checkPermission(actor, { module: 'content', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view the Content workspace." />;
  }

  const raw = await searchParams;
  const params: LibraryParams = {
    search: (raw.search ?? '').trim().slice(0, 200),
    status: isContentStatus(raw.status) ? (raw.status as ContentStatus) : '',
    platform: isContentPlatform(raw.platform) ? (raw.platform as SocialPlatform) : '',
    page: Math.max(1, Number.parseInt(raw.page ?? '1', 10) || 1),
    msearch: (raw.msearch ?? '').trim().slice(0, 200),
    mkind: isMediaKindParam(raw.mkind) ? raw.mkind : '',
    mpage: Math.max(1, Number.parseInt(raw.mpage ?? '1', 10) || 1),
  };

  const canCreate = checkPermission(actor, { module: 'content', action: 'create' }).allowed;
  const canDelete = checkPermission(actor, { module: 'content', action: 'delete' }).allowed;

  const [drafts, media, counts] = await Promise.all([
    listContentItems(actor, repo, {
      search: params.search || undefined,
      status: (params.status as ContentStatus) || undefined,
      platform: (params.platform as SocialPlatform) || undefined,
      limit: PAGE_SIZE,
      offset: (params.page - 1) * PAGE_SIZE,
    }),
    listMedia(actor, repo, {
      search: params.msearch || undefined,
      kind: (params.mkind as MediaKindParam) || undefined,
      limit: MEDIA_PAGE_SIZE,
      offset: (params.mpage - 1) * MEDIA_PAGE_SIZE,
    }),
    repo.counts(actor.organizationId),
  ]);

  if (!drafts.ok) {
    return (
      <div className="mx-auto max-w-[1380px] space-y-6">
        <PageHeader
          description="Drafts, captions and publishing assets for this organization."
          title="Content library"
        />
        <ErrorState message={drafts.error.message} />
      </div>
    );
  }
  if (!media.ok) {
    return (
      <div className="mx-auto max-w-[1380px] space-y-6">
        <PageHeader
          description="Drafts, captions and publishing assets for this organization."
          title="Content library"
        />
        <ErrorState message={media.error.message} />
      </div>
    );
  }

  const draftTotal = drafts.data.total;
  const draftPages = Math.max(1, Math.ceil(draftTotal / PAGE_SIZE));
  const draftPage = Math.min(params.page, draftPages);
  const draftsFiltered = params.search.length > 0 || params.status.length > 0 || params.platform.length > 0;

  const mediaTotal = media.data.total;
  const mediaPages = Math.max(1, Math.ceil(mediaTotal / MEDIA_PAGE_SIZE));
  const mediaPage = Math.min(params.mpage, mediaPages);
  const mediaFiltered = params.msearch.length > 0 || params.mkind.length > 0;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Drafts, captions and publishing assets for this organization. Nothing here publishes on its own — scheduling arrives in a later phase."
        title="Content library"
        actions={<Link className="btn-secondary" href="/marketing">Campaign planning <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-6">
          <Card
            title="Drafts"
            action={draftTotal > 0 ? <Badge tone="info">{draftTotal} item{draftTotal === 1 ? '' : 's'}</Badge> : null}
          >
            <div className="mb-4">
              <ContentToolbar platform={params.platform} search={params.search} status={params.status} />
            </div>

            {drafts.data.items.length === 0 ? (
              <EmptyState
                description={
                  draftsFiltered
                    ? 'No drafts match this search. Clear the search or choose different filters.'
                    : 'No drafts have been saved. Create the first one to start the library.'
                }
                icon={<DocumentIcon size={19} />}
                title={draftsFiltered ? 'No matching drafts' : 'No drafts yet'}
                action={
                  draftsFiltered ? (
                    <Link className="btn-secondary" href="/content">
                      Clear search
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="table-header">
                      <tr>
                        <th className="px-2 py-3">Title</th>
                        <th className="px-2 py-3">Status</th>
                        <th className="px-2 py-3">Platforms</th>
                        <th className="px-2 py-3">Updated</th>
                        <th className="px-2 py-3"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.data.items.map((item) => (
                        <tr className="table-row" key={item.id}>
                          <td className="px-2 py-3">
                            <Link className="font-medium text-slate-100 hover:text-white hover:underline" href={`/content/${item.id}`}>
                              {item.title}
                            </Link>
                            <p className="mt-0.5 line-clamp-1 max-w-64 text-xs text-slate-500">
                              {item.caption ?? 'No caption'}
                            </p>
                          </td>
                          <td className="px-2 py-3"><ContentStatusBadge status={item.status} /></td>
                          <td className="px-2 py-3">
                            {item.platforms.length === 0 ? (
                              <span className="text-xs text-slate-500">—</span>
                            ) : (
                              <span className="text-xs text-slate-400">
                                {item.platforms.map((platform) => platformLabel(platform as SocialPlatform)).join(' · ')}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-3 text-xs text-slate-500">{formatDate(item.updated_at)}</td>
                          <td className="px-2 py-3 text-right">
                            <Link className="btn-ghost text-xs" href={`/content/${item.id}`}>
                              View <ArrowRightIcon size={14} />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-surface-border/60 pt-4">
                  <p className="text-xs text-slate-500">
                    Showing {draftTotal === 0 ? 0 : (draftPage - 1) * PAGE_SIZE + 1}–{Math.min(draftTotal, draftPage * PAGE_SIZE)} of {draftTotal}
                  </p>
                  <div className="flex items-center gap-2">
                    {draftPage > 1 ? (
                      <Link className="btn-secondary px-3 py-1.5 text-xs" href={libraryHref(params, { page: draftPage - 1 })}>
                        Previous
                      </Link>
                    ) : null}
                    <span className="text-xs text-slate-500">Page {draftPage} of {draftPages}</span>
                    {draftPage < draftPages ? (
                      <Link className="btn-secondary px-3 py-1.5 text-xs" href={libraryHref(params, { page: draftPage + 1 })}>
                        Next
                      </Link>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card
            title="Media library"
            action={mediaTotal > 0 ? <Badge tone="info">{mediaTotal} file{mediaTotal === 1 ? '' : 's'}</Badge> : null}
          >
            <div className="mb-4">
              <MediaToolbar kind={params.mkind} search={params.msearch} />
            </div>

            {media.data.items.length === 0 ? (
              <EmptyState
                description={
                  mediaFiltered
                    ? 'No files match this search. Clear the search or choose a different type.'
                    : 'No media has been uploaded. Uploaded files are stored privately per organization.'
                }
                icon={<DocumentIcon size={19} />}
                title={mediaFiltered ? 'No matching files' : 'No media yet'}
                action={
                  mediaFiltered ? (
                    <Link className="btn-secondary" href="/content">
                      Clear search
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <MediaGrid canDelete={canDelete} items={media.data.items} />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-surface-border/60 pt-4">
                  <p className="text-xs text-slate-500">
                    Showing {mediaTotal === 0 ? 0 : (mediaPage - 1) * MEDIA_PAGE_SIZE + 1}–{Math.min(mediaTotal, mediaPage * MEDIA_PAGE_SIZE)} of {mediaTotal}
                  </p>
                  <div className="flex items-center gap-2">
                    {mediaPage > 1 ? (
                      <Link className="btn-secondary px-3 py-1.5 text-xs" href={libraryHref(params, { mpage: mediaPage - 1 })}>
                        Previous
                      </Link>
                    ) : null}
                    <span className="text-xs text-slate-500">Page {mediaPage} of {mediaPages}</span>
                    {mediaPage < mediaPages ? (
                      <Link className="btn-secondary px-3 py-1.5 text-xs" href={libraryHref(params, { mpage: mediaPage + 1 })}>
                        Next
                      </Link>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          {canCreate ? <Card title="Upload media"><MediaUploadForm /></Card> : null}
          {canCreate ? <Card title="New draft"><CreateContentForm /></Card> : null}
          <Card title="Current context">
            <dl className="divide-y divide-surface-border/65">
              <div className="flex items-center justify-between gap-4 py-3 pt-0">
                <dt className="text-sm text-slate-400">Content items</dt>
                <dd className="text-sm font-medium text-slate-200">
                  {(counts.content_items ?? 0) === 0 ? 'None recorded' : counts.content_items}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-sm text-slate-400">Media files</dt>
                <dd className="text-sm font-medium text-slate-200">
                  {(counts.media_files ?? 0) === 0 ? 'None recorded' : counts.media_files}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 pb-0">
                <dt className="text-sm text-slate-400">Publishing</dt>
                <dd className="text-right text-sm font-medium text-slate-200">Drafts only for now</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

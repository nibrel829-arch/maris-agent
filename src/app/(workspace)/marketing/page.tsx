import Link from 'next/link';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon, LayersIcon, PulseIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

const CONTENT_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  VALIDATING: 'info',
  READY: 'success',
  SCHEDULED: 'info',
  PUBLISHING: 'warning',
  PUBLISHED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

export default async function MarketingPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const [content, campaigns, socialPlans, visualConcepts] = await Promise.all([
    repoResult.data.contentItems.list(actorResult.data.organizationId, { limit: 100 }),
    repoResult.data.campaignPlans.list(actorResult.data.organizationId, { limit: 50 }),
    repoResult.data.socialPlans.list(actorResult.data.organizationId, { limit: 50 }),
    repoResult.data.visualConcepts.list(actorResult.data.organizationId, { limit: 50 }),
  ]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        description="Bring drafts, campaign intent and visual direction together without pretending anything has been published or measured when it has not."
        title="Marketing workspace"
        actions={<Link className="btn-primary" href="/manager?request=Create%20a%20content%20campaign">Create with the Manager <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card title="Content in motion" action={content.length > 0 ? <Badge tone="info">{content.length} item{content.length === 1 ? '' : 's'}</Badge> : null}>
          {content.length === 0 ? (
            <EmptyState
              action={<Link className="btn-primary" href="/manager?request=Create%20a%20content%20campaign">Create your first draft <ArrowRightIcon size={15} /></Link>}
              description="No content is in motion. Ask Nibrexo to draft a focused asset or campaign; it will remain a draft until a supported, approved publish action occurs."
              icon={<DocumentIcon size={19} />}
              title="No content yet"
            />
          ) : (
            <div className="space-y-3">
              {content.map((item) => (
                <article className="rounded-xl border border-surface-border bg-surface/40 p-4" key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link className="text-sm font-semibold text-slate-100 hover:text-white" href={`/content/${item.id}`}>{item.title}</Link>
                        <Badge tone={CONTENT_TONE[item.status] ?? 'neutral'}>{item.status.toLowerCase()}</Badge>
                      </div>
                      {item.caption ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">{item.caption}</p> : <p className="mt-2 text-xs text-slate-500">No caption saved with this item.</p>}
                    </div>
                    <time className="text-[11px] text-slate-500" dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                  </div>
                  {item.platforms.length > 0 ? <div className="mt-3 flex flex-wrap gap-1.5">{item.platforms.map((platform) => <Badge key={platform}>{platform}</Badge>)}</div> : null}
                </article>
              ))}
            </div>
          )}
        </Card>

        <aside className="space-y-6">
          <Card title="Publishing status">
            <p className="flex gap-2 text-sm leading-6 text-slate-400"><PulseIcon className="mt-1 shrink-0 text-brand-300" size={16} /> Content can be planned and prepared here. Publishing is only shown as complete after a supported integration and an approved external action.</p>
            <Link className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/social">View channel capability <ArrowRightIcon size={14} /></Link>
          </Card>
          <Card title="Visual direction">
            {visualConcepts.length === 0 ? <p className="text-sm leading-6 text-slate-500">No visual concepts have been saved yet.</p> : (
              <div className="space-y-3">
                {visualConcepts.slice(0, 4).map((concept) => (
                  <div className="rounded-lg border border-surface-border bg-surface/35 p-3" key={concept.id}>
                    <p className="text-sm font-medium text-slate-200">{concept.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{concept.purpose}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Campaign plans" action={campaigns.length > 0 ? <Badge>{campaigns.length} saved</Badge> : null}>
          {campaigns.length === 0 ? <EmptyState description="No campaign plans have been saved. Start with an audience and objective to create one." icon={<LayersIcon size={19} />} title="No campaigns yet" /> : (
            <div className="space-y-3">
              {campaigns.map((campaign) => (
                <article className="rounded-xl border border-surface-border bg-surface/40 p-4" key={campaign.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-100">{campaign.title}</h2><div className="flex flex-wrap gap-1">{campaign.channels.map((channel) => <Badge key={channel}>{channel}</Badge>)}</div></div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{campaign.objective}</p>
                  <p className="mt-1 text-xs text-slate-500">Audience: {campaign.audience}</p>
                </article>
              ))}
            </div>
          )}
        </Card>

        <Card title="Social plans" action={socialPlans.length > 0 ? <Badge>{socialPlans.length} saved</Badge> : null}>
          {socialPlans.length === 0 ? <EmptyState description="No social plans have been saved. Ask the Manager to turn a content goal into a cadence and set of themes." icon={<PulseIcon size={19} />} title="No social plans yet" /> : (
            <div className="space-y-3">
              {socialPlans.map((plan) => (
                <article className="rounded-xl border border-surface-border bg-surface/40 p-4" key={plan.id}>
                  <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-100">{plan.title}</h2><Badge tone="info">{plan.cadence}</Badge></div>
                  {plan.platforms.length > 0 ? <div className="mt-3 flex flex-wrap gap-1.5">{plan.platforms.map((platform) => <Badge key={platform}>{platform}</Badge>)}</div> : null}
                  {plan.themes.length > 0 ? <p className="mt-3 text-xs leading-5 text-slate-500">Themes: {plan.themes.slice(0, 4).join(' · ')}</p> : null}
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

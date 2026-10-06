import Link from 'next/link';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon, SearchIcon, ShieldCheckIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const briefs = await repoResult.data.researchBriefs.list(actorResult.data.organizationId, { limit: 50 });

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Research stays useful when the evidence, gaps and uncertainty are visible. Nibrexo records briefs here instead of turning assumptions into facts."
        title="Research workspace"
        actions={<Link className="btn-primary" href="/manager?request=Research%20a%20market%20opportunity">Start research <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card title="Saved research briefs" action={briefs.length > 0 ? <Badge tone="info">{briefs.length} saved</Badge> : null}>
          {briefs.length === 0 ? (
            <EmptyState
              action={<Link className="btn-primary" href="/manager?request=Research%20a%20market%20opportunity">Ask the Manager to research <ArrowRightIcon size={15} /></Link>}
              description="No research briefs have been saved yet. Ask Nibrexo a specific market, product or customer question to create the first one."
              icon={<SearchIcon size={19} />}
              title="No research on record"
            />
          ) : (
            <div className="space-y-4">
              {briefs.map((brief) => (
                <article className="rounded-xl border border-surface-border bg-surface/40 p-4" key={brief.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-slate-100">{brief.topic}</h2>
                        <Badge tone="info">{brief.domain}</Badge>
                        {brief.medical_review_required ? <Badge tone="warning"><ShieldCheckIcon size={12} /> Professional review required</Badge> : null}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{brief.question}</p>
                    </div>
                    <time className="text-[11px] text-slate-500" dateTime={brief.created_at}>{new Date(brief.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-surface-border/70 bg-[#0a1323]/55 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Evidence on record</p>
                      {brief.evidence.length === 0 ? <p className="mt-2 text-xs leading-5 text-slate-500">No evidence items were saved with this brief.</p> : (
                        <ul className="mt-2 space-y-2">
                          {brief.evidence.slice(0, 3).map((item, index) => (
                            <li className="text-xs leading-5 text-slate-300" key={`${item.claim}-${index}`}>
                              <Badge tone={item.grade === 'FACT' || item.grade === 'EVIDENCE' ? 'success' : 'neutral'}>{item.grade}</Badge>{' '}
                              {item.claim}
                              {item.source ? <span className="block text-slate-500">Source: {item.source}</span> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="rounded-lg border border-surface-border/70 bg-[#0a1323]/55 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Gaps & recommendations</p>
                      {brief.gaps.length === 0 && brief.recommendations.length === 0 ? <p className="mt-2 text-xs leading-5 text-slate-500">No gaps or recommendations were saved.</p> : (
                        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-300">
                          {brief.gaps.slice(0, 2).map((gap) => <li key={gap}><span className="text-amber-200">Gap:</span> {gap}</li>)}
                          {brief.recommendations.slice(0, 2).map((recommendation) => <li key={recommendation}><span className="text-brand-200">Next:</span> {recommendation}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>

        <aside className="space-y-6">
          <Card title="Research standard">
            <div className="space-y-4 text-sm leading-6 text-slate-400">
              <p className="flex gap-2"><DocumentIcon className="mt-1 shrink-0 text-brand-300" size={16} /> Claims are labeled so evidence is not confused with interpretation or recommendation.</p>
              <p className="flex gap-2"><SearchIcon className="mt-1 shrink-0 text-brand-300" size={16} /> Missing evidence remains visible as a gap. Nibrexo does not fill it with invented statistics.</p>
              <p className="flex gap-2"><ShieldCheckIcon className="mt-1 shrink-0 text-brand-300" size={16} /> Dental and medical material is flagged for appropriate professional review.</p>
            </div>
          </Card>
          <Card title="Useful next prompt">
            <p className="text-sm leading-6 text-slate-400">Give the Manager a bounded question, audience or decision you need to make.</p>
            <Link className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/manager?request=Research%20the%20market%20for%20dental%20scheduling%20software">
              Research a market opportunity <ArrowRightIcon size={14} />
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}

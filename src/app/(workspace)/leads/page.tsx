import Link from 'next/link';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, SearchIcon, TargetIcon, UserGroupIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

const STAGE_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  identified: 'neutral',
  researched: 'info',
  contacted: 'warning',
  qualified: 'success',
  disqualified: 'danger',
  converted: 'success',
};

export default async function LeadsPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const leads = await repoResult.data.leads.list(actorResult.data.organizationId, { limit: 100 });
  const qualified = leads.filter((lead) => lead.stage === 'qualified');

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="A personal pipeline for opportunities Nibrexo has actually recorded. Every lead keeps its source and qualification context visible before outreach begins."
        title="Leads workspace"
        actions={<Link className="btn-primary" href="/manager?request=Build%20a%20lead%20list">Research opportunities <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card title="Opportunity ledger" action={leads.length > 0 ? <Badge tone="info">{leads.length} recorded</Badge> : null}>
          {leads.length === 0 ? (
            <EmptyState
              action={<Link className="btn-primary" href="/manager?request=Build%20a%20lead%20list">Ask the Manager to research leads <ArrowRightIcon size={15} /></Link>}
              description="No active opportunities yet. Nibrexo will not invent leads; start with a segment, location or customer profile to build a sourced list."
              icon={<UserGroupIcon size={19} />}
              title="No leads recorded"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="table-header">
                  <tr>
                    <th className="px-2 py-3">Lead</th>
                    <th className="px-2 py-3">Source</th>
                    <th className="px-2 py-3">Stage</th>
                    <th className="px-2 py-3">Qualification</th>
                    <th className="px-2 py-3">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr className="table-row" key={lead.id}>
                      <td className="px-2 py-3">
                        <p className="font-medium text-slate-200">{lead.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{lead.company ?? lead.email ?? 'No company or email recorded'}</p>
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-400">{lead.source ?? 'Source not recorded'}</td>
                      <td className="px-2 py-3"><Badge tone={STAGE_TONE[lead.stage] ?? 'neutral'}>{lead.stage}</Badge></td>
                      <td className="px-2 py-3">
                        <span className="text-sm font-medium text-slate-200">{lead.qualification_score}</span>
                        <span className="ml-1 text-xs text-slate-500">/100</span>
                        {lead.qualification_reasons.length > 0 ? <p className="mt-1 max-w-52 text-[11px] leading-4 text-slate-500">{lead.qualification_reasons.slice(0, 2).join(' · ')}</p> : null}
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-500">{new Date(lead.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <aside className="space-y-6">
          <Card title="What is ready">
            {qualified.length === 0 ? (
              <div className="rounded-xl border border-dashed border-surface-border bg-surface/35 p-4">
                <TargetIcon className="text-brand-300" size={18} />
                <p className="mt-3 text-sm font-semibold text-slate-200">No qualified opportunities yet</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Qualification only appears when supporting reasons have been recorded.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {qualified.slice(0, 5).map((lead) => (
                  <div className="rounded-xl border border-surface-border bg-surface/35 p-3" key={lead.id}>
                    <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-200">{lead.name}</p><Badge tone="success">qualified</Badge></div>
                    <p className="mt-1 text-xs text-slate-500">{lead.company ?? lead.source ?? 'Context recorded in lead ledger'}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Safe outreach">
            <p className="flex gap-2 text-sm leading-6 text-slate-400"><SearchIcon className="mt-1 shrink-0 text-brand-300" size={16} /> Nibrexo can prepare outreach, but any external send stays behind a human approval decision.</p>
            <Link className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/manager?request=Prepare%20a%20focused%20outreach%20plan">
              Prepare an outreach plan <ArrowRightIcon size={14} />
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}

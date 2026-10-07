import Link from 'next/link';
import { ActivityTimeline } from '@/components/cockpit/ActivityTimeline';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon, ShieldCheckIcon, TrendIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

function recordLabel(count: number, singular: string, empty: string) {
  return count === 0 ? empty : `${count} ${singular}${count === 1 ? '' : 's'} on record`;
}

export default async function ReportsPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const organizationId = actorResult.data.organizationId;
  const [counts, reports, qualityReports, tasks, activity] = await Promise.all([
    repoResult.data.counts(organizationId),
    repoResult.data.activityLogs.list(organizationId, { limit: 50 }),
    repoResult.data.qualityReports.list(organizationId, { limit: 20 }),
    repoResult.data.tasks.list(organizationId, { limit: 100 }),
    repoResult.data.activityLogs.list(organizationId, { limit: 8 }),
  ]);

  const businessArtifacts = tasks.flatMap((task) =>
    (task.result?.artifacts ?? []).filter((artifact) => artifact.kind === 'business_report').map((artifact) => ({
      taskId: task.id,
      taskObjective: task.intent?.objective ?? task.request,
      artifact,
      createdAt: task.updatedAt,
    })),
  );
  const generatedReportEvents = reports.filter((event) => event.action === 'report.generated');

  const recordCoverage = [
    { label: 'Opportunities', value: recordLabel(counts.leads ?? 0, 'lead', 'No active opportunities yet') },
    { label: 'Relationships', value: recordLabel(counts.clients ?? 0, 'client', 'No client records yet') },
    { label: 'Research', value: recordLabel(counts.research_briefs ?? 0, 'brief', 'No research briefs yet') },
    { label: 'Content', value: recordLabel(counts.content_items ?? 0, 'content item', 'No content in motion') },
    { label: 'Email operations', value: recordLabel(counts.email_logs ?? 0, 'email record', 'No email activity yet') },
  ];

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Reporting is limited to records Nibrexo actually has. This is an operating view, not a dashboard of invented revenue, conversions or performance metrics."
        title="Business reporting"
        actions={<Link className="btn-primary" href="/manager?request=Give%20me%20a%20status%20report">Ask for a status report <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Card title="Current data coverage">
          <p className="mb-4 text-sm leading-6 text-slate-400">These are the operational records currently available to the organization. Counts describe saved records only; they are not performance claims.</p>
          <dl className="divide-y divide-surface-border/65">
            {recordCoverage.map((record) => (
              <div className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0" key={record.label}>
                <dt className="text-sm text-slate-400">{record.label}</dt>
                <dd className="text-right text-sm font-medium text-slate-200">{record.value}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-6 py-3 pb-0">
              <dt className="text-sm text-slate-400">Financial data</dt>
              <dd className="text-right text-sm font-medium text-slate-200">No financial data source is connected</dd>
            </div>
          </dl>
        </Card>

        <Card title="Quality record" action={qualityReports.length > 0 ? <Badge tone="info">{qualityReports.length} check{qualityReports.length === 1 ? '' : 's'}</Badge> : null}>
          {qualityReports.length === 0 ? (
            <EmptyState description="Quality checks created by the Manager will appear here with their actual findings and scores." icon={<ShieldCheckIcon size={19} />} title="No quality reports yet" />
          ) : (
            <div className="space-y-3">
              {qualityReports.map((report) => (
                <div className="rounded-xl border border-surface-border bg-surface/35 p-3.5" key={report.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-200">{report.subject}</p>
                    <Badge tone={report.passed ? 'success' : report.blocking ? 'danger' : 'warning'}>{report.score}/100</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{report.passed ? 'Passed the recorded quality checks' : report.blocking ? 'Blocking finding recorded' : 'Findings recorded for review'}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Generated reports" action={businessArtifacts.length > 0 ? <Badge tone="success">{businessArtifacts.length} available</Badge> : null}>
        {businessArtifacts.length === 0 ? (
          <EmptyState
            action={<Link className="btn-primary" href="/manager?request=Give%20me%20a%20status%20report">Generate an honest status report <ArrowRightIcon size={15} /></Link>}
            description={generatedReportEvents.length > 0 ? 'Report events exist in the audit log, but no structured business report artifact is available in the retained task record.' : 'No structured business reports have been generated yet.'}
            icon={<DocumentIcon size={19} />}
            title="No business reports available"
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {businessArtifacts.map((entry, index) => (
              <Link className="group rounded-xl border border-surface-border bg-surface/35 p-4 transition hover:border-slate-500 hover:bg-surface/55" href={`/manager?task=${entry.taskId}`} key={`${entry.taskId}-${index}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-100 group-hover:text-white">{entry.artifact.title}</p><p className="mt-1 text-xs leading-5 text-slate-500">From: {entry.taskObjective}</p></div><ArrowRightIcon className="shrink-0 text-slate-600 group-hover:text-brand-300" size={16} /></div>
                <p className="mt-3 text-[11px] text-slate-600">Updated {new Date(entry.createdAt).toLocaleString()}</p>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent reporting activity" action={<TrendIcon className="text-brand-300" size={17} />}>
        <ActivityTimeline
          activity={activity}
          emptyDescription="Reporting-related work will appear in the organization audit record after it happens."
          emptyTitle="No reporting activity yet"
          limit={8}
        />
      </Card>
    </div>
  );
}

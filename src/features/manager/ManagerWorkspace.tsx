'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApprovalQueue } from '@/components/cockpit/ApprovalQueue';
import { ManagerCommand } from '@/components/cockpit/ManagerCommand';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { RecentTasks, STATE_TONE, humanState } from '@/components/cockpit/RecentTasks';
import { Badge, Card, EmptyState, ErrorState, LoadingLines } from '@/components/ui/primitives';
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  CommandIcon,
  DocumentIcon,
  LightbulbIcon,
  ShieldCheckIcon,
  SparkIcon,
} from '@/components/ui/icons';
import type { ApprovalRecord } from '@/types/domain';
import type {
  ManagerArtifact,
  ManagerStage,
  ManagerTaskSnapshot,
  SkillDefinition,
  StepResult,
} from '@/types/manager';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

const PIPELINE: Array<{ key: 'request' | ManagerStage; label: string; detail: string }> = [
  { key: 'request', label: 'User request', detail: 'Your outcome and context' },
  { key: 'understand', label: 'Understands', detail: 'Clarifies the objective' },
  { key: 'classify', label: 'Classifies', detail: 'Identifies the work needed' },
  { key: 'plan', label: 'Plans', detail: 'Maps a safe path forward' },
  { key: 'select_skills', label: 'Selects skills', detail: 'Chooses useful capabilities' },
  { key: 'execute', label: 'Executes', detail: 'Completes permitted work' },
  { key: 'verify', label: 'Verifies', detail: 'Checks what actually happened' },
  { key: 'quality_control', label: 'Quality control', detail: 'Applies evidence and safety checks' },
  { key: 'deliver', label: 'Delivers', detail: 'Presents usable output' },
  { key: 'next_best_action', label: 'Next best action', detail: 'Recommends the highest-value move' },
];

const STEP_TONE: Record<StepResult['status'], 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending: 'neutral',
  running: 'info',
  awaiting_approval: 'warning',
  succeeded: 'success',
  failed: 'danger',
  skipped: 'neutral',
  denied: 'danger',
};

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stepStatusLabel(status: StepResult['status']) {
  const labels: Record<StepResult['status'], string> = {
    pending: 'Not started',
    running: 'Working',
    awaiting_approval: 'Waiting for you',
    succeeded: 'Completed',
    failed: 'Needs attention',
    skipped: 'Needs input',
    denied: 'Stopped',
  };
  return labels[status];
}

function displayFields(content: unknown): Array<{ label: string; value: string }> {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return [];
  const source = content as Record<string, unknown>;
  const primaryKeys = ['brief', 'concept', 'contentItem', 'emailLog', 'template', 'sequence', 'lead', 'report', 'memo', 'campaignPlan', 'socialPlan', 'communityPlan'];
  const entity = primaryKeys.map((key) => source[key]).find((value) => value && typeof value === 'object' && !Array.isArray(value));
  const record = (entity ?? source) as Record<string, unknown>;
  const excluded = new Set(['id', 'organization_id', 'created_at', 'updated_at', 'created_by', 'evidence', 'findings', 'status']);

  return Object.entries(record)
    .filter(([key, value]) => !excluded.has(key) && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      let formatted = '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        formatted = String(value);
      } else if (Array.isArray(value)) {
        formatted = value
          .slice(0, 4)
          .map((item) => {
            if (typeof item === 'string' || typeof item === 'number') return String(item);
            if (item && typeof item === 'object') {
              const candidate = item as Record<string, unknown>;
              return String(candidate.title ?? candidate.name ?? candidate.claim ?? candidate.subject ?? 'Structured item');
            }
            return '';
          })
          .filter(Boolean)
          .join(' · ');
        if (value.length > 4) formatted += ' · …';
      } else if (value && typeof value === 'object') {
        const nested = value as Record<string, unknown>;
        formatted = String(nested.title ?? nested.name ?? nested.topic ?? nested.subject ?? 'Structured details saved');
      }
      return { label: titleCase(key), value: formatted };
    })
    .filter((field) => field.value.length > 0)
    .slice(0, 5);
}

function ArtifactCard({ artifact }: { artifact: ManagerArtifact }) {
  const fields = displayFields(artifact.content);

  return (
    <article className="rounded-xl border border-surface-border bg-surface/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-300/15 bg-brand-400/10 text-brand-200">
            <DocumentIcon size={17} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-5 text-slate-100">{artifact.title}</h3>
            <p className="mt-1 text-xs text-slate-500">{titleCase(artifact.kind)}</p>
          </div>
        </div>
        {artifact.claims.length > 0 ? <Badge tone="info">{artifact.claims.length} labeled claim{artifact.claims.length === 1 ? '' : 's'}</Badge> : null}
      </div>

      {fields.length > 0 ? (
        <dl className="mt-4 space-y-2 border-l border-surface-border pl-3">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">{field.label}</dt>
              <dd className="mt-0.5 text-xs leading-5 text-slate-300">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-xs leading-5 text-slate-400">A structured deliverable was saved to this Manager task.</p>
      )}

      {artifact.uncertainties.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-300/15 bg-amber-400/[0.055] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">What still needs validation</p>
          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-amber-100/80">
            {artifact.uncertainties.slice(0, 3).map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function ProcessFlow({ task }: { task?: ManagerTaskSnapshot }) {
  const traceStages = new Set(task?.trace.map((entry) => entry.stage) ?? []);
  const activeIndex = PIPELINE.findIndex((stage) => stage.key !== 'request' && !traceStages.has(stage.key));

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Manager process">
      {PIPELINE.map((stage, index) => {
        const reached = stage.key === 'request' || traceStages.has(stage.key as ManagerStage);
        const active = !reached && (activeIndex === index || (task?.state === 'WAITING_APPROVAL' && stage.key === 'execute'));
        return (
          <div
            className={`relative rounded-xl border px-3 py-3 ${
              reached
                ? 'border-emerald-300/17 bg-emerald-400/[0.055]'
                : active
                  ? 'border-brand-300/25 bg-brand-400/[0.065]'
                  : 'border-surface-border bg-surface/30'
            }`}
            key={stage.key}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  reached
                    ? 'bg-emerald-300 text-emerald-950'
                    : active
                      ? 'bg-brand-300 text-brand-950'
                      : 'bg-slate-700 text-slate-400'
                }`}
              >
                {reached ? <CheckIcon size={12} /> : index + 1}
              </span>
              <span className="text-xs font-semibold text-slate-200">{stage.label}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-slate-500">{stage.detail}</p>
          </div>
        );
      })}
    </div>
  );
}

function TaskSummary({ task, skills }: { task: ManagerTaskSnapshot; skills: SkillDefinition[] }) {
  const intent = task.intent;
  const plan = task.plan;
  const selectedSkills = plan?.skills
    .map((id) => skills.find((skill) => skill.id === id)?.name ?? titleCase(id))
    .slice(0, 5) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <section className="rounded-xl border border-surface-border bg-surface/40 p-4">
        <p className="card-title">Manager understands</p>
        <h2 className="mt-2 text-base font-semibold leading-6 text-white">{intent?.objective ?? task.request}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{task.request}</p>
        {intent ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="info">{titleCase(intent.primary)}</Badge>
            <Badge>{titleCase(intent.deliverable)}</Badge>
            {intent.medicalDomain ? <Badge tone="warning">Professional review may be needed</Badge> : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-surface-border bg-surface/40 p-4">
        <p className="card-title">Plan at a glance</p>
        {plan ? (
          <>
            <p className="mt-2 text-sm leading-6 text-slate-300">{plan.goal}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {selectedSkills.map((skill) => <Badge key={skill}>{skill}</Badge>)}
            </div>
            {plan.openQuestions.length > 0 ? (
              <p className="mt-3 text-xs leading-5 text-amber-200">{plan.openQuestions.length} open question{plan.openQuestions.length === 1 ? '' : 's'} recorded without guessing.</p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">The Manager is still forming a plan.</p>
        )}
      </section>
    </div>
  );
}

function ExecutionBoard({ task }: { task: ManagerTaskSnapshot }) {
  if (!task.plan) return null;
  return (
    <div className="space-y-2">
      {task.plan.steps.map((step, index) => {
        const result = task.stepResults.find((item) => item.stepId === step.id);
        const status = result?.status ?? 'pending';
        return (
          <div className="flex gap-3 rounded-xl border border-surface-border bg-surface/35 p-3.5" key={step.id}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-xs font-semibold text-slate-400">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-100">{step.title}</h3>
                <Badge tone={STEP_TONE[status]}>{stepStatusLabel(status)}</Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-400">{step.rationale}</p>
              {result?.issues[0] ? <p className="mt-2 text-xs leading-5 text-amber-200">{result.issues[0].message}</p> : null}
              {step.requiresApproval && status !== 'succeeded' ? <p className="mt-2 text-[11px] font-medium text-amber-200">This action remains protected by human approval.</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Assurance({ task }: { task: ManagerTaskSnapshot }) {
  const verification = task.result?.verification;
  const quality = task.result?.quality;
  if (!verification && !quality) {
    return <EmptyState description="Verification and quality outcomes will appear after the Manager has completed enough work to assess." title="No assurance record yet" />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-xl border border-surface-border bg-surface/35 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-100">Verification</p>
          {verification ? <Badge tone={verification.ok ? 'success' : 'warning'}>{verification.ok ? 'Checked' : 'Review findings'}</Badge> : null}
        </div>
        {verification ? (
          <ul className="mt-3 space-y-2">
            {verification.checks.slice(0, 3).map((check) => (
              <li className="flex gap-2 text-xs leading-5 text-slate-400" key={check.name}>
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${check.passed ? 'bg-emerald-300' : 'bg-amber-300'}`} />
                {check.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="rounded-xl border border-surface-border bg-surface/35 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-100">Quality control</p>
          {quality ? <Badge tone={quality.passed ? 'success' : quality.blocking ? 'danger' : 'warning'}>{quality.score}/100</Badge> : null}
        </div>
        {quality ? (
          quality.findings.length === 0 ? (
            <p className="mt-3 text-xs leading-5 text-slate-400">No quality findings were recorded.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {quality.findings.slice(0, 3).map((finding) => (
                <li className="text-xs leading-5 text-slate-400" key={`${finding.id}-${finding.detail}`}>
                  <span className="font-medium text-slate-200">{finding.rule}:</span> {finding.detail}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}

export function ManagerWorkspace({
  skills,
  canDecide,
  initialTaskId = null,
  initialRequest = '',
}: {
  skills: SkillDefinition[];
  canDecide: boolean;
  initialTaskId?: string | null;
  initialRequest?: string;
}) {
  const router = useRouter();
  const [task, setTask] = useState<ManagerTaskSnapshot | null>(null);
  const [recentTasks, setRecentTasks] = useState<ManagerTaskSnapshot[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [loadingTask, setLoadingTask] = useState(Boolean(initialTaskId));
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadApprovals = useCallback(async (taskId: string) => {
    const response = await fetch('/api/manager/approvals');
    const payload = (await response.json()) as ApiEnvelope<ApprovalRecord[]>;
    if (response.ok && payload.ok && payload.data) {
      setApprovals(payload.data.filter((approval) => approval.task_id === taskId));
    }
  }, []);

  const loadTask = useCallback(async (taskId: string) => {
    setLoadingTask(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/manager/tasks/${taskId}`);
      const payload = (await response.json()) as ApiEnvelope<ManagerTaskSnapshot>;
      if (!response.ok || !payload.ok || !payload.data) {
        setLoadError(payload.error?.message ?? 'This Manager task could not be loaded.');
        return;
      }
      setTask(payload.data);
      await loadApprovals(payload.data.id);
    } catch {
      setLoadError('Network error while loading this Manager task.');
    } finally {
      setLoadingTask(false);
    }
  }, [loadApprovals]);

  const loadRecent = useCallback(async () => {
    try {
      const response = await fetch('/api/manager/tasks?limit=8');
      const payload = (await response.json()) as ApiEnvelope<ManagerTaskSnapshot[]>;
      if (response.ok && payload.ok && payload.data) setRecentTasks(payload.data);
    } catch {
      // Recent context is helpful, never required to start a new task.
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    if (initialTaskId) void loadTask(initialTaskId);
  }, [initialTaskId, loadTask]);

  const selectedApprovals = useMemo(
    () => approvals.filter((approval) => approval.status === 'pending'),
    [approvals],
  );

  const onTaskCreated = useCallback(
    (created: ManagerTaskSnapshot) => {
      setTask(created);
      setApprovals([]);
      setLoadError(null);
      setRecentTasks((existing) => [created, ...existing.filter((item) => item.id !== created.id)].slice(0, 8));
      router.replace(`/manager?task=${created.id}`);
      void loadApprovals(created.id);
    },
    [loadApprovals, router],
  );

  const refreshSelectedTask = useCallback(async () => {
    if (task?.id) {
      await loadTask(task.id);
      await loadRecent();
    }
  }, [loadRecent, loadTask, task?.id]);

  return (
    <div className="mx-auto max-w-[1540px] space-y-6">
      <PageHeader
        description="Nibrexo turns your objective into a safe, visible sequence of work: it understands, plans, acts within its permissions, verifies the outcome and recommends what should happen next."
        title="Manager workspace"
        actions={
          task ? (
            <Link className="btn-secondary" href="/dashboard">
              CEO cockpit <ArrowRightIcon size={15} />
            </Link>
          ) : null
        }
      />

      <ManagerCommand initialValue={initialRequest} onTaskCreated={onTaskCreated} />

      {loadError ? <ErrorState message={loadError} /> : null}

      {loadingTask ? (
        <Card title="Loading Manager work">
          <LoadingLines rows={5} />
        </Card>
      ) : null}

      {task && !loadingTask ? (
        <>
          <section className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/80 shadow-[0_12px_30px_rgba(0,0,0,0.12)]">
            <div className="flex flex-col gap-4 border-b border-surface-border p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-300/20 bg-brand-400/10 text-brand-200">
                  <CommandIcon size={19} />
                </span>
                <div className="min-w-0">
                  <p className="page-eyebrow">Current Manager assignment</p>
                  <h2 className="mt-1 text-lg font-semibold leading-6 text-white">{task.intent?.objective ?? task.request}</h2>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-400">{task.result?.summary ?? 'The Manager is still processing this request.'}</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge tone={STATE_TONE[task.state] ?? 'neutral'}>{humanState(task.state)}</Badge>
                {task.result?.aiEnabled === false ? <Badge>Structured planning</Badge> : null}
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><ClockIcon size={13} /> Updated {new Date(task.updatedAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <ProcessFlow task={task} />
            </div>
          </section>

          <TaskSummary skills={skills} task={task} />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.42fr)_minmax(330px,0.78fr)]">
            <div className="space-y-6">
              <Card title="Execution">
                <ExecutionBoard task={task} />
              </Card>

              <Card title="Verification & quality">
                <Assurance task={task} />
              </Card>

              <Card
                title="Delivered work"
                action={task.result?.artifacts.length ? <Badge tone="success">{task.result.artifacts.length} saved</Badge> : null}
              >
                {task.result?.artifacts.length ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {task.result.artifacts.map((artifact, index) => <ArtifactCard artifact={artifact} key={`${artifact.title}-${index}`} />)}
                  </div>
                ) : (
                  <EmptyState
                    description="The Manager has not saved a deliverable for this task yet. If work is paused, review the decision or missing input shown above."
                    title="No delivered work yet"
                  />
                )}
              </Card>
            </div>

            <aside className="space-y-6">
              <Card
                title="Decision required"
                action={selectedApprovals.length > 0 ? <Badge tone="warning">{selectedApprovals.length} waiting</Badge> : <Badge tone="success">Clear</Badge>}
              >
                <ApprovalQueue
                  approvals={selectedApprovals}
                  canDecide={canDecide}
                  compact={false}
                  emptyDescription="No external or high-impact action is waiting on you for this assignment."
                  emptyTitle="No decision pending"
                  onDecisionComplete={refreshSelectedTask}
                />
              </Card>

              <Card title="Next best action">
                {task.result?.nextBestAction.length ? (
                  <div className="space-y-3">
                    {task.result.nextBestAction.slice(0, 3).map((action, index) => (
                      <div className={`rounded-xl border p-3.5 ${index === 0 ? 'border-brand-300/20 bg-brand-400/[0.055]' : 'border-surface-border bg-surface/30'}`} key={`${action.title}-${index}`}>
                        {index === 0 ? <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-brand-300">Recommended now</p> : null}
                        <div className="mt-1.5 flex items-start gap-2">
                          <LightbulbIcon className="mt-0.5 shrink-0 text-brand-200" size={16} />
                          <div>
                            <p className="text-sm font-semibold leading-5 text-slate-100">{action.title}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-400">{action.rationale}</p>
                            {action.requiresApproval ? <Badge tone="warning"><ShieldCheckIcon size={12} /> Human decision required</Badge> : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState description="The Manager will recommend a next move once this work has enough context." icon={<LightbulbIcon size={19} />} title="No recommendation yet" />
                )}
              </Card>

              {task.plan?.openQuestions.length ? (
                <Card title="Open questions">
                  <ul className="space-y-3">
                    {task.plan.openQuestions.map((question) => (
                      <li className="flex gap-2 text-sm leading-6 text-slate-300" key={question}>
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                        {question}
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {task.result?.issues.length ? (
                <Card title="Needs attention">
                  <ul className="space-y-3">
                    {task.result.issues.map((issue) => (
                      <li className="rounded-lg border border-amber-300/15 bg-amber-400/[0.045] p-3 text-xs leading-5 text-amber-100" key={`${issue.code}-${issue.message}`}>
                        <p className="font-semibold">{issue.code.replace(/_/g, ' ')}</p>
                        <p className="mt-1 text-amber-100/80">{issue.message}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </aside>
          </div>

          <details className="group rounded-2xl border border-surface-border bg-surface/30 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-300">
              <span className="flex items-center gap-2"><SparkIcon className="text-brand-300" size={16} /> Manager run record</span>
              <ArrowRightIcon className="transition group-open:rotate-90" size={15} />
            </summary>
            <ol className="mt-4 space-y-3 border-l border-surface-border pl-4">
              {task.trace.map((entry, index) => (
                <li className="relative text-sm leading-6 text-slate-400" key={`${entry.stage}-${entry.at}-${index}`}>
                  <span className="absolute -left-[21px] top-2 h-2 w-2 rounded-full bg-brand-300" />
                  <span className="font-medium text-slate-200">{titleCase(entry.stage)}:</span> {entry.message}
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : !loadingTask ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
          <Card title="How your Manager works">
            <p className="max-w-2xl text-sm leading-6 text-slate-400">You set the direction. The Manager makes the work legible, uses only the capabilities that fit, verifies what happened and pauses for you before any protected action.</p>
            <div className="mt-5"><ProcessFlow /></div>
          </Card>
          <Card title="Recent assignments">
            <RecentTasks
              emptyDescription="Your completed and in-progress Manager work will be kept here as useful context."
              emptyTitle="No assignment yet"
              tasks={recentTasks}
            />
          </Card>
        </div>
      ) : null}
    </div>
  );
}

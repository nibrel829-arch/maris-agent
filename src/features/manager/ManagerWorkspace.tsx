'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApprovalQueue } from '@/components/cockpit/ApprovalQueue';
import { ManagerCommand } from '@/components/cockpit/ManagerCommand';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { RecentTasks } from '@/components/cockpit/RecentTasks';
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
import type { ArtifactPreview } from '@/server/artifacts/preview';
import type {
  ManagerClarification,
  ManagerStage,
  ManagerTaskSnapshot,
  SkillDefinition,
  StepResult,
} from '@/types/manager';
import { needsPerson, taskStateLabel, taskStateTone, type TaskTone } from './status';

type ArtifactSummary = NonNullable<ManagerTaskSnapshot['result']>['deliverables'][number];

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

const PIPELINE: Array<{ key: 'request' | ManagerStage; label: string; detail: string }> = [
  { key: 'request', label: 'Your request', detail: 'Your outcome and context' },
  { key: 'understand', label: 'Understands', detail: 'Clarifies the objective' },
  { key: 'classify', label: 'Classifies', detail: 'Identifies the work needed' },
  { key: 'plan', label: 'Plans', detail: 'Maps the steps and questions' },
  { key: 'select_skills', label: 'Selects skills', detail: 'Chooses useful capabilities' },
  { key: 'execute', label: 'Executes', detail: 'Runs permitted steps' },
  { key: 'verify', label: 'Verifies', detail: 'Checks what actually happened' },
  { key: 'quality_control', label: 'Quality control', detail: 'Applies evidence and safety checks' },
  { key: 'deliver', label: 'Delivers', detail: 'Stores the real deliverables' },
  { key: 'next_best_action', label: 'Next best action', detail: 'Recommends the highest-value move' },
];

const STEP_TONE: Record<StepResult['status'], TaskTone> = {
  pending: 'neutral',
  running: 'info',
  awaiting_approval: 'warning',
  succeeded: 'success',
  failed: 'danger',
  skipped: 'warning',
  denied: 'danger',
};

const STEP_LABEL: Record<StepResult['status'], string> = {
  pending: 'Queued',
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  succeeded: 'Completed',
  failed: 'Failed',
  skipped: 'Needs input',
  denied: 'Blocked by permission',
};

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProcessFlow({ task }: { task?: ManagerTaskSnapshot }) {
  const traceStages = new Set(task?.trace.map((entry) => entry.stage) ?? []);
  const activeIndex = PIPELINE.findIndex((stage) => stage.key !== 'request' && !traceStages.has(stage.key));
  const paused = task ? needsPerson(task.state) : false;

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Manager process">
      {PIPELINE.map((stage, index) => {
        const reached = stage.key === 'request' || traceStages.has(stage.key as ManagerStage);
        const active = !reached && (activeIndex === index || (paused && stage.key === 'execute'));
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
  const selectedSkills =
    plan?.skills.map((id) => skills.find((skill) => skill.id === id)?.name ?? titleCase(id)).slice(0, 5) ?? [];
  const openCount = plan?.clarifications?.filter((item) => item.answer === null).length ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <section className="rounded-xl border border-surface-border bg-surface/40 p-4">
        <p className="card-title">Your request</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">{task.request}</p>
        {intent ? (
          <>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Understood as: <span className="text-slate-300">{intent.objective}</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="info">{titleCase(intent.primary)}</Badge>
              <Badge>{titleCase(intent.deliverable)}</Badge>
              {intent.medicalDomain ? <Badge tone="warning">Professional review may be needed</Badge> : null}
            </div>
          </>
        ) : null}
      </section>

      <section className="rounded-xl border border-surface-border bg-surface/40 p-4">
        <p className="card-title">Plan at a glance</p>
        {plan ? (
          <>
            <p className="mt-2 text-sm leading-6 text-slate-300">{plan.steps.length} step(s), planned by the {plan.planner} planner.</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {selectedSkills.map((skill) => <Badge key={skill}>{skill}</Badge>)}
            </div>
            {openCount > 0 ? (
              <p className="mt-3 text-xs leading-5 text-amber-200">
                {openCount} question{openCount === 1 ? '' : 's'} need an answer before the work can finish.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">The Manager is still forming a plan.</p>
        )}
      </section>
    </div>
  );
}

/** Questions the Manager asked. Answers are saved to the plan and the task resumes. */
function QuestionsPanel({
  clarifications,
  canWork,
  busy,
  onSubmit,
}: {
  clarifications: ManagerClarification[];
  canWork: boolean;
  busy: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const open = clarifications.filter((item) => item.answer === null);
  const [values, setValues] = useState<Record<string, string>>({});
  const filled = open.filter((item) => (values[item.field] ?? '').trim().length > 0);

  if (open.length === 0) return null;

  return (
    <Card title="Needs your input">
      <p className="mb-4 text-xs leading-5 text-slate-400">
        The Manager did not guess these details. Answer what you can. The work resumes with your answers and nothing is invented.
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (filled.length === 0) return;
          const answers: Record<string, string> = {};
          for (const item of filled) answers[item.field] = (values[item.field] ?? '').trim();
          onSubmit(answers);
        }}
      >
        {open.map((item) => (
          <label className="block" key={item.field}>
            <span className="text-sm font-medium text-slate-200">{item.question}</span>
            <textarea
              className="input mt-2 min-h-[72px] w-full resize-y leading-6"
              disabled={!canWork || busy}
              maxLength={2000}
              name={item.field}
              onChange={(event) => setValues((current) => ({ ...current, [item.field]: event.target.value }))}
              placeholder={canWork ? 'Your answer' : 'Your role can view this question but not answer it.'}
              value={values[item.field] ?? ''}
            />
            <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-slate-600">Field: {item.field}</span>
          </label>
        ))}
        {canWork ? (
          <button className="btn-primary" disabled={busy || filled.length === 0} type="submit">
            {busy ? 'Saving…' : 'Save answers and continue'}
          </button>
        ) : null}
      </form>
    </Card>
  );
}

function ExecutionBoard({ task }: { task: ManagerTaskSnapshot }) {
  if (!task.plan) return null;
  return (
    <div className="space-y-2">
      {task.plan.steps.map((step, index) => {
        const result = task.stepResults.find((item) => item.stepId === step.id);
        const status: StepResult['status'] | 'pending' = result?.status ?? 'pending';
        const issue = result?.issues[0];
        return (
          <div className="rounded-xl border border-surface-border bg-surface/35 p-3.5" key={step.id}>
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-xs font-semibold text-slate-400">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-medium text-slate-100">{step.title}</h3>
                  <Badge tone={status === 'pending' ? 'neutral' : STEP_TONE[status]}>
                    {status === 'pending' ? 'Queued' : STEP_LABEL[status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-400">{step.rationale}</p>
              </div>
            </div>

            <dl className="mt-3 grid gap-x-4 gap-y-1 pl-10 text-[11px] text-slate-500 sm:grid-cols-3">
              <div>
                <dt className="inline">Tool: </dt>
                <dd className="inline font-mono text-slate-400">{step.toolName ?? 'none'}</dd>
              </div>
              <div>
                <dt className="inline">Started: </dt>
                <dd className="inline text-slate-400">{formatTime(result?.startedAt)}</dd>
              </div>
              <div>
                <dt className="inline">Finished: </dt>
                <dd className="inline text-slate-400">{formatTime(result?.finishedAt)}</dd>
              </div>
            </dl>

            {issue ? (
              <p className="mt-2 pl-10 text-xs leading-5 text-amber-200">
                <span className="font-semibold">{issue.code.replace(/_/g, ' ')}:</span> {issue.message}
              </p>
            ) : null}
            {step.requiresApproval && status !== 'succeeded' ? (
              <p className="mt-2 pl-10 text-[11px] font-medium text-amber-200">This action remains protected by human approval.</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Errors, why the task is not complete, and the next recovery step. */
function ReasonsPanel({
  task,
  canWork,
  busy,
  onRetry,
}: {
  task: ManagerTaskSnapshot;
  canWork: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  const reasons = task.result?.reasons ?? [];
  if (reasons.length === 0) return null;
  const retryable = task.state === 'FAILED' || task.state === 'BLOCKED';

  return (
    <Card title={task.state === 'COMPLETED' ? 'Notes' : 'Why this is not complete'}>
      <ul className="space-y-3">
        {reasons.map((reason, index) => (
          <li className="rounded-lg border border-amber-300/15 bg-amber-400/[0.045] p-3 text-xs leading-5 text-amber-100" key={`${reason.code}-${index}`}>
            <p className="font-semibold">{reason.code.replace(/_/g, ' ')}{reason.stepId ? ` · ${reason.stepId}` : ''}</p>
            <p className="mt-1 text-amber-100/85">{reason.message}</p>
          </li>
        ))}
      </ul>
      {retryable ? (
        <div className="mt-4">
          <p className="mb-2 text-xs leading-5 text-slate-400">
            After fixing the cause (for example connecting a provider or changing permissions), the Manager re-runs only the steps that did not succeed.
          </p>
          {canWork ? (
            <button className="btn-secondary" disabled={busy} onClick={onRetry} type="button">
              {busy ? 'Retrying…' : 'Retry the unfinished steps'}
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function DeliverableList({ deliverables, empty }: { deliverables: ArtifactSummary[]; empty: string }) {
  if (deliverables.length === 0) {
    return <EmptyState description={empty} title="No deliverables yet" />;
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {deliverables.map((item) => (
        <li className="flex flex-col justify-between gap-4 rounded-xl border border-surface-border bg-surface/45 p-4" key={item.id}>
          <div className="flex min-w-0 gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-300/15 bg-brand-400/10 text-brand-200">
              <DocumentIcon size={17} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold leading-5 text-slate-100" title={item.title}>{item.title}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {titleCase(item.kind)} · {item.format.toUpperCase()} · {formatBytes(item.size_bytes)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-600">Created {formatTime(item.created_at)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn-secondary self-start" download={item.file_name} href={`/api/manager/artifacts/${item.id}`}>
              Download {item.format.toUpperCase()}
            </a>
          </div>
          <DeliverablePreview id={item.id} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Bounded preview of a stored deliverable, loaded on request. It shows the
 * same bytes as the download (server-derived, authorized, capped in size).
 */
function DeliverablePreview({ id }: { id: string }) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; preview?: ArtifactPreview; message?: string }>({ status: 'idle' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const response = await fetch(`/api/manager/artifacts/${id}/preview`, { cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as
        | { ok: true; data: { preview: ArtifactPreview } }
        | { ok: false; error?: { message?: string } }
        | null;
      if (!response.ok || !body || body.ok !== true) {
        throw new Error((body && !body.ok && body.error?.message) || 'The preview could not be loaded.');
      }
      setState({ status: 'ready', preview: body.data.preview });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'The preview could not be loaded.' });
    }
  }, [id]);

  if (state.status === 'idle') {
    return (
      <button className="btn-secondary self-start" onClick={() => void load()} type="button">
        Preview
      </button>
    );
  }
  if (state.status === 'loading') return <p className="text-xs text-slate-500">Loading preview…</p>;
  if (state.status === 'error') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-rose-300">{state.message}</p>
        <button className="btn-secondary self-start" onClick={() => void load()} type="button">Try again</button>
      </div>
    );
  }

  const preview = state.preview;
  if (!preview) return null;
  if (preview.kind === 'table') {
    return (
      <div className="flex flex-col gap-2">
        <div className="max-h-64 overflow-auto rounded-lg border border-surface-border">
          <table className="min-w-full text-left text-xs text-slate-300">
            <thead className="sticky top-0 bg-surface text-slate-400">
              <tr>{preview.headers.map((header) => <th className="px-2 py-1.5 font-medium" key={header}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {preview.rows.map((row, rowIndex) => (
                <tr className="border-t border-surface-border" key={rowIndex}>
                  {row.map((cell, cellIndex) => <td className="px-2 py-1.5 align-top" key={cellIndex}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">
          Showing {preview.rows.length} of {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'}.
        </p>
      </div>
    );
  }
  if (preview.kind === 'text') {
    return (
      <div className="flex flex-col gap-2">
        <div className="max-h-64 space-y-2 overflow-auto rounded-lg border border-surface-border p-3 text-xs leading-5 text-slate-300">
          {preview.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
        <p className="text-[11px] text-slate-500">
          Showing {preview.paragraphs.length} of {preview.totalParagraphs} paragraph{preview.totalParagraphs === 1 ? '' : 's'}.
        </p>
      </div>
    );
  }
  return <p className="text-xs text-slate-500">{preview.kind === 'unsupported' ? preview.reason : preview.message}</p>;
}

function Assurance({ task }: { task: ManagerTaskSnapshot }) {
  const verification = task.result?.verification;
  const quality = task.result?.quality;
  if (!verification && !quality) {
    return <EmptyState description="Verification and quality outcomes appear once the Manager has executed enough steps to assess." title="No assurance record yet" />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-xl border border-surface-border bg-surface/35 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-100">Verification</p>
          {verification ? (
            <Badge tone={verification.ok ? 'success' : 'warning'}>{verification.ok ? 'Verified' : 'Not verified'}</Badge>
          ) : null}
        </div>
        {verification ? (
          <ul className="mt-3 space-y-2">
            {verification.checks.map((check) => (
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
              {quality.findings.slice(0, 4).map((finding) => (
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

/** Approval and audit history for this assignment, with decision times. */
function HistoryPanel({ task, approvals }: { task: ManagerTaskSnapshot; approvals: ApprovalRecord[] }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="card-title mb-2">Approvals</p>
        {approvals.length === 0 ? (
          <p className="text-xs leading-5 text-slate-500">No external action has required an approval for this assignment.</p>
        ) : (
          <ul className="space-y-2">
            {approvals.map((approval) => (
              <li className="rounded-lg border border-surface-border bg-surface/30 p-3 text-xs leading-5 text-slate-400" key={approval.id}>
                <span className="font-medium text-slate-200">{approval.action}</span> · {approval.tool_name} · risk {approval.risk}
                <br />
                Status: <span className="text-slate-200">{titleCase(approval.status)}</span>
                {approval.decided_at ? <> · decided {formatTime(approval.decided_at)}</> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="card-title mb-2">Run record</p>
        <ol className="space-y-3 border-l border-surface-border pl-4">
          {task.trace.map((entry, index) => (
            <li className="relative text-sm leading-6 text-slate-400" key={`${entry.stage}-${entry.at}-${index}`}>
              <span className="absolute -left-[21px] top-2 h-2 w-2 rounded-full bg-brand-300" />
              <span className="text-xs text-slate-500">{formatTime(entry.at)}</span>
              <br />
              <span className="font-medium text-slate-200">{titleCase(entry.stage)}:</span> {entry.message}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function ManagerWorkspace({
  skills,
  canDecide,
  canWork = false,
  initialTaskId = null,
  initialRequest = '',
}: {
  skills: SkillDefinition[];
  canDecide: boolean;
  /** ai:create — may start, answer and resume work. */
  canWork?: boolean;
  initialTaskId?: string | null;
  initialRequest?: string;
}) {
  const router = useRouter();
  const [task, setTask] = useState<ManagerTaskSnapshot | null>(null);
  const [recentTasks, setRecentTasks] = useState<ManagerTaskSnapshot[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [orgDeliverables, setOrgDeliverables] = useState<ArtifactSummary[]>([]);
  const [loadingTask, setLoadingTask] = useState(Boolean(initialTaskId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadApprovals = useCallback(async (taskId: string) => {
    const response = await fetch('/api/manager/approvals');
    const payload = (await response.json()) as ApiEnvelope<ApprovalRecord[]>;
    if (response.ok && payload.ok && payload.data) {
      setApprovals(payload.data.filter((approval) => approval.task_id === taskId));
    }
  }, []);

  const loadTask = useCallback(
    async (taskId: string) => {
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
    },
    [loadApprovals],
  );

  const loadRecent = useCallback(async () => {
    try {
      const response = await fetch('/api/manager/tasks?limit=8');
      const payload = (await response.json()) as ApiEnvelope<ManagerTaskSnapshot[]>;
      if (response.ok && payload.ok && payload.data) setRecentTasks(payload.data);
    } catch {
      // Recent context is helpful, never required to start a new task.
    }
  }, []);

  const loadDeliverables = useCallback(async () => {
    try {
      const response = await fetch('/api/manager/deliverables');
      const payload = (await response.json()) as ApiEnvelope<ArtifactSummary[]>;
      if (response.ok && payload.ok && payload.data) setOrgDeliverables(payload.data);
    } catch {
      // Shown as empty; the task view still lists its own deliverables.
    }
  }, []);

  useEffect(() => {
    void loadRecent();
    void loadDeliverables();
  }, [loadRecent, loadDeliverables]);

  useEffect(() => {
    if (initialTaskId) void loadTask(initialTaskId);
  }, [initialTaskId, loadTask]);

  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === 'pending'), [approvals]);

  const onTaskCreated = useCallback(
    (created: ManagerTaskSnapshot) => {
      setTask(created);
      setApprovals([]);
      setLoadError(null);
      setActionError(null);
      setRecentTasks((existing) => [created, ...existing.filter((item) => item.id !== created.id)].slice(0, 8));
      router.replace(`/manager?task=${created.id}`);
      void loadApprovals(created.id);
      void loadDeliverables();
    },
    [loadApprovals, loadDeliverables, router],
  );

  /** Resumes the task, optionally with answers. The server re-checks everything. */
  const continueTask = useCallback(
    async (answers?: Record<string, string>) => {
      if (!task) return;
      setBusy(true);
      setActionError(null);
      try {
        const response = await fetch(`/api/manager/tasks/${task.id}/resume`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(answers ? { answers } : {}),
        });
        const payload = (await response.json()) as ApiEnvelope<ManagerTaskSnapshot>;
        if (!response.ok || !payload.ok || !payload.data) {
          setActionError(payload.error?.message ?? 'The assignment could not continue. Nothing was changed.');
          return;
        }
        setTask(payload.data);
        await loadApprovals(payload.data.id);
        await loadRecent();
        await loadDeliverables();
      } catch {
        setActionError('Network error. The assignment did not change; try again.');
      } finally {
        setBusy(false);
      }
    },
    [loadApprovals, loadDeliverables, loadRecent, task],
  );

  const refreshSelectedTask = useCallback(async () => {
    if (task?.id) {
      await loadTask(task.id);
      await loadRecent();
      await loadDeliverables();
    }
  }, [loadDeliverables, loadRecent, loadTask, task?.id]);

  const deliverables = task?.result?.deliverables ?? [];
  const clarifications = task?.plan?.clarifications ?? [];

  return (
    <div className="mx-auto max-w-[1540px] space-y-6">
      <PageHeader
        description="Nibrexo turns your objective into visible work: it plans the steps, runs what it is permitted to run, asks you for anything missing, verifies the result and stores the real deliverables."
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
      {actionError ? <ErrorState message={actionError} /> : null}

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
                <Badge tone={taskStateTone(task.state)}>{taskStateLabel(task.state)}</Badge>
                {task.result?.aiEnabled === false ? <Badge>Structured planning</Badge> : null}
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><ClockIcon size={13} /> Updated {formatTime(task.updatedAt)}</span>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <ProcessFlow task={task} />
            </div>
          </section>

          <TaskSummary skills={skills} task={task} />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.42fr)_minmax(330px,0.78fr)]">
            <div className="space-y-6">
              {task.state === 'NEEDS_INPUT' ? (
                <QuestionsPanel
                  busy={busy}
                  canWork={canWork}
                  clarifications={clarifications}
                  onSubmit={(answers) => void continueTask(answers)}
                />
              ) : null}

              <Card title="Plan and step progress">
                <ExecutionBoard task={task} />
              </Card>

              <Card title="Verification & quality">
                <Assurance task={task} />
              </Card>

              <Card
                title="Deliverables"
                action={deliverables.length ? <Badge tone="success">{deliverables.length} stored</Badge> : null}
              >
                <DeliverableList
                  deliverables={deliverables}
                  empty={
                    task.state === 'COMPLETED'
                      ? 'This task completed without a stored deliverable. Treat it as not delivered and check the reasons.'
                      : 'Deliverables are stored only after verification passes. Answer the questions or resolve the reasons to produce them.'
                  }
                />
              </Card>
            </div>

            <aside className="space-y-6">
              <Card
                title="Decision required"
                action={pendingApprovals.length > 0 ? <Badge tone="warning">{pendingApprovals.length} waiting</Badge> : <Badge tone="success">Clear</Badge>}
              >
                <ApprovalQueue
                  approvals={pendingApprovals}
                  canDecide={canDecide}
                  compact={false}
                  emptyDescription="No external or high-impact action is waiting on you for this assignment."
                  emptyTitle="No decision pending"
                  onDecisionComplete={refreshSelectedTask}
                />
              </Card>

              <ReasonsPanel busy={busy} canWork={canWork} onRetry={() => void continueTask()} task={task} />

              {task.state === 'WAITING_APPROVAL' && canWork ? (
                <Card title="Continue after a decision">
                  <p className="mb-3 text-xs leading-5 text-slate-400">Once the approval is decided, continue the assignment to run the approved step.</p>
                  <button className="btn-secondary" disabled={busy} onClick={() => void continueTask()} type="button">
                    {busy ? 'Continuing…' : 'Continue assignment'}
                  </button>
                </Card>
              ) : null}

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

              <Card title="Audit and approval history">
                <HistoryPanel approvals={approvals} task={task} />
              </Card>
            </aside>
          </div>

          <details className="group rounded-2xl border border-surface-border bg-surface/30 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-300">
              <span className="flex items-center gap-2"><SparkIcon className="text-brand-300" size={16} /> Full Manager trace</span>
              <ArrowRightIcon className="transition group-open:rotate-90" size={15} />
            </summary>
            <p className="mt-3 text-xs text-slate-500">The complete record is kept with timestamps in the audit and approval history panel.</p>
          </details>
        </>
      ) : !loadingTask ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
          <Card title="How your Manager works">
            <p className="max-w-2xl text-sm leading-6 text-slate-400">You set the direction. The Manager makes the work visible, asks for anything it cannot responsibly assume, uses only permitted capabilities, verifies the output and stores the deliverables it actually produced. Protected actions wait for your approval.</p>
            <div className="mt-5"><ProcessFlow /></div>
          </Card>
          <Card title="Recent assignments">
            <RecentTasks
              emptyDescription="Your assignments will be kept here with their status."
              emptyTitle="No assignment yet"
              tasks={recentTasks}
            />
          </Card>
        </div>
      ) : null}

      {!loadingTask ? (
        <Card title="Deliverables" action={orgDeliverables.length ? <Badge tone="success">{orgDeliverables.length} stored</Badge> : null}>
          <DeliverableList
            deliverables={orgDeliverables}
            empty="Deliverables from completed assignments appear here, with their download links."
          />
        </Card>
      ) : null}
    </div>
  );
}

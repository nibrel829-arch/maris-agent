'use client';

import { useCallback, useState } from 'react';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import type { ManagerTaskSnapshot, SkillDefinition } from '@/types/manager';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

const EXAMPLES = [
  'Research the market for dental scheduling software',
  'Research dental implant aftercare protocols',
  'Build a product: a treatment-planning template pack for clinics',
  'Create a LinkedIn post announcing our new patient follow-up service',
  'Prepare a follow-up email for the clinic at clinic@example.com',
  'Give me a status report on the workspace',
];

const STATE_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  WAITING_APPROVAL: 'warning',
  EXECUTING: 'info',
  VERIFYING: 'info',
  PLANNING: 'info',
  RECEIVED: 'neutral',
  CANCELLED: 'neutral',
};

const STAGE_LABELS: Record<string, string> = {
  understand: 'Understand',
  classify: 'Classify',
  plan: 'Plan',
  select_skills: 'Select skills',
  execute: 'Execute',
  verify: 'Verify',
  quality_control: 'Quality control',
  deliver: 'Deliver',
  next_best_action: 'Next best action',
};

export function ManagerWorkspace({ skills }: { skills: SkillDefinition[] }) {
  const [request, setRequest] = useState('');
  const [task, setTask] = useState<ManagerTaskSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (request.trim().length < 3) {
      setError('Describe what you need in at least 3 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    setTask(null);

    try {
      const response = await fetch('/api/manager/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request }),
      });
      const payload = (await response.json()) as ApiEnvelope<ManagerTaskSnapshot>;
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'The Manager could not process this request.');
      } else {
        setTask(payload.data);
      }
    } catch {
      setError('Network error while contacting the Manager.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  const decide = useCallback(
    async (approvalId: string, decision: 'approved' | 'rejected') => {
      try {
        await fetch(`/api/manager/approvals/${approvalId}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        });
        if (task?.id) {
          const resumed = await fetch(`/api/manager/tasks/${task.id}/resume`, { method: 'POST' });
          const payload = (await resumed.json()) as ApiEnvelope<ManagerTaskSnapshot>;
          if (payload.ok && payload.data) setTask(payload.data);
        }
      } catch {
        setError('Could not record the approval decision.');
      }
    },
    [task?.id],
  );

  const result = task?.result ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">CEO / Manager</h1>
        <p className="mt-1 text-sm text-slate-400">
          Give the Manager an objective. It understands, classifies, plans, selects skills, executes,
          verifies, runs quality control and reports the next best action.
        </p>
      </div>

      <Card title="Manager request">
        <textarea
          className="input min-h-[120px] resize-y font-normal"
          placeholder="e.g. Build a product: a treatment-planning template pack for dental clinics"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          disabled={loading}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Manager working…' : 'Hand to Manager'}
          </button>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              className="btn-secondary text-xs"
              onClick={() => setRequest(example)}
              disabled={loading}
            >
              {example.length > 42 ? `${example.slice(0, 42)}…` : example}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mt-4">
            <ErrorState message={error} />
          </div>
        ) : null}
      </Card>

      <Card title="Available skills">
        <p className="mb-3 text-sm text-slate-400">
          {skills.length} modular capabilities. The Manager decides which ones a request needs.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <div key={skill.id} className="rounded-lg border border-surface-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-100">{skill.name}</p>
                <Badge tone={skill.maxRisk === 'high' ? 'warning' : 'neutral'}>
                  {skill.maxRisk}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-400">{skill.description}</p>
            </div>
          ))}
        </div>
      </Card>

      {task ? (
        <>
          <Card
            title="Task"
            action={
              <div className="flex items-center gap-2">
                <Badge tone={STATE_TONE[task.state] ?? 'neutral'}>{task.state}</Badge>
                {result ? (
                  <Badge tone={result.aiEnabled ? 'info' : 'neutral'}>
                    AI {result.aiEnabled ? 'enabled' : 'not configured'}
                  </Badge>
                ) : null}
              </div>
            }
          >
            <p className="text-sm text-slate-300">{task.request}</p>

            {task.intent ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge tone="info">{task.intent.primary.replace(/_/g, ' ')}</Badge>
                {task.intent.secondary.map((workType) => (
                  <Badge key={workType}>{workType.replace(/_/g, ' ')}</Badge>
                ))}
                <Badge tone="neutral">
                  confidence {Math.round(task.intent.confidence * 100)}%
                </Badge>
                {task.intent.medicalDomain ? (
                  <Badge tone="warning">medical domain</Badge>
                ) : null}
              </div>
            ) : null}

            {result ? <p className="mt-4 text-sm text-slate-200">{result.summary}</p> : null}
          </Card>

          {task.plan ? (
            <Card title="Plan and execution">
              <ol className="space-y-3">
                {task.plan.steps.map((step) => {
                  const stepResult = task.stepResults.find(
                    (candidate) => candidate.stepId === step.id,
                  );
                  return (
                    <li
                      key={step.id}
                      className="rounded-lg border border-surface-border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-100">{step.title}</span>
                        <div className="flex items-center gap-2">
                          <Badge>{step.skillId}</Badge>
                          {step.requiresApproval ? (
                            <Badge tone="warning">approval required</Badge>
                          ) : null}
                          {stepResult ? (
                            <Badge
                              tone={
                                stepResult.status === 'succeeded'
                                  ? 'success'
                                  : stepResult.status === 'skipped'
                                    ? 'neutral'
                                    : stepResult.status === 'denied' ||
                                        stepResult.status === 'failed'
                                      ? 'danger'
                                      : 'warning'
                              }
                            >
                              {stepResult.status}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{step.rationale}</p>
                      {stepResult?.issues.map((issue) => (
                        <p key={issue.code} className="mt-1 text-xs text-amber-300">
                          {issue.message}
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ol>

              {task.plan.openQuestions.length > 0 ? (
                <div className="mt-4 rounded-lg border border-surface-border p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Open questions</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                    {task.plan.openQuestions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          {result && result.approvals.length > 0 ? (
            <Card title="Approvals">
              <ul className="space-y-3">
                {result.approvals.map((approval) => (
                  <li
                    key={approval.id}
                    className="rounded-lg border border-surface-border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-100">{approval.action}</span>
                      <Badge
                        tone={
                          approval.status === 'approved'
                            ? 'success'
                            : approval.status === 'rejected'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {approval.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {approval.risk} risk · expires {new Date(approval.expires_at).toLocaleString()}
                    </p>
                    {approval.status === 'pending' ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          className="btn-primary text-xs"
                          onClick={() => decide(approval.id, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          className="btn-danger text-xs"
                          onClick={() => decide(approval.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {result && result.artifacts.length > 0 ? (
            <Card title="Deliverables">
              <div className="space-y-4">
                {result.artifacts.map((artifact, index) => (
                  <div
                    key={`${artifact.title}-${index}`}
                    className="rounded-lg border border-surface-border p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-100">{artifact.title}</h3>
                      <Badge>{artifact.kind.replace(/_/g, ' ')}</Badge>
                    </div>

                    {artifact.uncertainties.length > 0 ? (
                      <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                        <p className="text-xs uppercase tracking-wide text-amber-200">
                          Uncertainty
                        </p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-100">
                          {artifact.uncertainties.slice(0, 6).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {artifact.claims.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-xs">
                        {artifact.claims.slice(0, 8).map((claim) => (
                          <li key={`${claim.label}-${claim.statement}`} className="text-slate-300">
                            <Badge tone={claim.label === 'FACT' ? 'success' : 'neutral'}>
                              {claim.label}
                            </Badge>{' '}
                            {claim.statement}{' '}
                            <span className="text-slate-500">
                              ({claim.source ?? 'no source recorded'} · {claim.confidence})
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-surface p-3 text-xs text-slate-300">
                      {JSON.stringify(artifact.content, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {result?.quality ? (
            <Card
              title="Quality control"
              action={
                <Badge tone={result.quality.passed ? 'success' : 'danger'}>
                  {result.quality.score}/100
                </Badge>
              }
            >
              {result.quality.findings.length === 0 ? (
                <EmptyState
                  title="No findings"
                  description="The output passed evidence, medical safety and action-honesty checks."
                />
              ) : (
                <ul className="space-y-2 text-sm">
                  {result.quality.findings.map((finding) => (
                    <li
                      key={`${finding.id}-${finding.detail}`}
                      className="rounded-lg border border-surface-border p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-slate-300">{finding.rule}</span>
                        <Badge
                          tone={
                            finding.severity === 'error'
                              ? 'danger'
                              : finding.severity === 'warning'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {finding.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-slate-300">{finding.detail}</p>
                      <p className="mt-1 text-xs text-slate-400">{finding.remediation}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {result && result.nextBestAction.length > 0 ? (
            <Card title="Next best action">
              <ul className="space-y-2 text-sm">
                {result.nextBestAction.map((action) => (
                  <li
                    key={action.title}
                    className="flex items-start justify-between gap-3 rounded-lg border border-surface-border p-3"
                  >
                    <div>
                      <p className="text-slate-100">{action.title}</p>
                      <p className="mt-1 text-xs text-slate-400">{action.rationale}</p>
                    </div>
                    <Badge tone={action.requiresApproval ? 'warning' : 'neutral'}>
                      {action.skillId}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="Reasoning trace">
            <ol className="space-y-2 text-sm">
              {task.trace.map((entry, index) => (
                <li key={`${entry.stage}-${index}`} className="flex gap-3">
                  <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-brand-300">
                    {STAGE_LABELS[entry.stage] ?? entry.stage}
                  </span>
                  <span className="text-slate-300">{entry.message}</span>
                </li>
              ))}
            </ol>
          </Card>
        </>
      ) : (
        <Card title="Task output">
          <EmptyState
            title="No task yet"
            description="Hand a request to the Manager. Its plan, execution, verification, quality findings and next best action appear here."
          />
        </Card>
      )}
    </div>
  );
}

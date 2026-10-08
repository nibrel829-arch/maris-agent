'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';

type TemplateOption = { id: string; name: string; subject: string };

export function CreateSequenceForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState('manual');
  const [steps, setSteps] = useState<Array<{ templateId: string; delayDays: number; delayHours: number }>>([
    { templateId: '', delayDays: 0, delayHours: 0 },
  ]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/workspace/email/templates?limit=100')
      .then((r) => r.json())
      .then((payload) => {
        if (payload.ok) setTemplates(payload.data.templates.map((t: TemplateOption) => ({ id: t.id, name: t.name, subject: t.subject })));
      })
      .catch(() => {});
  }, []);

  function updateStep(idx: number, patch: Partial<(typeof steps)[number]>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function addStep() {
    if (steps.length >= 10) return;
    setSteps((prev) => [...prev, { templateId: '', delayDays: 1, delayHours: 0 }]);
  }

  function removeStep(idx: number) {
    if (steps.length === 1) return;
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) {
      setError('Sequence name is required.');
      return;
    }
    if (steps.some((s) => !s.templateId)) {
      setError('Each step needs a template.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/workspace/email/sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          trigger: trigger.trim(),
          steps: steps.map((s) => ({ templateId: s.templateId, delayDays: Number(s.delayDays), delayHours: Number(s.delayHours) })),
        }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not create sequence.');
        return;
      }
      setNotice('Sequence created.');
      setName('');
      setDescription('');
      setSteps([{ templateId: '', delayDays: 0, delayHours: 0 }]);
      router.refresh();
    } catch {
      setError('Could not reach server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="seq-name">Name *</label>
        <input className="input" id="seq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Onboarding drip" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="seq-desc">Description</label>
        <textarea className="input min-h-16" id="seq-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Welcome + follow-ups" rows={2} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="seq-trigger">Trigger</label>
        <input className="input" id="seq-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="manual or client.created" />
        <p className="mt-1 text-[11px] text-slate-500">Free-form trigger label — used for audit, not automated firing (manual enrollment only in Phase 11).</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-slate-200">Steps ({steps.length})</h4>
          <button type="button" className="btn-ghost text-xs" onClick={addStep} disabled={steps.length >= 10}>Add step</button>
        </div>
        {steps.map((step, idx) => (
          <div key={idx} className="rounded-xl border border-surface-border bg-surface-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Step {idx + 1}</span>
              {steps.length > 1 && (
                <button type="button" className="text-xs text-red-300 hover:underline" onClick={() => removeStep(idx)}>
                  Remove
                </button>
              )}
            </div>
            <div className="mt-2 grid gap-2">
              <label className="text-xs text-slate-400">Template *</label>
              <select className="input" value={step.templateId} onChange={(e) => updateStep(idx, { templateId: e.target.value })}>
                <option value="">Select a template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.subject.slice(0, 40)}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400">Delay days</label>
                  <input className="input" type="number" min={0} max={90} value={step.delayDays} onChange={(e) => updateStep(idx, { delayDays: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Delay hours</label>
                  <input className="input" type="number" min={0} max={23} value={step.delayHours} onChange={(e) => updateStep(idx, { delayHours: Number(e.target.value) })} />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">First step delay is from enrollment; subsequent steps delay from previous send.</p>
            </div>
          </div>
        ))}
      </div>

      {error ? <ErrorState message={error} /> : null}
      {notice ? <p className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">{notice}</p> : null}
      <button className="btn-primary w-full sm:w-auto" disabled={saving} type="submit">
        {saving ? 'Saving…' : 'Create sequence'}
      </button>
    </form>
  );
}

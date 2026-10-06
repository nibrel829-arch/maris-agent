'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRightIcon, PaperPlaneIcon, SparkIcon } from '@/components/ui/icons';
import { ErrorState } from '@/components/ui/primitives';
import type { ManagerTaskSnapshot } from '@/types/manager';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export const MANAGER_SUGGESTIONS = [
  'Research a market opportunity',
  'Turn an idea into a product concept',
  'Prepare a focused outreach plan',
  'Create a content campaign',
] as const;

const SUGGESTION_REQUESTS: Record<(typeof MANAGER_SUGGESTIONS)[number], string> = {
  'Research a market opportunity': 'Research the market opportunity for dental scheduling software',
  'Turn an idea into a product concept': 'Build a product: a treatment-planning template pack for clinics',
  'Prepare a focused outreach plan': 'Build a lead list of dental clinics in Manchester',
  'Create a content campaign': 'Create a content campaign for a new patient follow-up service',
};

export function ManagerCommand({
  compact = false,
  heading = 'Ask Nibrexo CEO',
  description = 'Give the Manager an outcome, question or decision. It will plan the work and keep you in control of any consequential action.',
  initialValue = '',
  onTaskCreated,
}: {
  compact?: boolean;
  heading?: string;
  description?: string;
  initialValue?: string;
  onTaskCreated?: (task: ManagerTaskSnapshot) => void;
}) {
  const router = useRouter();
  const [request, setRequest] = useState(initialValue);
  const [status, setStatus] = useState<'idle' | 'working'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const message = request.trim();
    if (message.length < 3) {
      setError('Describe what you need in at least 3 characters.');
      return;
    }

    setStatus('working');
    setError(null);

    try {
      const response = await fetch('/api/manager/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: message }),
      });
      const payload = (await response.json()) as ApiEnvelope<ManagerTaskSnapshot>;
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'The Manager could not process this request.');
        return;
      }

      if (onTaskCreated) {
        onTaskCreated(payload.data);
      } else {
        router.push(`/manager?task=${encodeURIComponent(payload.data.id)}`);
        router.refresh();
      }
    } catch {
      setError('Network error while contacting the Manager. Check your connection and try again.');
    } finally {
      setStatus('idle');
    }
  }, [onTaskCreated, request, router]);

  return (
    <section className={`relative overflow-hidden rounded-2xl border border-brand-300/20 bg-[#101e39] shadow-[0_16px_42px_rgba(0,0,0,0.18)] ${compact ? 'p-5' : 'p-6 sm:p-7'}`}>
      <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 rounded-bl-full bg-brand-400/[0.07]" />
      <div className="relative">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-300/20 bg-brand-400/10 text-brand-200">
            <SparkIcon size={18} />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em] text-white">{heading}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
          </div>
        </div>

        <label className="sr-only" htmlFor="manager-command">
          What does Nibrexo need to do?
        </label>
        <textarea
          className={`input mt-5 resize-y border-brand-200/15 bg-[#091425]/85 leading-6 ${compact ? 'min-h-[96px]' : 'min-h-[128px]'}`}
          disabled={status === 'working'}
          id="manager-command"
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="What outcome, decision or opportunity should Nibrexo take on?"
          value={request}
        />

        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5" aria-label="Suggested actions">
            {MANAGER_SUGGESTIONS.map((suggestion) => (
              <button
                className="rounded-lg border border-surface-border/90 bg-surface/45 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
                disabled={status === 'working'}
                key={suggestion}
                onClick={() => setRequest(SUGGESTION_REQUESTS[suggestion])}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <button className="btn-primary shrink-0" disabled={status === 'working'} onClick={() => void submit()} type="button">
            <PaperPlaneIcon size={16} />
            {status === 'working' ? 'Manager working…' : 'Hand to Manager'}
            {status === 'working' ? null : <ArrowUpRightIcon size={15} />}
          </button>
        </div>

        <p className="mt-3 text-[11px] text-slate-500">Tip: press Ctrl / ⌘ + Enter to hand off your request.</p>
        {error ? <div className="mt-4"><ErrorState message={error} /></div> : null}
      </div>
    </section>
  );
}

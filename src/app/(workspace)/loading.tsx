import { LoadingLines } from '@/components/ui/primitives';

export default function WorkspaceLoading() {
  return (
    <div className="mx-auto max-w-[1380px] space-y-6" aria-busy="true" aria-label="Loading workspace">
      <div className="border-b border-surface-border/70 pb-6">
        <div className="skeleton h-3 w-44" />
        <div className="skeleton mt-3 h-8 w-64" />
        <div className="skeleton mt-3 h-4 w-[min(620px,85%)]" />
      </div>
      <div className="card"><LoadingLines rows={4} /></div>
      <div className="grid gap-6 lg:grid-cols-2"><div className="card"><LoadingLines rows={6} /></div><div className="card"><LoadingLines rows={6} /></div></div>
    </div>
  );
}

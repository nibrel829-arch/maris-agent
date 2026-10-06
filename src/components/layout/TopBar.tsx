import { Badge } from '@/components/ui/primitives';
import type { ActorContext } from '@/types/domain';
import { roleLabel } from '@/server/auth/permissions';

export function TopBar({
  actor,
  title,
  subtitle,
}: {
  actor: ActorContext;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-surface-border bg-surface px-8 py-5">
      <div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>
      </div>

      <div className="flex items-center gap-3">
        {actor.isDevIdentity ? <Badge tone="warning">Dev identity</Badge> : null}
        <Badge tone="info">{roleLabel(actor.role)}</Badge>
        <div className="text-right">
          <p className="text-sm text-slate-200">{actor.fullName ?? 'Nibrexo user'}</p>
          <p className="text-xs text-slate-500">{actor.email ?? 'No email on file'}</p>
        </div>
      </div>
    </header>
  );
}

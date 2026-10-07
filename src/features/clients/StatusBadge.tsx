import { Badge } from '@/components/ui/primitives';
import type { ClientStatus } from '@/types/domain';
import { statusLabel, statusTone } from './client-statuses';

export function StatusBadge({ status }: { status: ClientStatus }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

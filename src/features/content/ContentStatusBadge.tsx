import { Badge } from '@/components/ui/primitives';
import type { ContentStatus } from '@/types/domain';
import { statusLabel, statusTone } from './content-statuses';

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

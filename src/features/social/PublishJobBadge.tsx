import { Badge } from '@/components/ui/primitives';
import type { PublishJob } from '@/types/domain';

const TONE: Record<PublishJob['status'], 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  queued: 'neutral',
  publishing: 'info',
  verifying: 'info',
  scheduled: 'info',
  published: 'success',
  failed: 'danger',
  unknown: 'warning',
  cancelled: 'neutral',
};

const LABEL: Record<PublishJob['status'], string> = {
  queued: 'Queued',
  publishing: 'Publishing',
  verifying: 'Verifying',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
  unknown: 'Needs review',
  cancelled: 'Cancelled',
};

export function PublishJobBadge({ status }: { status: PublishJob['status'] }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}

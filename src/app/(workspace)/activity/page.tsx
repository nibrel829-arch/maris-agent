import Link from 'next/link';
import { ActivityTimeline } from '@/components/cockpit/ActivityTimeline';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { Card } from '@/components/ui/primitives';
import { ArrowRightIcon, ClockIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const activity = await repoResult.data.activityLogs.list(actorResult.data.organizationId, { limit: 100 });

  return (
    <div className="mx-auto max-w-[1080px] space-y-6">
      <PageHeader
        description="A human-readable record of Manager tasks, saved work and decisions. This timeline reflects events actually written to the organization audit log."
        title="Decision timeline"
        actions={<Link className="btn-secondary" href="/manager">Ask Nibrexo <ArrowRightIcon size={15} /></Link>}
      />

      <Card
        title="Operating record"
        action={
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <ClockIcon size={14} /> Most recent first
          </span>
        }
      >
        <ActivityTimeline
          activity={activity}
          emptyDescription="When Nibrexo starts or completes work, requests a decision, or saves an artifact, it will be recorded here."
          emptyTitle="No operating activity yet"
        />
      </Card>
    </div>
  );
}

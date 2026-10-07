import Link from 'next/link';
import { Card, EmptyState } from '@/components/ui/primitives';
import { PulseIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { FacebookSelectForm } from '@/features/social/FacebookSelectForm';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getSelectionState } from '@/server/social/service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

export default async function FacebookSelectPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  if (!checkPermission(actor, { module: 'social', action: 'create' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot connect social accounts." />;
  }

  const { state } = await searchParams;
  const selection = state ? await getSelectionState(actor, repoResult.data, state) : null;

  if (!selection) {
    return (
      <div className="mx-auto max-w-[720px] space-y-6">
        <Link className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/social">
          ← Back to Social
        </Link>
        <PageHeader description="This Page selection is invalid or has expired." title="Selection expired" />
        <Card>
          <EmptyState
            action={
              <Link className="btn-secondary" href="/social">
                Back to Social
              </Link>
            }
            description="Page selections are single-use and expire after ten minutes. Start the Facebook connection again."
            icon={<PulseIcon size={19} />}
            title="Start over to reconnect"
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <Link className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/social">
        ← Back to Social
      </Link>
      <PageHeader
        description={`Signed in as ${selection.userName}. Pick which Page this connection publishes as — one Page per connection.`}
        title="Choose a Facebook Page"
      />
      <Card title="Available Pages">
        <FacebookSelectForm pages={selection.pages} stateToken={state as string} />
      </Card>
    </div>
  );
}

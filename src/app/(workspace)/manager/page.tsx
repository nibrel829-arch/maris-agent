import { ManagerWorkspace } from '@/features/manager/ManagerWorkspace';
import { listSkills } from '@/server/manager/skill-registry';
import { resolveActor } from '@/server/auth/actor';
import { actionsFor } from '@/server/auth/permissions';

export const dynamic = 'force-dynamic';

export default async function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; request?: string }>;
}) {
  const [params, actorResult] = await Promise.all([searchParams, resolveActor()]);
  const canDecide = actorResult.ok && actionsFor(actorResult.data.role, 'settings').includes('edit');

  return (
    <ManagerWorkspace
      canDecide={canDecide}
      initialRequest={params.request ?? ''}
      initialTaskId={params.task ?? null}
      skills={listSkills()}
    />
  );
}

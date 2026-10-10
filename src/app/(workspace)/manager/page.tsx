import { ManagerWorkspace } from '@/features/manager/ManagerWorkspace';
import { listSkills } from '@/server/manager/skill-registry';
import { resolveActor } from '@/server/auth/actor';
import { actionsFor, checkPermission } from '@/server/auth/permissions';

export const dynamic = 'force-dynamic';

export default async function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; request?: string }>;
}) {
  const [params, actorResult] = await Promise.all([searchParams, resolveActor()]);
  const canDecide = actorResult.ok && actionsFor(actorResult.data.role, 'settings').includes('edit');
  // Starting, answering and resuming Manager work needs ai:create; viewing needs ai:view.
  const canWork = actorResult.ok && checkPermission(actorResult.data, { module: 'ai', action: 'create' }).allowed;

  return (
    <ManagerWorkspace
      canDecide={canDecide}
      canWork={canWork}
      initialRequest={params.request ?? ''}
      initialTaskId={params.task ?? null}
      skills={listSkills()}
    />
  );
}

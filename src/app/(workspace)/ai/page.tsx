import { ManagerWorkspace } from '@/features/manager/ManagerWorkspace';
import { listSkills } from '@/server/manager/skill-registry';

export const dynamic = 'force-dynamic';

export default function ManagerPage() {
  return <ManagerWorkspace skills={listSkills()} />;
}

import { createMemoryRepository } from '@/server/db/memory-repository';
import type { NibrexoRepository } from '@/server/db/types';
import type { ActorContext, OrgRole, UUID } from '@/types/domain';

export const TEST_ORG: UUID = '00000000-0000-0000-0000-000000000001';
export const OTHER_ORG: UUID = '00000000-0000-0000-0000-000000000002';

export function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: '00000000-0000-0000-0000-0000000000a1',
    organizationId: TEST_ORG,
    role: 'owner' as OrgRole,
    email: 'owner@nibrexo.test',
    fullName: 'Test Owner',
    isDevIdentity: true,
    ...overrides,
  };
}

export function repo(): NibrexoRepository {
  return createMemoryRepository();
}

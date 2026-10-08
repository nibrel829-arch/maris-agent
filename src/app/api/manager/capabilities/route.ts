import { withApiContext } from '@/server/api/handler';
import { listCapabilities } from '@/server/manager/capability-registry';

export const dynamic = 'force-dynamic';

/**
 * GET /api/manager/capabilities
 *
 * Execution status of research, image, video and library capabilities.
 * Configuration names are returned. Secret values are not.
 */
export const GET = withApiContext(async () => {
  return {
    ok: true as const,
    data: {
      manager: 'NIBREXO CEO / MANAGER',
      capabilities: listCapabilities(),
    },
  };
});

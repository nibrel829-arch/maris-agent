import { listCapabilities } from '@/server/manager/capability-registry';
import { listSkills, validateRegistry } from '@/server/manager/skill-registry';
import { listTools, toolNames } from '@/server/manager/tool-registry';
import { withApiContext } from '@/server/api/handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/manager/skills — the capability catalogue available to the ONE
 * central Manager. Skills are capabilities, not autonomous agents.
 */
export const GET = withApiContext(async () => {
  const problems = validateRegistry(toolNames());
  if (problems.length > 0) {
    return {
      ok: false as const,
      status: 500,
      error: {
        code: 'REGISTRY_INVALID',
        message: problems.join(' '),
        severity: 'error' as const,
        retryable: false,
        errorClass: 'server' as const,
      },
    };
  }

  return {
    ok: true as const,
    data: {
      manager: 'NIBREXO CEO / MANAGER',
      skills: listSkills(),
      tools: listTools(),
      capabilities: listCapabilities(),
    },
  };
});

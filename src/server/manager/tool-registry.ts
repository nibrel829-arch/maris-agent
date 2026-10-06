/**
 * Tool Registry (PDF #08 §5 Tool Architecture, PDF #12 §9 Agent Tool Rules).
 *
 * - Tools must have explicit schemas.
 * - Tools must declare permissions.
 * - The Manager can call only registered tools.
 * - Unknown tools are rejected.
 */

import type { ToolDefinition } from '@/types/manager';
import { crmTools } from '@/server/tools/crm';
import {
  researchTools,
  productTools,
  visualTools,
} from '@/server/tools/research';
import { contentTools, socialTools } from '@/server/tools/content';
import { emailTools } from '@/server/tools/email';
import { operationsTools, systemTools } from '@/server/tools/operations';

type AnyTool = ToolDefinition<unknown, unknown>;

const ALL_TOOLS: AnyTool[] = [
  ...crmTools,
  ...researchTools,
  ...productTools,
  ...visualTools,
  ...contentTools,
  ...socialTools,
  ...emailTools,
  ...operationsTools,
  ...systemTools,
] as unknown as AnyTool[];

const REGISTRY = new Map<string, AnyTool>();

for (const tool of ALL_TOOLS) {
  if (REGISTRY.has(tool.name)) {
    throw new Error(`Duplicate tool registration: ${tool.name}`);
  }
  REGISTRY.set(tool.name, tool);
}

export function getTool(name: string): AnyTool | undefined {
  return REGISTRY.get(name);
}

export function listTools(): Array<{
  name: string;
  description: string;
  permission: AnyTool['permission'];
  risk: string;
  external: boolean;
}> {
  return [...REGISTRY.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    permission: tool.permission,
    risk: tool.risk,
    external: tool.external,
  }));
}

export function toolNames(): string[] {
  return [...REGISTRY.keys()];
}

export function hasTool(name: string): boolean {
  return REGISTRY.has(name);
}

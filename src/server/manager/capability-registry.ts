/**
 * Capability registry — status of what the Manager can actually execute.
 *
 * Built on the tool registry. It does not replace it and it does not introduce
 * a second agent. Status is computed from server configuration at call time.
 * Secret values are never copied into a record.
 */

import { serverEnv } from '@/lib/env';
import type { ManagerIssue } from '@/types/manager';
import { ARENA_IMAGE_UNSUPPORTED } from '@/server/integrations/media/image-generation';
import { GOOGLE_VIDS_EVIDENCE } from '@/server/integrations/media/video-draft';
import { toolNames } from './tool-registry';

export type CapabilityStatus = 'available' | 'needs_configuration' | 'assisted' | 'unsupported';

export interface CapabilityRecord {
  id: string;
  name: string;
  implementation: string;
  toolNames: string[];
  requiredConfig: string[];
  operations: string[];
  limitations: string[];
  status: CapabilityStatus;
  statusDetail: string;
  evidence: string;
}

interface CapabilitySpec {
  id: string;
  name: string;
  implementation: string;
  toolNames: string[];
  requiredConfig: string[];
  operations: string[];
  limitations: string[];
  evidence: string;
  resolve: (configured: Set<string>) => { status: CapabilityStatus; statusDetail: string };
}

const SPECS: readonly CapabilitySpec[] = [
  {
    id: 'research.deepseek',
    name: 'Research synthesis — DeepSeek',
    implementation: 'src/server/integrations/research/deepseek.ts',
    toolNames: ['conduct_sourced_research'],
    requiredConfig: ['DEEPSEEK_API_KEY'],
    operations: ['chat.completions'],
    limitations: [
      'Official chat completions only. DeepSeek does not browse the web.',
      'Synthesis runs only against snippets already retrieved by web search.',
      'Unsourced model text is dropped and is never stored as FACT.',
    ],
    evidence:
      'POST https://api.deepseek.com/chat/completions with Bearer DEEPSEEK_API_KEY. Models deepseek-flash and deepseek-v4-pro. Verified 2026-10-08 against https://api-docs.deepseek.com/.',
    resolve: (configured) =>
      configured.has('DEEPSEEK_API_KEY')
        ? { status: 'available', statusDetail: 'DeepSeek chat completions can run on the server.' }
        : {
            status: 'needs_configuration',
            statusDetail: 'Set DEEPSEEK_API_KEY. Without it, retrieved snippets are stored as-is and no model synthesis is claimed.',
          },
  },
  {
    id: 'research.web',
    name: 'Source-backed web research — Brave Search',
    implementation: 'src/server/integrations/research/web-search.ts',
    toolNames: ['conduct_sourced_research'],
    requiredConfig: ['BRAVE_SEARCH_API_KEY'],
    operations: ['web.search'],
    limitations: [
      'Returns titles, URLs and snippets. A snippet is EVIDENCE, not a fully read page.',
      'If the key is missing, the research step is blocked. No sources are invented.',
    ],
    evidence:
      'GET https://api.search.brave.com/res/v1/web/search with header X-Subscription-Token. Verified 2026-10-08 against https://api-dashboard.search.brave.com/app/documentation/web-search/get-started.',
    resolve: (configured) =>
      configured.has('BRAVE_SEARCH_API_KEY')
        ? { status: 'available', statusDetail: 'Brave Search can retrieve source URLs for the current question.' }
        : {
            status: 'needs_configuration',
            statusDetail:
              'Set BRAVE_SEARCH_API_KEY. This is the supported source-backed search adapter. DeepSeek will not be used to invent current facts.',
          },
  },
  {
    id: 'image.arena',
    name: 'Image generation — Arena Agent Mode',
    implementation: 'none — no supported API',
    toolNames: [],
    requiredConfig: [],
    operations: [],
    limitations: [
      'Agent Mode and Image Arena are website flows. They are not invoked.',
      'No password, cookie or browser automation is used.',
    ],
    evidence: ARENA_IMAGE_UNSUPPORTED.evidence,
    resolve: () => ({ status: 'unsupported', statusDetail: ARENA_IMAGE_UNSUPPORTED.message }),
  },
  {
    id: 'image.native',
    name: 'Image generation — OpenAI Images',
    implementation: 'src/server/integrations/media/image-generation.ts',
    toolNames: ['generate_image_asset'],
    requiredConfig: ['OPENAI_API_KEY'],
    operations: ['images.generations'],
    limitations: [
      'Uses the OpenAI Images API already compatible with this stack. It does not publish the image.',
      'The key stays on the server. A missing key blocks the step; no placeholder image is saved.',
    ],
    evidence:
      'POST https://api.openai.com/v1/images/generations. Default model gpt-image-1.5, override NIBREXO_IMAGE_MODEL. Docs: https://developers.openai.com/api/reference/resources/images/methods/generate.',
    resolve: (configured) =>
      configured.has('OPENAI_API_KEY')
        ? { status: 'available', statusDetail: 'Native image generation can save a PNG into the Content Library.' }
        : {
            status: 'needs_configuration',
            statusDetail: 'Set OPENAI_API_KEY. Arena Agent Mode is unsupported, so there is no other image path.',
          },
  },
  {
    id: 'video.google_vids',
    name: 'Video draft — Google Vids',
    implementation: 'src/server/integrations/media/video-draft.ts',
    toolNames: ['prepare_video_draft', 'export_video_file'],
    requiredConfig: [],
    operations: ['draft.package'],
    limitations: [
      'A storyboard and script can be saved to the Content Library.',
      'Create, edit and MP4 export inside Google Vids are assisted. No video file is claimed until one is uploaded.',
    ],
    evidence: GOOGLE_VIDS_EVIDENCE,
    resolve: () => ({
      status: 'assisted',
      statusDetail:
        'Draft packages are saved here. Opening Vids, generating clips and exporting MP4 remain manual steps in Google Vids.',
    }),
  },
  {
    id: 'content.library',
    name: 'Content Library',
    implementation: 'src/server/content/service.ts',
    toolNames: ['create_content_item', 'update_content_item', 'list_content_items'],
    requiredConfig: [],
    operations: ['draft.create', 'media.upload'],
    limitations: ['Items are created as DRAFT. Publishing is a separate approved action.'],
    evidence: 'Internal persistence through the organization-scoped content and media repositories.',
    resolve: () => ({ status: 'available', statusDetail: 'Drafts and uploaded bytes can be saved and read back in this organization.' }),
  },
  {
    id: 'communications.external',
    name: 'External publishing and sending',
    implementation: 'src/server/tools/operations.ts',
    toolNames: ['publish_post', 'schedule_post', 'send_email'],
    requiredConfig: [],
    operations: ['publish', 'send'],
    limitations: [
      'Always stops for explicit approval.',
      'A missing provider or disconnected account is reported; the action is not marked done.',
    ],
    evidence: 'Existing publisher and Resend adapters. Approval policy requires publish_post, schedule_post and send_email.',
    resolve: () => ({
      status: 'available',
      statusDetail: 'The tools are registered. Each run still checks provider configuration and approval before any external call.',
    }),
  },
];

function configuredNames(): Set<string> {
  const env = serverEnv();
  const names = new Set<string>();
  if (env.deepseekConfigured) names.add('DEEPSEEK_API_KEY');
  if (env.webSearchConfigured) names.add('BRAVE_SEARCH_API_KEY');
  if (env.imageGenerationConfigured) names.add('OPENAI_API_KEY');
  if (env.emailConfigured) names.add('RESEND_API_KEY');
  return names;
}

export function listCapabilities(): CapabilityRecord[] {
  const configured = configuredNames();
  const registered = new Set(toolNames());
  return SPECS.map((spec) => {
    const decision = spec.resolve(configured);
    const missingTools = spec.toolNames.filter((name) => !registered.has(name));
    return {
      id: spec.id,
      name: spec.name,
      implementation: spec.implementation,
      toolNames: spec.toolNames,
      requiredConfig: spec.requiredConfig,
      operations: spec.operations,
      limitations: missingTools.length
        ? [...spec.limitations, `Tool registry is missing: ${missingTools.join(', ')}.`]
        : spec.limitations,
      status: decision.status,
      statusDetail: decision.statusDetail,
      evidence: spec.evidence,
    };
  });
}

export function getCapability(id: string): CapabilityRecord | undefined {
  return listCapabilities().find((record) => record.id === id);
}

export function interpretToolOutput(output: unknown): { blocked: boolean; issue: ManagerIssue | null } {
  if (!output || typeof output !== 'object') return { blocked: false, issue: null };
  const record = output as Record<string, unknown>;
  const status = record.capabilityStatus;
  const executed = record.executed === true;
  const message =
    typeof record.message === 'string' && record.message.trim().length > 0
      ? record.message
      : 'This capability did not run.';

  if (status === 'needs_configuration' || status === 'blocked') {
    if (executed) return { blocked: false, issue: null };
    return {
      blocked: true,
      issue: {
        code: 'NOT_CONFIGURED',
        message,
        severity: 'warning',
        retryable: true,
        errorClass: 'not_configured',
      },
    };
  }
  if (status === 'unsupported' || (status === 'assisted' && !executed)) {
    return {
      blocked: true,
      issue: {
        code: status === 'assisted' ? 'ASSISTED_STEP' : 'UNSUPPORTED',
        message,
        severity: 'warning',
        retryable: false,
        errorClass: 'unsupported',
      },
    };
  }
  return { blocked: false, issue: null };
}

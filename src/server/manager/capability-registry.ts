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
        ? {
            status: 'available',
            statusDetail: 'Paid synthesis is explicitly allowed. DeepSeek still does not retrieve sources.',
          }
        : {
            status: 'needs_configuration',
            statusDetail:
              'Disabled by default so a stored key cannot create token charges. Free research stores Wikipedia and Instant Answer snippets without a model.',
          },
  },
  {
    id: 'research.free',
    name: 'Free source retrieval — Wikipedia and Instant Answers',
    implementation: 'src/server/integrations/research/free-search.ts',
    toolNames: ['conduct_sourced_research'],
    requiredConfig: [],
    operations: ['wikipedia.search', 'duckduckgo.instant_answer'],
    limitations: [
      'Wikipedia is an encyclopedia, not a general web index.',
      'DuckDuckGo Instant Answer returns an abstract URL only. It is not a search-results API.',
      'A snippet is EVIDENCE, not a fully read page. No sources are invented when these lookups are empty or unreachable.',
    ],
    evidence:
      'GET https://en.wikipedia.org/w/api.php?action=query&generator=search (https://www.mediawiki.org/wiki/API:Search). GET https://api.duckduckgo.com/?format=json is the official Instant Answer API, not a web index.',
    resolve: () => ({
      status: 'available',
      statusDetail: 'No key and no billing. Results are limited to those two official endpoints.',
    }),
  },
  {
    id: 'research.web',
    name: 'Paid web search — Brave Search',
    implementation: 'src/server/integrations/research/web-search.ts',
    toolNames: ['conduct_sourced_research'],
    requiredConfig: ['NIBREXO_ALLOW_PAID_SEARCH', 'BRAVE_SEARCH_API_KEY'],
    operations: ['web.search'],
    limitations: [
      'Metered API. A key alone does not authorize a call.',
      'Disabled unless NIBREXO_ALLOW_PAID_SEARCH=1, because usage can be billed after the included credit.',
    ],
    evidence:
      'GET https://api.search.brave.com/res/v1/web/search with header X-Subscription-Token. The free tier was removed; accounts receive monthly credits and can be billed. Checked 2026-10-09.',
    resolve: (configured) =>
      configured.has('BRAVE_SEARCH_API_KEY')
        ? { status: 'available', statusDetail: 'Paid Brave Search is explicitly allowed. It can incur charges.' }
        : {
            status: 'needs_configuration',
            statusDetail:
              'Not used. Free research uses Wikipedia and DuckDuckGo Instant Answers. Enable Brave only if you accept billing.',
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
    id: 'image.openai',
    name: 'Image generation — OpenAI Images',
    implementation: 'not called',
    toolNames: [],
    requiredConfig: [],
    operations: [],
    limitations: [
      'Paid API. Removed from the required path so OPENAI_API_KEY cannot generate images by itself.',
      'There is no automatic fallback to this API.',
    ],
    evidence:
      'POST https://api.openai.com/v1/images/generations bills per image. Checked 2026-10-09. The Manager does not call it.',
    resolve: () => ({
      status: 'unsupported',
      statusDetail: 'OpenAI Images is paid and is not invoked.',
    }),
  },
  {
    id: 'image.generate',
    name: 'Image generation — Nibrexo engine',
    implementation: 'src/server/media/engine/native-engine.ts',
    toolNames: ['image.generate', 'generate_image_asset'],
    requiredConfig: ['NIBREXO_IMAGE_ENGINE_URL', 'NIBREXO_IMAGE_WEIGHTS_DIR'],
    operations: ['image.generate'],
    limitations: [
      'A file is saved only after PNG, JPEG or WebP bytes are verified and read back from storage.',
      'The engine is scripts/nibrexo-image-engine.py. It loads Stable Diffusion v1.5 locally. It does not call an image API.',
      'CPU inference needs about 8 GB RAM and 4 GB of weights. Vercel cannot run the model.',
      'A stored CLOUDFLARE_API_TOKEN or OPENAI_API_KEY is ignored. A token alone does not enable a call.',
      'CreativeML Open RAIL-M permits commercial use with use-based restrictions. It is not Apache-2.0.',
    ],
    evidence:
      'Model card https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5. License https://github.com/CompVis/stable-diffusion/blob/main/LICENSE. FLUX.2 [klein] 4B is Apache-2.0 but needs about 13 GB VRAM, so it is not the default and its hosted API is not called.',
    resolve: (configured) =>
      configured.has('NIBREXO_IMAGE_ENGINE_URL')
        ? {
            status: 'available',
            statusDetail:
              'The Manager will call only the Nibrexo image engine. A health check must identify nibrexo-image-engine before any file is saved. External image APIs are not called.',
          }
        : {
            status: 'needs_configuration',
            statusDetail:
              'Start scripts/nibrexo-image-engine.py and set NIBREXO_IMAGE_ENGINE_URL. A CLOUDFLARE_API_TOKEN or OPENAI_API_KEY is ignored. A token alone does not enable image generation. No image file is invented while the engine is unset.',
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
  if (env.imageEngineUrl) names.add('NIBREXO_IMAGE_ENGINE_URL');
  if (env.imageWeightsDir) names.add('NIBREXO_IMAGE_WEIGHTS_DIR');
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

  if (status === 'quota_exhausted') {
    return {
      blocked: true,
      issue: {
        code: 'QUOTA_EXHAUSTED',
        message,
        severity: 'warning',
        retryable: true,
        errorClass: 'rate_limit',
      },
    };
  }
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

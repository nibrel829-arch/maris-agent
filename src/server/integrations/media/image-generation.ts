/**
 * Arena is unsupported. Paid OpenAI image generation is not called from here.
 * The executable adapter is free-image.ts.
 */

export const ARENA_IMAGE_UNSUPPORTED = {
  status: 'unsupported' as const,
  name: 'Arena Agent Mode',
  message:
    'Arena Agent Mode image generation has no supported programmatic API. The Arena website and Agent Mode are not called.',
  evidence:
    'Checked https://arena.ai/agent and Arena help articles for Image Arena on 2026-10-08. Those surfaces are interactive website flows, not a documented automation API for third-party apps.',
};

/**
 * Google Vids — assisted video draft package.
 *
 * Verified 2026-10-08: Google documents Vids as a Workspace UI
 * (https://support.google.com/a/users/answer/14819770 — "Help me create").
 * No public Vids REST API for create, edit or export was found on
 * developers.google.com. apis.io indexes Vids with an empty API list and
 * states there is no public developer REST API. This module does not call
 * Vids, does not ask for a Google password or session cookie, and does not
 * claim a video file was rendered.
 */

export const GOOGLE_VIDS_EVIDENCE =
  'Google Vids creation and export are documented as in-product steps (support.google.com/a/users/answer/14819770). No official programmatic create/edit/export API was found on 2026-10-08. Remaining rendering steps are assisted.';

export interface VideoScene {
  index: number;
  heading: string;
  narration: string;
  visualDirection: string;
  durationHintSeconds: number;
}

export interface VideoDraftPackage {
  title: string;
  provider: 'google_vids';
  automation: 'assisted';
  scenes: VideoScene[];
  assistedSteps: string[];
  renderedVideo: null;
  evidence: string;
}

export const VIDS_ASSISTED_STEPS = [
  'Open Google Vids in the browser (Google Workspace → Vids). Nibrexo cannot open it for you.',
  'Choose Help me create and paste the script saved in this Content Library item. Add your own documents with @ if you want Vids to use them.',
  'Review the outline, stock media and voiceover. Do not treat generated media as sourced research or as a finished Nibrexo asset.',
  'Export an MP4 only after you have reviewed it. Then upload that file to the Content Library. Until that upload exists, no video file has been produced.',
] as const;

export function buildVideoDraftPackage(input: { title: string; brief: string }): VideoDraftPackage {
  const sentences = input.brief
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const chunks = (sentences.length > 0 ? sentences : [input.brief.trim() || input.title]).slice(0, 6);

  return {
    title: input.title.slice(0, 200),
    provider: 'google_vids',
    automation: 'assisted',
    scenes: chunks.map((text, index) => ({
      index: index + 1,
      heading: `Scene ${index + 1}`,
      narration: text.slice(0, 500),
      visualDirection:
        'Use a saved image concept or uploaded asset if one exists. Do not invent statistics, testimonials or product claims in on-screen text.',
      durationHintSeconds: 8,
    })),
    assistedSteps: [...VIDS_ASSISTED_STEPS],
    renderedVideo: null,
    evidence: GOOGLE_VIDS_EVIDENCE,
  };
}

export function renderVideoDraftBody(draft: VideoDraftPackage): string {
  const scenes = draft.scenes
    .map(
      (scene) =>
        `Scene ${scene.index} — ${scene.heading} (~${scene.durationHintSeconds}s)\nNarration: ${scene.narration}\nVisual: ${scene.visualDirection}`,
    )
    .join('\n\n');
  const assisted = draft.assistedSteps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  return [
    `Video draft package for Google Vids: ${draft.title}`,
    'Status: draft package saved. No video file was rendered or exported.',
    draft.evidence,
    '',
    scenes,
    '',
    'Assisted steps still required:',
    assisted,
  ].join('\n');
}

/**
 * Publisher registry (Phase 8).
 *
 * Every entry below was verified against current official documentation in
 * October 2026 (see each publisher file for the exact references). Anything
 * unverifiable is reported as unsupported instead of emulated.
 */

import type { SocialCapabilities, SocialPlatform } from '@/types/domain';
import type { PublisherAdapter } from './types';
import { tiktokPublisher } from './tiktok';
import { youtubePublisher } from './youtube';
import { pinterestPublisher } from './pinterest';
import { linkedinPublisher } from './linkedin';
import { instagramPublisher } from './instagram';
import { facebookPublisher } from './facebook';

export type {
  PublishMediaInput,
  PublishStepContext,
  PublishStepOutcome,
  PublishSupport,
  PublishSupportInput,
  PublisherAdapter,
} from './types';
export {
  SCHEDULED_VERIFY_STEP,
  buildMultipartForm,
  optionBoolean,
  optionString,
  pollRound,
  stepContinue,
  stepFailed,
  stepPublished,
  stepScheduledProvider,
  stepUnknown,
  stepUnsupported,
} from './types';

const REGISTRY: Partial<Record<SocialPlatform, PublisherAdapter>> = {
  tiktok: tiktokPublisher,
  youtube: youtubePublisher,
  pinterest: pinterestPublisher,
  linkedin: linkedinPublisher,
  instagram: instagramPublisher,
  facebook: facebookPublisher,
};

export function getPublisher(platform: SocialPlatform): PublisherAdapter | null {
  return REGISTRY[platform] ?? null;
}

export interface PublishCapability {
  platform: SocialPlatform;
  label: string;
  publish: boolean;
  /** Provider-native future scheduling (vs Nibrexo-side hold). */
  nativeSchedule: boolean;
  text: boolean;
  image: boolean;
  video: boolean;
  /** Short verified notes shown in the UI (limits, requirements). */
  notes: string[];
  unsupported: string[];
}

/**
 * Verified publishing posture per platform. This is the single source of
 * truth for the UI, the capability pre-flight and the SocialAdapter maps.
 */
export const PUBLISHING_SUPPORT: Record<SocialPlatform, PublishCapability> = {
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    publish: true,
    nativeSchedule: false,
    text: false,
    image: true,
    video: true,
    notes: [
      'Direct Post to the connected creator account.',
      'Video uploads directly; photos are fetched from a public URL (Supabase backend).',
      'Privacy is chosen from the creator\u2019s own options; public is preferred when available.',
      'Unaudited TikTok clients post private-only with daily caps (provider policy).',
    ],
    unsupported: ['Text-only posts', 'Provider-side scheduling (held Nibrexo-side)'],
  },
  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    publish: true,
    nativeSchedule: true,
    text: false,
    image: false,
    video: true,
    notes: [
      'Resumable video upload to the connected channel.',
      'Public videos can be scheduled natively (private + publishAt); unlisted/private futures upload at the scheduled time.',
      'Title \u2264100 chars, description \u22645000 bytes.',
      'Unverified API projects stay private until audit (provider policy).',
    ],
    unsupported: ['Text/image posts', 'Channel posts (Community tab)'],
  },
  pinterest: {
    platform: 'pinterest',
    label: 'Pinterest',
    publish: true,
    nativeSchedule: false,
    text: false,
    image: true,
    video: true,
    notes: [
      'Image Pins upload inline (JPEG/PNG).',
      'Video Pins (MP4/MOV/M4V) need a cover image chosen from the library.',
      'Every Pin needs a target board.',
    ],
    unsupported: ['Text-only Pins', 'Provider-side scheduling (held Nibrexo-side)', 'Carousel Pins'],
  },
  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn',
    publish: true,
    nativeSchedule: false,
    text: true,
    image: true,
    video: false,
    notes: [
      'Member posts (urn:li:person) via the Posts API.',
      'Image posts (JPG/PNG/GIF) upload first, then post.',
      'Confirmation is the provider post URN; read-back needs the restricted r_member_social product.',
    ],
    unsupported: [
      'Video posts (chunked Videos API with ETag finalization)',
      'Company Page posts (needs vetted w_organization_social)',
      'Provider-side scheduling (held Nibrexo-side)',
    ],
  },
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    publish: true,
    nativeSchedule: false,
    text: false,
    image: true,
    video: true,
    notes: [
      'Single-image posts (JPEG only) and Reels via the container flow.',
      'Media is fetched from a public URL (Supabase backend).',
      '100 API posts per rolling 24h (provider limit).',
    ],
    unsupported: [
      'Text-only posts',
      'Stories and carousels',
      'Provider-side scheduling (held Nibrexo-side)',
    ],
  },
  facebook: {
    platform: 'facebook',
    label: 'Facebook',
    publish: true,
    nativeSchedule: true,
    text: true,
    image: true,
    video: true,
    notes: [
      'Page posts: text/link, photos (JPEG/PNG/GIF), videos.',
      'Native scheduling 10 minutes to 30 days ahead.',
      'Scheduled posts can be cancelled at Facebook before they go live.',
    ],
    unsupported: ['Profile and Group posting (removed by Meta)', 'Reels and Stories'],
  },
  contra: {
    platform: 'contra',
    label: 'Contra',
    publish: false,
    nativeSchedule: false,
    text: false,
    image: false,
    video: false,
    notes: [],
    unsupported: ['Contra offers no public publishing API.'],
  },
};

const NO_CAPABILITIES: SocialCapabilities = {
  publish: false,
  schedule: false,
  readDm: false,
  sendDm: false,
  readComments: false,
  replyComments: false,
  analytics: false,
};

/** SocialAdapter capability map derived from the verified matrix. */
export function capabilitiesFor(platform: SocialPlatform): SocialCapabilities {
  const entry = PUBLISHING_SUPPORT[platform];
  if (!entry.publish) return { ...NO_CAPABILITIES };
  return { ...NO_CAPABILITIES, publish: true, schedule: entry.nativeSchedule };
}

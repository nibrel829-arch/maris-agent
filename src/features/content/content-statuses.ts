/**
 * Content status/platform metadata shared by server validation and client
 * components. Pure module (no React, no Node APIs) so both sides import one
 * source — the same pattern as the Phase 5 client statuses.
 */

import type { ContentStatus, SocialPlatform } from '@/types/domain';

/** Every status the `content_status` enum accepts (migration 0002). */
export const CONTENT_STATUSES = [
  'DRAFT',
  'VALIDATING',
  'READY',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly ContentStatus[];

/**
 * Phase 6 draft lifecycle. Scheduling and publishing arrive in Phase 8, so
 * the library UI only moves items between DRAFT and READY; rows already in a
 * publishing status are never transitioned by the library service.
 */
export const DRAFT_LIFECYCLE_STATUSES = ['DRAFT', 'READY'] as const satisfies readonly ContentStatus[];

export type DraftLifecycleStatus = (typeof DRAFT_LIFECYCLE_STATUSES)[number];

export function isContentStatus(value: unknown): value is ContentStatus {
  return (
    typeof value === 'string' && (CONTENT_STATUSES as readonly string[]).includes(value)
  );
}

export function isDraftLifecycleStatus(value: unknown): value is DraftLifecycleStatus {
  return (
    typeof value === 'string' &&
    (DRAFT_LIFECYCLE_STATUSES as readonly string[]).includes(value)
  );
}

/** Target platforms for content metadata (PDF #09 §5; publishing is Phase 8). */
export const CONTENT_PLATFORMS = [
  'tiktok',
  'youtube',
  'pinterest',
  'linkedin',
  'instagram',
  'facebook',
  'contra',
] as const satisfies readonly SocialPlatform[];

export function isContentPlatform(value: unknown): value is SocialPlatform {
  return (
    typeof value === 'string' && (CONTENT_PLATFORMS as readonly string[]).includes(value)
  );
}

export function statusLabel(status: ContentStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function platformLabel(platform: SocialPlatform): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function statusTone(status: ContentStatus): StatusTone {
  switch (status) {
    case 'READY':
    case 'PUBLISHED':
      return 'success';
    case 'VALIDATING':
    case 'SCHEDULED':
      return 'info';
    case 'PUBLISHING':
    case 'PARTIAL':
      return 'warning';
    case 'FAILED':
      return 'danger';
    case 'DRAFT':
    case 'CANCELLED':
      return 'neutral';
  }
}

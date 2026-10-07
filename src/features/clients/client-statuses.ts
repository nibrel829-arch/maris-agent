/**
 * Client status metadata shared by server validation and client components.
 * Pure module (no React, no Node APIs) so both sides import one source.
 */

import type { ClientStatus } from '@/types/domain';

/**
 * Every status the database accepts. `prospect`, `inactive` and `completed`
 * were added by migration 0006; `qualified`, `paused` and `churned` predate
 * Phase 5 and remain readable/editable so existing rows keep working.
 */
export const CLIENT_STATUSES = [
  'lead',
  'prospect',
  'qualified',
  'active',
  'paused',
  'inactive',
  'churned',
  'completed',
] as const satisfies readonly ClientStatus[];

/** Statuses offered for newly created records (Phase 5 requirement). */
export const PRIMARY_CLIENT_STATUSES = [
  'lead',
  'prospect',
  'active',
  'inactive',
  'completed',
] as const satisfies readonly ClientStatus[];

export function isClientStatus(value: unknown): value is ClientStatus {
  return (
    typeof value === 'string' && (CLIENT_STATUSES as readonly string[]).includes(value)
  );
}

export function statusLabel(status: ClientStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function statusTone(status: ClientStatus): StatusTone {
  switch (status) {
    case 'active':
    case 'completed':
      return 'success';
    case 'lead':
    case 'prospect':
    case 'qualified':
      return 'info';
    case 'paused':
    case 'inactive':
      return 'warning';
    case 'churned':
      return 'danger';
  }
}

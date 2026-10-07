/**
 * Renders `supabase/scripts/provision_owner.sql` for the CLI (`--print-sql`).
 *
 * The SQL file is the single source of truth for the credential-free,
 * SQL-editor path; this module only substitutes the `-- @nibrexo:<key>` marked
 * lines, so the two paths can never drift apart. Pure and synchronous, which
 * keeps it unit-testable (`tests/unit/provisioning.test.ts`).
 */

import type { ElevatedRole } from '@/server/auth/authorization';
import { isUuid } from '@/server/auth/provisioning';

export interface ProvisionSqlValues {
  email: string | null;
  userId: string | null;
  orgName: string;
  orgSlug: string;
  role: ElevatedRole;
  fullName: string | null;
}

/** Postgres string literal with single quotes escaped. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function renderProvisionSql(sql: string, values: ProvisionSqlValues): string {
  const id = values.userId && isUuid(values.userId) ? values.userId : null;
  const verifyMatch = id
    ? `u.id = ${sqlLiteral(id)}`
    : `lower(u.email) = lower(${sqlLiteral(values.email ?? '')})`;

  return sql
    .split('\n')
    .map((line) => {
      const marker = line.match(/@nibrexo:([a-z-]+)/)?.[1];
      if (!marker) return line;

      switch (marker) {
        case 'owner-email':
          return line.replace(/'CHANGE_ME_OWNER_EMAIL'/g, sqlLiteral(values.email ?? ''));
        case 'owner-id':
          return `  v_owner_id    uuid := ${id ? sqlLiteral(id) : 'null'};  -- @nibrexo:owner-id`;
        case 'org-name':
          return `  v_org_name    text := ${sqlLiteral(values.orgName)};  -- @nibrexo:org-name`;
        case 'org-slug':
          return `  v_org_slug    text := ${sqlLiteral(values.orgSlug)};  -- @nibrexo:org-slug`;
        case 'role':
          return `  v_role        public.org_role := ${sqlLiteral(values.role)};  -- @nibrexo:role`;
        case 'full-name':
          return `  v_full_name   text := ${
            values.fullName ? sqlLiteral(values.fullName) : 'null'
          };  -- @nibrexo:full-name`;
        case 'verify-match':
          return `where ${verifyMatch}  -- @nibrexo:verify-match`;
        default:
          return line;
      }
    })
    .join('\n');
}

/**
 * Placeholders that must never survive rendering: the operator should never run
 * SQL that still targets `CHANGE_ME_OWNER_EMAIL`.
 */
export function findUnresolvedPlaceholders(sql: string): string[] {
  const found: string[] = [];
  if (sql.includes('CHANGE_ME_OWNER_EMAIL')) found.push('CHANGE_ME_OWNER_EMAIL');
  return found;
}

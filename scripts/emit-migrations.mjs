#!/usr/bin/env node
/**
 * Prints the complete Nibrexo migration set (0001-0005) as one ordered script,
 * for the Supabase SQL-Editor workflow where no CLI/psql is available.
 *
 *   npm run db:sql > all_migrations.sql
 *
 * The output is generated from `supabase/migrations/*.sql` — the migration files
 * stay the single source of truth, so this cannot drift from `supabase db push`.
 * Nothing here connects to any database or reads a credential.
 */

import { resolve } from 'node:path';
import { loadMigrations, renderMigrations } from './lib/migrations-sql.mjs';

const root = resolve(import.meta.dirname, '..');

try {
  const migrations = loadMigrations(root);
  process.stdout.write(renderMigrations(migrations));
} catch (error) {
  console.error(`\n  ✖ ${error instanceof Error ? error.message : 'Could not read the migrations'}\n`);
  process.exitCode = 1;
}

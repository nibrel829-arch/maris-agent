#!/usr/bin/env node
/**
 * Writes (or prints) the complete Nibrexo migration set 0001-0008 as one
 * ordered script, for the Supabase SQL-Editor workflow where no CLI is used.
 *
 *   npm run db:sql                      # writes ./all_migrations.sql
 *   node scripts/emit-migrations.mjs --out /tmp/db.sql
 *   node scripts/emit-migrations.mjs --stdout > all_migrations.sql
 *
 * The script is generated from `supabase/migrations/*.sql` — the migration files
 * stay the single source of truth, so this cannot drift from `supabase db push`.
 *
 * Why the default is a file rather than stdout: npm prints a 3-line script
 * banner to stdout, so `npm run db:sql > all_migrations.sql` used to prepend
 * `> nibrexo-os-ai@0.1.0 db:sql` etc. — not SQL, and enough to make the SQL
 * Editor reject the paste. Writing the file here keeps stdout out of it.
 *
 * Nothing here connects to any database or reads a credential.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMigrations, renderMigrations } from './lib/migrations-sql.mjs';

const root = resolve(import.meta.dirname, '..');
const DEFAULT_OUT = resolve(root, 'all_migrations.sql');

const args = process.argv.slice(2);
const toStdout = args.includes('--stdout');
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_OUT;

if (outIndex >= 0 && !outPath) {
  console.error('\n  ✖ --out needs a path, e.g. --out all_migrations.sql\n');
  process.exit(2);
}

/**
 * A paste-into-the-editor artifact must be SQL from its first line to its last:
 * no npm banner, no shell noise. Anything else fails in the SQL Editor.
 */
function assertPureSql(sql, target) {
  const lines = sql.split('\n');
  const first = lines[0] ?? '';
  if (!first.startsWith('--')) {
    throw new Error(
      `${target} does not start with a SQL comment (got "${first.slice(0, 40)}"). Refusing to emit a non-SQL artifact.`,
    );
  }
  if (lines.some((line) => line.startsWith('>'))) {
    throw new Error(`${target} contains shell/npm banner lines. Refusing to emit a non-SQL artifact.`);
  }
  for (const name of ['0001_core_identity.sql', '0008_social_connections.sql']) {
    if (!sql.includes(`-- ${name}`)) {
      throw new Error(`${target} is missing the ${name} section.`);
    }
  }
}

try {
  const sql = renderMigrations(loadMigrations(root));
  assertPureSql(sql, toStdout ? 'stdout' : outPath);

  if (toStdout) {
    process.stdout.write(sql);
  } else {
    writeFileSync(outPath, sql);
    const lines = sql.split('\n').length;
    // Confirmation goes to stderr so `--out` can never contaminate a redirect.
    console.error(`Wrote ${outPath} (${lines} lines, ${Buffer.byteLength(sql)} bytes).`);
  }
} catch (error) {
  console.error(`\n  ✖ ${error instanceof Error ? error.message : 'Could not generate the migration bundle'}\n`);
  process.exitCode = 1;
}

/**
 * Vault Migration Runner
 *
 * Manages incremental schema migrations with version tracking.
 * Each migration is a named step with an idempotent up() function.
 * Failed migrations log the failure and abort the startup.
 *
 * Usage:
 *   await runMigrations();
 *
 * To add a new migration:
 *   1. Increment MIGRATION_VERSION
 *   2. Add an entry to MIGRATIONS[] with a descriptive name
 *   3. The up() function runs once when the version increments
 */

import { getDb } from './schema.ts';
import { withTransaction } from './schema.ts';

// ── Migration version ───────────────────────────────────────────────

const CURRENT_VERSION = 3;

const MIGRATIONS: Array<{
  version: number;
  name: string;
  up: () => void;
}> = [
  // v1: initial schema (handled by schema.ts CREATE TABLE statements)
  {
    version: 1,
    name: 'initial schema',
    up: () => {},
  },

  // v2: add project_id to entities
  {
    version: 2,
    name: 'add project_id to entities',
    up: () => {
      getDb().run(
        'ALTER TABLE entities ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL'
      );
    },
  },

  // v3: add project_id to commitments, conversations, goals
  {
    version: 3,
    name: 'add project_id to commitments, conversations, goals',
    up: () => {
      const db = getDb();
      withTransaction(() => {
        db.run('ALTER TABLE commitments ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL');
        db.run('ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL');
        db.run('ALTER TABLE goals ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL');
      });
    },
  },
];

// ── Version table helpers ───────────────────────────────────────────

function ensureVersionTable(): void {
  const db = getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
}

function getSchemaVersion(): number {
  try {
    ensureVersionTable();
    const row = getDb().prepare('SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1').get() as
      | { version: number }
      | null;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(version: number): void {
  ensureVersionTable();
  getDb().prepare('INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)').run(version, Date.now());
}

// ── Runner ─────────────────────────────────────────────────────────

export async function runMigrations(): Promise<void> {
  const db = getDb();
  let version: number;

  try {
    version = getSchemaVersion();
  } catch (err) {
    // Fresh database — init version 0
    version = 0;
  }

  if (version >= CURRENT_VERSION) {
    return;
  }

  console.log(`[migrations] schema at v${version}, targeting v${CURRENT_VERSION}...`);

  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;

    console.log(`[migrations] applying v${migration.version}: ${migration.name}...`);
    try {
      migration.up();
      setSchemaVersion(migration.version);
      console.log(`[migrations] ✓ v${migration.version} applied`);
    } catch (err) {
      console.error(`[migrations] ✗ v${migration.version} FAILED: ${err}`);
      throw new Error(
        `Migration v${migration.version} (${migration.name}) failed: ${err}. ` +
        'Schema migration is required — fix the error and restart.'
      );
    }
  }

  console.log(`[migrations] schema now at v${CURRENT_VERSION}`);
}

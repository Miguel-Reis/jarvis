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

const CURRENT_VERSION = 4;

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

  // v2: add project_id to entities (if not exists)
  {
    version: 2,
    name: 'add project_id to entities',
    up: () => {
      try {
        getDb().run(
          'ALTER TABLE entities ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL'
        );
      } catch (err) {
        // Column may already exist in newer schema versions
        if (!(err as Error).message.includes('duplicate column')) {
          throw err;
        }
      }
    },
  },

  // v3: add project_id to commitments, conversations, goals (if not exists)
  {
    version: 3,
    name: 'add project_id to commitments, conversations, goals',
    up: () => {
      const db = getDb();
      withTransaction(() => {
        const tables = ['commitments', 'conversations', 'goals'];
        for (const table of tables) {
          try {
            db.run(`ALTER TABLE ${table} ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`);
          } catch (err) {
            if (!(err as Error).message.includes('duplicate column')) {
              throw err;
            }
          }
        }
      });
    },
  },

  // v4: add deep memory synthesis tables
  {
    version: 4,
    name: 'add deep memory synthesis tables',
    up: () => {
      const db = getDb();
      withTransaction(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS synthesized_patterns (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            source_projects TEXT,
            occurrence_count INTEGER,
            success_rate REAL,
            last_observed INTEGER,
            related_concepts TEXT,
            confidence REAL,
            created_at INTEGER
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS knowledge_links (
            from_entity TEXT NOT NULL,
            to_entity TEXT NOT NULL,
            link_type TEXT NOT NULL,
            strength REAL,
            created_at INTEGER,
            PRIMARY KEY (from_entity, to_entity)
          )
        `);
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
  getDb();
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

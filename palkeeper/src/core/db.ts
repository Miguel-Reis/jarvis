import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      -- Identidade de jogadores (usada a partir da Fase 2)
      CREATE TABLE players (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        player_uid             TEXT NOT NULL UNIQUE,
        steam_id               TEXT UNIQUE,
        last_name              TEXT,
        first_seen_at          TEXT NOT NULL,
        last_seen_at           TEXT NOT NULL,
        total_playtime_seconds INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE sessions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id        INTEGER NOT NULL REFERENCES players(id),
        joined_at        TEXT NOT NULL,
        left_at          TEXT,
        duration_seconds INTEGER
      );
      CREATE INDEX idx_sessions_player ON sessions(player_id);
      CREATE INDEX idx_sessions_open   ON sessions(left_at) WHERE left_at IS NULL;

      CREATE TABLE whitelist (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        steam_id TEXT NOT NULL UNIQUE,
        name     TEXT,
        added_by TEXT,
        added_at TEXT NOT NULL
      );

      CREATE TABLE bans (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        steam_id    TEXT NOT NULL UNIQUE,
        name        TEXT,
        reason      TEXT,
        banned_by   TEXT,
        banned_at   TEXT NOT NULL,
        unbanned_at TEXT
      );

      CREATE TABLE backups (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path   TEXT NOT NULL,
        size_bytes  INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        valid       INTEGER NOT NULL DEFAULT 0,
        trigger     TEXT NOT NULL,
        deleted_at  TEXT
      );

      CREATE TABLE events (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT NOT NULL,
        type             TEXT NOT NULL CHECK (type IN ('broadcast','settings-event')),
        status           TEXT NOT NULL DEFAULT 'scheduled',
        cron_expression  TEXT,
        start_at         TEXT,
        duration_minutes INTEGER,
        payload          TEXT NOT NULL,
        enabled          INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE event_runs (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id          INTEGER NOT NULL REFERENCES events(id),
        started_at        TEXT NOT NULL,
        revert_at         TEXT,
        finished_at       TEXT,
        status            TEXT NOT NULL,
        original_settings TEXT
      );
      CREATE INDEX idx_event_runs_running ON event_runs(status) WHERE status = 'running';

      CREATE TABLE metrics_history (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        ts             TEXT NOT NULL,
        server_fps     INTEGER,
        player_count   INTEGER,
        uptime_seconds INTEGER,
        ram_bytes      INTEGER
      );
      CREATE INDEX idx_metrics_ts ON metrics_history(ts);

      CREATE TABLE action_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      TEXT NOT NULL,
        actor   TEXT NOT NULL,
        action  TEXT NOT NULL,
        details TEXT
      );

      CREATE TABLE kv_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const record = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
    })();
  }
  return db;
}

export function logAction(db: Db, actor: string, action: string, details?: unknown): void {
  db.prepare("INSERT INTO action_log (ts, actor, action, details) VALUES (?, ?, ?, ?)").run(
    new Date().toISOString(),
    actor,
    action,
    details === undefined ? null : JSON.stringify(details),
  );
}

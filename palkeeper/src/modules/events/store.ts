import type { Db } from "../../core/db.js";

export type EventType = "broadcast" | "settings-event";
export type EventStatus = "scheduled" | "active" | "finished" | "cancelled";
export type RunStatus = "running" | "reverted" | "finished" | "failed";

export interface BroadcastPayload {
  /** Mensagens enviadas em sequência, com atraso opcional entre elas */
  messages: { text: string; delaySeconds?: number }[];
}

export interface SettingsPayload {
  /** Chaves do OptionSettings a alterar (ex.: { ExpRate: "2.000000" }) */
  settings: Record<string, string | number | boolean>;
  startMessage?: string;
  endMessage?: string;
  /** Countdown dos restarts do evento (default: events.countdownMinutes) */
  countdownMinutes?: number[];
}

export interface GameEvent {
  id: number;
  name: string;
  type: EventType;
  status: EventStatus;
  cronExpression: string | null;
  startAt: string | null;
  durationMinutes: number | null;
  payload: BroadcastPayload | SettingsPayload;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventRun {
  id: number;
  eventId: number;
  startedAt: string;
  revertAt: string | null;
  finishedAt: string | null;
  status: RunStatus;
  originalSettings: Record<string, string | null> | null;
}

export interface NewEvent {
  name: string;
  type: EventType;
  cronExpression?: string | null;
  startAt?: string | null;
  durationMinutes?: number | null;
  payload: BroadcastPayload | SettingsPayload;
  enabled?: boolean;
}

interface EventRow {
  id: number;
  name: string;
  type: EventType;
  status: EventStatus;
  cron_expression: string | null;
  start_at: string | null;
  duration_minutes: number | null;
  payload: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: number;
  event_id: number;
  started_at: string;
  revert_at: string | null;
  finished_at: string | null;
  status: RunStatus;
  original_settings: string | null;
}

function toEvent(row: EventRow): GameEvent {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    cronExpression: row.cron_expression,
    startAt: row.start_at,
    durationMinutes: row.duration_minutes,
    payload: JSON.parse(row.payload) as GameEvent["payload"],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRun(row: RunRow): EventRun {
  return {
    id: row.id,
    eventId: row.event_id,
    startedAt: row.started_at,
    revertAt: row.revert_at,
    finishedAt: row.finished_at,
    status: row.status,
    originalSettings: row.original_settings
      ? (JSON.parse(row.original_settings) as Record<string, string | null>)
      : null,
  };
}

/** CRUD dos eventos e das suas execuções (tabelas events / event_runs). */
export class EventStore {
  constructor(private readonly db: Db) {}

  list(): GameEvent[] {
    return (this.db.prepare("SELECT * FROM events ORDER BY id").all() as EventRow[]).map(toEvent);
  }

  get(id: number): GameEvent | null {
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  create(event: NewEvent): GameEvent {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO events (name, type, status, cron_expression, start_at, duration_minutes, payload, enabled, created_at, updated_at)
         VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.name,
        event.type,
        event.cronExpression ?? null,
        event.startAt ?? null,
        event.durationMinutes ?? null,
        JSON.stringify(event.payload),
        event.enabled === false ? 0 : 1,
        now,
        now,
      );
    return this.get(Number(result.lastInsertRowid))!;
  }

  update(id: number, patch: Partial<NewEvent>): GameEvent | null {
    const current = this.get(id);
    if (!current) return null;
    this.db
      .prepare(
        `UPDATE events SET name = ?, cron_expression = ?, start_at = ?, duration_minutes = ?,
                payload = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.cronExpression !== undefined ? patch.cronExpression : current.cronExpression,
        patch.startAt !== undefined ? patch.startAt : current.startAt,
        patch.durationMinutes !== undefined ? patch.durationMinutes : current.durationMinutes,
        JSON.stringify(patch.payload ?? current.payload),
        (patch.enabled ?? current.enabled) ? 1 : 0,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  setStatus(id: number, status: EventStatus): void {
    this.db
      .prepare("UPDATE events SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
  }

  delete(id: number): boolean {
    this.db.prepare("DELETE FROM event_runs WHERE event_id = ?").run(id);
    return this.db.prepare("DELETE FROM events WHERE id = ?").run(id).changes > 0;
  }

  /** Eventos one-shot cuja hora chegou. */
  dueOneShots(now: Date): GameEvent[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM events
           WHERE enabled = 1 AND status = 'scheduled' AND cron_expression IS NULL
             AND start_at IS NOT NULL AND start_at <= ?`,
        )
        .all(now.toISOString()) as EventRow[]
    ).map(toEvent);
  }

  // ---- runs ----

  createRun(eventId: number, revertAt: Date | null, originalSettings: Record<string, string | null> | null): EventRun {
    const result = this.db
      .prepare(
        "INSERT INTO event_runs (event_id, started_at, revert_at, status, original_settings) VALUES (?, ?, ?, 'running', ?)",
      )
      .run(
        eventId,
        new Date().toISOString(),
        revertAt ? revertAt.toISOString() : null,
        originalSettings ? JSON.stringify(originalSettings) : null,
      );
    return this.getRun(Number(result.lastInsertRowid))!;
  }

  getRun(id: number): EventRun | null {
    const row = this.db.prepare("SELECT * FROM event_runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  listRuns(eventId: number): EventRun[] {
    return (
      this.db.prepare("SELECT * FROM event_runs WHERE event_id = ? ORDER BY id DESC").all(eventId) as RunRow[]
    ).map(toRun);
  }

  finishRun(runId: number, status: RunStatus): void {
    this.db
      .prepare("UPDATE event_runs SET status = ?, finished_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), runId);
  }

  /** Runs de settings-events por reverter (inclui as que ficaram pendentes após crash). */
  dueReverts(now: Date): EventRun[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM event_runs WHERE status = 'running' AND revert_at IS NOT NULL AND revert_at <= ?",
        )
        .all(now.toISOString()) as RunRow[]
    ).map(toRun);
  }

  hasRunningRun(eventId: number): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM event_runs WHERE event_id = ? AND status = 'running'")
      .get(eventId);
  }
}

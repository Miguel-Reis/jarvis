import type { PalworldPlayer } from "../../clients/palworld-rest.js";
import type { Db } from "../../core/db.js";
import type { AppEvents } from "../../core/events.js";
import type { Logger } from "../../core/logger.js";

export interface SessionsOptions {
  db: Db;
  logger: Logger;
  events: AppEvents;
  now?: () => Date;
}

export interface PlaytimeEntry {
  playerUid: string;
  name: string | null;
  playtimeSeconds: number;
}

const LAST_POLL_KEY = "sessions.lastPollAt";

/**
 * Tracking de sessões: regista join/leave em SQLite → playtime total,
 * primeira/última vez visto. Fonte dos dados do leaderboard e resumo diário.
 */
export class SessionsModule {
  private readonly now: () => Date;

  constructor(private readonly opts: SessionsOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  start(): void {
    this.closeOrphanSessions();
    this.opts.events.on("playerJoined", (player) => this.onJoin(player));
    this.opts.events.on("playerLeft", (player) => this.onLeave(player));
  }

  isKnownPlayer(playerUid: string): boolean {
    return !!this.opts.db.prepare("SELECT 1 FROM players WHERE player_uid = ?").get(playerUid);
  }

  /** Marca o instante do último poll — usado para fechar sessões órfãs no arranque. */
  touch(): void {
    this.opts.db
      .prepare("INSERT INTO kv_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(LAST_POLL_KEY, this.now().toISOString());
  }

  onJoin(player: PalworldPlayer): void {
    const ts = this.now().toISOString();
    const { db } = this.opts;
    db.prepare(
      `INSERT INTO players (player_uid, steam_id, last_name, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(player_uid) DO UPDATE SET
         last_name = excluded.last_name,
         steam_id = COALESCE(excluded.steam_id, players.steam_id),
         last_seen_at = excluded.last_seen_at`,
    ).run(player.playerId, player.userId || null, player.name, ts, ts);
    const playerRow = db.prepare("SELECT id FROM players WHERE player_uid = ?").get(player.playerId) as {
      id: number;
    };
    // evita sessões duplicadas se um join chegar repetido
    const open = db
      .prepare("SELECT id FROM sessions WHERE player_id = ? AND left_at IS NULL")
      .get(playerRow.id);
    if (!open) {
      db.prepare("INSERT INTO sessions (player_id, joined_at) VALUES (?, ?)").run(playerRow.id, ts);
    }
  }

  onLeave(player: PalworldPlayer): void {
    this.closeSessionAt(player.playerId, this.now());
  }

  private closeSessionAt(playerUid: string, leftAt: Date): void {
    const { db, logger } = this.opts;
    const row = db
      .prepare(
        `SELECT s.id, s.joined_at, p.id AS playerId FROM sessions s
         JOIN players p ON p.id = s.player_id
         WHERE p.player_uid = ? AND s.left_at IS NULL
         ORDER BY s.id DESC LIMIT 1`,
      )
      .get(playerUid) as { id: number; joined_at: string; playerId: number } | undefined;
    if (!row) return;
    const duration = Math.max(
      0,
      Math.round((leftAt.getTime() - new Date(row.joined_at).getTime()) / 1000),
    );
    db.transaction(() => {
      db.prepare("UPDATE sessions SET left_at = ?, duration_seconds = ? WHERE id = ?").run(
        leftAt.toISOString(),
        duration,
        row.id,
      );
      db.prepare(
        "UPDATE players SET total_playtime_seconds = total_playtime_seconds + ?, last_seen_at = ? WHERE id = ?",
      ).run(duration, leftAt.toISOString(), row.playerId);
    })();
    logger.debug({ playerUid, duration }, "sessão fechada");
  }

  /**
   * Fecha sessões deixadas abertas por um crash do daemon. Usa o último
   * poll conhecido como hora de saída (nunca inflaciona o playtime).
   */
  closeOrphanSessions(): void {
    const { db, logger } = this.opts;
    const lastPoll = db.prepare("SELECT value FROM kv_state WHERE key = ?").get(LAST_POLL_KEY) as
      | { value: string }
      | undefined;
    const orphans = db
      .prepare(
        `SELECT p.player_uid AS uid, s.joined_at FROM sessions s
         JOIN players p ON p.id = s.player_id WHERE s.left_at IS NULL`,
      )
      .all() as { uid: string; joined_at: string }[];
    for (const orphan of orphans) {
      const joined = new Date(orphan.joined_at);
      let leftAt = lastPoll ? new Date(lastPoll.value) : joined;
      if (leftAt < joined) leftAt = joined;
      this.closeSessionAt(orphan.uid, leftAt);
    }
    if (orphans.length > 0) logger.warn({ count: orphans.length }, "sessões órfãs fechadas no arranque");
  }

  /** Top N por playtime entre `from` e `to` (sessões cortadas ao intervalo). */
  topPlaytime(from: Date, to: Date, limit: number): PlaytimeEntry[] {
    const rows = this.opts.db
      .prepare(
        `SELECT p.player_uid AS playerUid, p.last_name AS name,
                CAST(SUM(
                  (julianday(MIN(COALESCE(s.left_at, :to), :to)) -
                   julianday(MAX(s.joined_at, :from))) * 86400
                ) AS INTEGER) AS playtimeSeconds
         FROM sessions s JOIN players p ON p.id = s.player_id
         WHERE s.joined_at < :to AND COALESCE(s.left_at, :to) > :from
         GROUP BY p.id
         HAVING playtimeSeconds > 0
         ORDER BY playtimeSeconds DESC
         LIMIT :limit`,
      )
      .all({ from: from.toISOString(), to: to.toISOString(), limit }) as PlaytimeEntry[];
    return rows;
  }

  /** Estatísticas de um dia (para o resumo diário do Discord). */
  dayStats(from: Date, to: Date): { uniquePlayers: number; totalPlaytimeSeconds: number } {
    const row = this.opts.db
      .prepare(
        `SELECT COUNT(DISTINCT s.player_id) AS uniquePlayers,
                CAST(COALESCE(SUM(
                  (julianday(MIN(COALESCE(s.left_at, :to), :to)) -
                   julianday(MAX(s.joined_at, :from))) * 86400
                ), 0) AS INTEGER) AS totalPlaytimeSeconds
         FROM sessions s
         WHERE s.joined_at < :to AND COALESCE(s.left_at, :to) > :from`,
      )
      .get({ from: from.toISOString(), to: to.toISOString() }) as {
      uniquePlayers: number;
      totalPlaytimeSeconds: number;
    };
    return row;
  }
}

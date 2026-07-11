import type { PalworldPlayer, PalworldRestClient } from "../../clients/palworld-rest.js";
import type { MessagesConfig } from "../../config/types.js";
import { logAction, type Db } from "../../core/db.js";
import type { AppEvents } from "../../core/events.js";
import type { Logger } from "../../core/logger.js";

export interface ModerationOptions {
  db: Db;
  logger: Logger;
  events: AppEvents;
  rest: PalworldRestClient;
  messages: MessagesConfig;
  whitelistEnabled: boolean;
  /** Snapshot dos jogadores online (para o re-check periódico) */
  onlinePlayers?: () => PalworldPlayer[];
  sweepIntervalSeconds?: number;
}

export interface WhitelistEntry {
  steamId: string;
  name: string | null;
  addedBy: string | null;
  addedAt: string;
}

export interface BanEntry {
  steamId: string;
  name: string | null;
  reason: string | null;
  bannedBy: string | null;
  bannedAt: string;
  unbannedAt: string | null;
}

/**
 * Moderação persistente: whitelist e banlist em SQLite. Em modo whitelist,
 * jogadores fora da lista são kickados assim que aparecem no polling.
 */
export class ModerationModule {
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: ModerationOptions) {}

  start(): void {
    if (this.opts.whitelistEnabled) {
      this.opts.events.on("playerJoined", (player) => void this.enforceWhitelist(player));
      // Re-check periódico: apanha jogadores cujo userId só ficou disponível
      // depois do join (o /players devolve campos vazios enquanto carregam).
      if (this.opts.onlinePlayers) {
        this.sweepTimer = setInterval(
          () => void this.sweep(),
          (this.opts.sweepIntervalSeconds ?? 30) * 1000,
        );
      }
      this.opts.logger.info("modo whitelist ativo");
    }
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async sweep(): Promise<void> {
    for (const player of this.opts.onlinePlayers?.() ?? []) {
      await this.enforceWhitelist(player);
    }
  }

  async enforceWhitelist(player: PalworldPlayer): Promise<void> {
    const { db, rest, logger } = this.opts;
    const steamId = player.userId;
    if (!steamId) return; // sem userId ainda — o sweep periódico volta a verificar
    if (this.isWhitelisted(steamId)) return;
    try {
      await rest.kick(steamId, this.opts.messages.kickNotWhitelisted ?? "Not whitelisted");
      logAction(db, "moderation", "kick_not_whitelisted", { steamId, name: player.name });
      logger.info({ steamId, name: player.name }, "jogador fora da whitelist kickado");
    } catch (err) {
      logger.warn({ err, steamId }, "kick de jogador fora da whitelist falhou");
    }
  }

  isWhitelisted(steamId: string): boolean {
    return !!this.opts.db.prepare("SELECT 1 FROM whitelist WHERE steam_id = ?").get(steamId);
  }

  listWhitelist(): WhitelistEntry[] {
    return this.opts.db
      .prepare(
        "SELECT steam_id AS steamId, name, added_by AS addedBy, added_at AS addedAt FROM whitelist ORDER BY added_at",
      )
      .all() as WhitelistEntry[];
  }

  addToWhitelist(steamId: string, name: string | null, addedBy: string): void {
    this.opts.db
      .prepare(
        `INSERT INTO whitelist (steam_id, name, added_by, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(steam_id) DO UPDATE SET name = COALESCE(excluded.name, whitelist.name)`,
      )
      .run(steamId, name, addedBy, new Date().toISOString());
    logAction(this.opts.db, addedBy, "whitelist_add", { steamId, name });
  }

  removeFromWhitelist(steamId: string, removedBy: string): boolean {
    const result = this.opts.db.prepare("DELETE FROM whitelist WHERE steam_id = ?").run(steamId);
    if (result.changes > 0) logAction(this.opts.db, removedBy, "whitelist_remove", { steamId });
    return result.changes > 0;
  }

  listBans(): BanEntry[] {
    return this.opts.db
      .prepare(
        `SELECT steam_id AS steamId, name, reason, banned_by AS bannedBy,
                banned_at AS bannedAt, unbanned_at AS unbannedAt
         FROM bans ORDER BY banned_at DESC`,
      )
      .all() as BanEntry[];
  }

  /** Bane no servidor (REST) e persiste. O registo fica mesmo que o servidor esteja offline. */
  async ban(steamId: string, name: string | null, reason: string, bannedBy: string): Promise<void> {
    this.opts.db
      .prepare(
        `INSERT INTO bans (steam_id, name, reason, banned_by, banned_at, unbanned_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(steam_id) DO UPDATE SET
           reason = excluded.reason, banned_by = excluded.banned_by,
           banned_at = excluded.banned_at, unbanned_at = NULL`,
      )
      .run(steamId, name, reason, bannedBy, new Date().toISOString());
    logAction(this.opts.db, bannedBy, "ban", { steamId, reason });
    try {
      await this.opts.rest.ban(steamId, reason);
    } catch (err) {
      this.opts.logger.warn({ err, steamId }, "ban persistido mas o servidor não respondeu");
    }
  }

  async unban(steamId: string, unbannedBy: string): Promise<boolean> {
    const result = this.opts.db
      .prepare("UPDATE bans SET unbanned_at = ? WHERE steam_id = ? AND unbanned_at IS NULL")
      .run(new Date().toISOString(), steamId);
    if (result.changes === 0) return false;
    logAction(this.opts.db, unbannedBy, "unban", { steamId });
    try {
      await this.opts.rest.unban(steamId);
    } catch (err) {
      this.opts.logger.warn({ err, steamId }, "unban persistido mas o servidor não respondeu");
    }
    return true;
  }
}

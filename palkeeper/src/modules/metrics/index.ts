import type { PalworldRestClient } from "../../clients/palworld-rest.js";
import type { Db } from "../../core/db.js";
import type { Logger } from "../../core/logger.js";
import type { Scheduler } from "../../core/scheduler.js";
import type { ServerState } from "../../core/server-state.js";

export interface MetricsOptions {
  db: Db;
  logger: Logger;
  scheduler: Scheduler;
  rest: PalworldRestClient;
  serverState: ServerState;
  /** RAM atual em MB, se o watchdog a estiver a medir */
  ramMB?: () => number | null;
  retentionDays?: number;
}

export interface MetricsPoint {
  ts: string;
  server_fps: number | null;
  player_count: number | null;
  uptime_seconds: number | null;
  ram_bytes: number | null;
}

/**
 * Recolhe métricas do servidor a cada minuto para o histórico de 24h do
 * dashboard e para o resumo diário do Discord. Purga dados antigos 1×/dia.
 */
export class MetricsModule {
  constructor(private readonly opts: MetricsOptions) {}

  start(): void {
    this.opts.scheduler.scheduleEveryMinutes("metrics", 1, () => this.collect());
    this.opts.scheduler.schedule("metrics-purge", "30 4 * * *", () => this.purge());
  }

  async collect(): Promise<void> {
    const { opts } = this;
    if (!opts.serverState.isOnline) return;
    try {
      const metrics = await opts.rest.metrics();
      const ramMB = opts.ramMB?.() ?? null;
      opts.db
        .prepare(
          `INSERT INTO metrics_history (ts, server_fps, player_count, uptime_seconds, ram_bytes)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          new Date().toISOString(),
          metrics.serverfps,
          metrics.currentplayernum,
          metrics.uptime,
          ramMB === null ? null : ramMB * 1024 * 1024,
        );
    } catch (err) {
      opts.logger.debug({ err }, "recolha de métricas falhou");
    }
  }

  purge(): void {
    const cutoff = new Date(Date.now() - (this.opts.retentionDays ?? 7) * 86_400_000).toISOString();
    const result = this.opts.db.prepare("DELETE FROM metrics_history WHERE ts < ?").run(cutoff);
    if (result.changes > 0) this.opts.logger.info({ removed: result.changes }, "métricas antigas purgadas");
  }

  history(hours = 24): MetricsPoint[] {
    const from = new Date(Date.now() - hours * 3_600_000).toISOString();
    return this.opts.db
      .prepare("SELECT ts, server_fps, player_count, uptime_seconds, ram_bytes FROM metrics_history WHERE ts >= ? ORDER BY ts")
      .all(from) as MetricsPoint[];
  }

  /** % de amostras do dia em que o servidor respondeu + pico de jogadores. */
  dayStats(from: Date, to: Date): { peakPlayers: number; samples: number } {
    const row = this.opts.db
      .prepare(
        "SELECT COALESCE(MAX(player_count), 0) AS peakPlayers, COUNT(*) AS samples FROM metrics_history WHERE ts >= ? AND ts < ?",
      )
      .get(from.toISOString(), to.toISOString()) as { peakPlayers: number; samples: number };
    return row;
  }
}

import { COLORS, type DiscordWebhookClient } from "../../clients/discord-webhook.js";
import type { DiscordConfig } from "../../config/types.js";
import type { Db } from "../../core/db.js";
import type { AppEvents } from "../../core/events.js";
import type { Logger } from "../../core/logger.js";
import type { Scheduler } from "../../core/scheduler.js";
import { formatDuration } from "../leaderboard/index.js";
import type { MetricsModule } from "../metrics/index.js";
import type { SessionsModule } from "../sessions/index.js";

export interface DiscordNotifyOptions {
  config: DiscordConfig;
  db: Db;
  logger: Logger;
  events: AppEvents;
  scheduler: Scheduler;
  discord: DiscordWebhookClient;
  sessions: SessionsModule | null;
  metrics: MetricsModule | null;
  onlineCount: () => number;
}

/**
 * Liga o bus de eventos ao Discord: join/leave, backups, watchdog,
 * crash/restart do servidor e o resumo diário.
 */
export class DiscordNotifyModule {
  constructor(private readonly opts: DiscordNotifyOptions) {}

  start(): void {
    const { config, events, discord } = this.opts;
    const notify = config.notify;

    if (notify.joinLeave) {
      events.on("playerJoined", (player, meta) => {
        void discord.send({
          content: meta.firstVisit
            ? `🆕 **${player.name}** entrou no servidor pela primeira vez!`
            : `🟢 **${player.name}** entrou no servidor.`,
        });
      });
      events.on("playerLeft", (player) => {
        void discord.send({ content: `🔴 **${player.name}** saiu do servidor.` });
      });
    }

    if (notify.backups) {
      events.on("backupFinished", (backup) => {
        void discord.send({
          embeds: [
            {
              title: backup.valid ? "💾 Backup concluído" : "⚠️ Backup INVÁLIDO",
              description: `\`${backup.filePath}\` (${(backup.sizeBytes / 1024 / 1024).toFixed(1)} MB, ${backup.trigger})`,
              color: backup.valid ? COLORS.green : COLORS.red,
            },
          ],
        });
      });
    }

    if (notify.watchdog) {
      events.on("watchdogAlert", (alert) => {
        void discord.send({
          embeds: [
            {
              title: "🚨 Watchdog: restart iniciado",
              description: alert.reason,
              color: COLORS.red,
              fields: [
                { name: "RAM", value: alert.ramMB === null ? "n/d" : `${alert.ramMB} MB`, inline: true },
                { name: "FPS", value: alert.fps === null ? "n/d" : String(alert.fps), inline: true },
              ],
            },
          ],
        });
      });
    }

    if (notify.restarts) {
      events.on("restartFinished", (restart) => {
        void discord.send({
          embeds: [
            {
              title: restart.ok ? "🔄 Restart concluído" : "❌ Restart falhou",
              description: restart.reason,
              color: restart.ok ? COLORS.green : COLORS.red,
            },
          ],
        });
      });
    }

    if (notify.events) {
      events.on("eventStarted", (event) => {
        void discord.send({
          embeds: [{ title: `🎉 Evento iniciado: ${event.name}`, description: `Tipo: ${event.type}`, color: COLORS.blue }],
        });
      });
      events.on("eventFinished", (event) => {
        void discord.send({
          embeds: [{ title: `🏁 Evento terminado: ${event.name}`, color: COLORS.grey }],
        });
      });
    }

    if (notify.serverStatus) {
      events.on("serverOffline", () => {
        void discord.send({
          embeds: [{ title: "🔻 Servidor offline", description: "Deixou de responder à REST API.", color: COLORS.orange }],
        });
      });
      events.on("serverOnline", () => {
        void discord.send({ embeds: [{ title: "🔺 Servidor online", color: COLORS.green }] });
      });
    }

    if (notify.dailySummary) {
      this.opts.scheduler.schedule("discord-daily-summary", config.dailySummaryCron, () =>
        this.sendDailySummary(),
      );
    }
  }

  async sendDailySummary(): Promise<void> {
    const { discord, sessions, metrics, db } = this.opts;
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 3_600_000);
    const sessionStats = sessions?.dayStats(from, to) ?? { uniquePlayers: 0, totalPlaytimeSeconds: 0 };
    const metricStats = metrics?.dayStats(from, to) ?? { peakPlayers: 0, samples: 0 };
    const backups = db
      .prepare("SELECT COUNT(*) AS total, SUM(valid) AS valid FROM backups WHERE created_at >= ?")
      .get(from.toISOString()) as { total: number; valid: number | null };
    // % do dia com o servidor a responder (1 amostra de métricas por minuto)
    const uptimePct = Math.min(100, Math.round((metricStats.samples / (24 * 60)) * 100));

    await discord.send({
      embeds: [
        {
          title: "📊 Resumo diário do servidor",
          color: COLORS.blue,
          fields: [
            { name: "Jogadores únicos", value: String(sessionStats.uniquePlayers), inline: true },
            { name: "Pico de jogadores", value: String(metricStats.peakPlayers), inline: true },
            { name: "Online agora", value: String(this.opts.onlineCount()), inline: true },
            { name: "Tempo de jogo total", value: formatDuration(sessionStats.totalPlaytimeSeconds), inline: true },
            { name: "Uptime (aprox.)", value: `${uptimePct}%`, inline: true },
            { name: "Backups", value: `${backups.valid ?? 0}/${backups.total} válidos`, inline: true },
          ],
          timestamp: to.toISOString(),
        },
      ],
    });
    this.opts.logger.info("resumo diário enviado para o Discord");
  }
}

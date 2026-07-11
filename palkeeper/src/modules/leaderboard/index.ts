import type { PalworldRestClient } from "../../clients/palworld-rest.js";
import type { DiscordWebhookClient } from "../../clients/discord-webhook.js";
import { COLORS } from "../../clients/discord-webhook.js";
import type { Logger } from "../../core/logger.js";
import type { Scheduler } from "../../core/scheduler.js";
import type { ServerState } from "../../core/server-state.js";
import type { PlaytimeEntry, SessionsModule } from "../sessions/index.js";

export interface LeaderboardOptions {
  logger: Logger;
  scheduler: Scheduler;
  rest: PalworldRestClient;
  serverState: ServerState;
  sessions: SessionsModule;
  discord: DiscordWebhookClient | null;
  cron: string;
  top: number;
  period: "weekly" | "monthly";
  now?: () => Date;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes}min`;
}

/** Top playtime semanal/mensal, publicado por announce e Discord. */
export class LeaderboardModule {
  private readonly now: () => Date;

  constructor(private readonly opts: LeaderboardOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  start(): void {
    this.opts.scheduler.schedule("leaderboard", this.opts.cron, () => this.publish());
  }

  compute(period: "weekly" | "monthly" = this.opts.period): PlaytimeEntry[] {
    const to = this.now();
    const from = new Date(to);
    if (period === "weekly") from.setDate(from.getDate() - 7);
    else from.setMonth(from.getMonth() - 1);
    return this.opts.sessions.topPlaytime(from, to, this.opts.top);
  }

  async publish(): Promise<void> {
    const { opts } = this;
    const entries = this.compute();
    if (entries.length === 0) {
      opts.logger.info("leaderboard sem dados no período — nada a publicar");
      return;
    }
    const label = opts.period === "weekly" ? "da semana" : "do mês";
    const lines = entries.map(
      (entry, i) => `${i + 1}. ${entry.name ?? entry.playerUid} — ${formatDuration(entry.playtimeSeconds)}`,
    );

    if (opts.serverState.isOnline) {
      try {
        await opts.rest.announce(`Top jogadores ${label}:`);
        for (const line of lines) await opts.rest.announce(line);
      } catch (err) {
        opts.logger.warn({ err }, "announce do leaderboard falhou");
      }
    }
    if (opts.discord) {
      await opts.discord.send({
        embeds: [
          {
            title: `🏆 Top jogadores ${label}`,
            description: lines.join("\n"),
            color: COLORS.blue,
            timestamp: this.now().toISOString(),
          },
        ],
      });
    }
  }
}

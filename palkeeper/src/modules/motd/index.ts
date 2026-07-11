import type { PalworldRestClient } from "../../clients/palworld-rest.js";
import type { Db } from "../../core/db.js";
import type { Logger } from "../../core/logger.js";
import type { Scheduler } from "../../core/scheduler.js";
import type { ServerState } from "../../core/server-state.js";

const MOTD_INDEX_KEY = "motd.nextIndex";

export interface MotdOptions {
  db: Db;
  logger: Logger;
  scheduler: Scheduler;
  rest: PalworldRestClient;
  serverState: ServerState;
  intervalMinutes: number;
  onlyWhenPlayersOnline: boolean;
  messages: string[];
  /** nº de jogadores online agora (do PlayerPoller) */
  onlineCount: () => number;
}

/** MOTD rotativo: percorre as mensagens configuradas, com índice persistido. */
export class MotdModule {
  constructor(private readonly opts: MotdOptions) {}

  start(): void {
    this.opts.scheduler.scheduleEveryMinutes("motd", this.opts.intervalMinutes, () => this.tick());
  }

  async tick(): Promise<void> {
    const { opts } = this;
    if (!opts.serverState.isOnline) return;
    if (opts.onlyWhenPlayersOnline && opts.onlineCount() === 0) return;
    if (opts.messages.length === 0) return;
    const row = opts.db.prepare("SELECT value FROM kv_state WHERE key = ?").get(MOTD_INDEX_KEY) as
      | { value: string }
      | undefined;
    const index = (Number(row?.value ?? 0) || 0) % opts.messages.length;
    try {
      await opts.rest.announce(opts.messages[index]!);
      opts.db
        .prepare(
          "INSERT INTO kv_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(MOTD_INDEX_KEY, String((index + 1) % opts.messages.length));
    } catch (err) {
      opts.logger.warn({ err }, "announce do MOTD falhou");
    }
  }
}

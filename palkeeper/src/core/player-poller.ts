import type { PalworldPlayer, PalworldRestClient } from "../clients/palworld-rest.js";
import type { AppEvents } from "./events.js";
import type { Logger } from "./logger.js";
import type { ServerState } from "./server-state.js";

/** playerId ainda não atribuído (jogador a carregar) — ignorar até estabilizar. */
export function isValidPlayer(player: PalworldPlayer): boolean {
  const id = player.playerId?.trim();
  return !!id && id.toLowerCase() !== "none" && id !== "00000000000000000000000000000000";
}

export interface PlayerDiff {
  joined: PalworldPlayer[];
  left: PalworldPlayer[];
}

/** Diff puro entre dois snapshots de /players, por playerId. */
export function diffPlayers(
  previous: ReadonlyMap<string, PalworldPlayer>,
  current: PalworldPlayer[],
): PlayerDiff {
  const valid = current.filter(isValidPlayer);
  const currentIds = new Set(valid.map((p) => p.playerId));
  const joined = valid.filter((p) => !previous.has(p.playerId));
  const left = [...previous.values()].filter((p) => !currentIds.has(p.playerId));
  return { joined, left };
}

export interface PlayerPollerOptions {
  rest: PalworldRestClient;
  events: AppEvents;
  serverState: ServerState;
  logger: Logger;
  pollIntervalSeconds: number;
  /** true se o jogador já é conhecido (linha em `players`) — para o firstVisit */
  isKnownPlayer?: (playerId: string) => boolean;
}

/**
 * Poller central de /players: mantém o snapshot online e emite
 * playerJoined/playerLeft no bus. Todos os módulos (sessões, welcome,
 * moderação, Discord) consomem daqui — um único pedido por ciclo.
 */
export class PlayerPoller {
  private snapshot = new Map<string, PalworldPlayer>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly opts: PlayerPollerOptions) {
    // Crash/shutdown do servidor: todos os jogadores "saem".
    opts.serverState.on("offline", () => this.flushAll());
  }

  get onlinePlayers(): PalworldPlayer[] {
    return [...this.snapshot.values()];
  }

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.opts.pollIntervalSeconds * 1000);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Um ciclo de polling. Nunca lança. */
  async poll(): Promise<void> {
    if (this.polling || !this.opts.serverState.isOnline) return;
    this.polling = true;
    try {
      const current = await this.opts.rest.players();
      const { joined, left } = diffPlayers(this.snapshot, current);
      for (const player of current.filter(isValidPlayer)) {
        this.snapshot.set(player.playerId, player);
      }
      for (const player of left) this.snapshot.delete(player.playerId);

      for (const player of joined) {
        const firstVisit = this.opts.isKnownPlayer ? !this.opts.isKnownPlayer(player.playerId) : false;
        this.opts.logger.info({ name: player.name, playerId: player.playerId, firstVisit }, "jogador entrou");
        this.opts.events.emit("playerJoined", player, { firstVisit });
      }
      for (const player of left) {
        this.opts.logger.info({ name: player.name, playerId: player.playerId }, "jogador saiu");
        this.opts.events.emit("playerLeft", player);
      }
    } catch (err) {
      this.opts.logger.debug({ err }, "poll de jogadores falhou");
    } finally {
      this.polling = false;
    }
  }

  private flushAll(): void {
    for (const player of this.snapshot.values()) {
      this.opts.events.emit("playerLeft", player);
    }
    this.snapshot.clear();
  }
}

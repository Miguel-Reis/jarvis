import type { PalworldRestClient } from "../../clients/palworld-rest.js";
import type { MessagesConfig } from "../../config/types.js";
import type { AppEvents } from "../../core/events.js";
import type { Logger } from "../../core/logger.js";
import { sleep } from "../../utils/async.js";

export interface PendingWelcome {
  playerUid: string;
  name: string;
  firstVisit: boolean;
}

export interface WelcomeOptions {
  events: AppEvents;
  rest: PalworldRestClient;
  logger: Logger;
  messages: MessagesConfig;
  delaySeconds: number;
  /** true: em vez do announce global, enfileira para o PalKeeperMod entregar por PM */
  viaMod?: boolean;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Boas-vindas ao entrar, com mensagem especial na primeira visita.
 * Por announce global (default) ou, com o PalKeeperMod instalado, por
 * mensagem privada (o mod drena a fila em GET /mod/pending-welcomes).
 */
export class WelcomeModule {
  private readonly sleepFn: (ms: number) => Promise<void>;
  private pending: PendingWelcome[] = [];

  constructor(private readonly opts: WelcomeOptions) {
    this.sleepFn = opts.sleepFn ?? sleep;
  }

  start(): void {
    this.opts.events.on("playerJoined", (player, meta) => {
      if (this.opts.viaMod) {
        this.pending.push({ playerUid: player.playerId, name: player.name, firstVisit: meta.firstVisit });
        // fila limitada: se o mod não estiver a drenar, não crescer para sempre
        if (this.pending.length > 100) this.pending.shift();
      } else {
        void this.greet(player.name, meta.firstVisit);
      }
    });
  }

  /** Drena as boas-vindas pendentes (chamado pelo mod via API). */
  drainPending(): PendingWelcome[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  async greet(name: string, firstVisit: boolean): Promise<void> {
    try {
      await this.sleepFn(this.opts.delaySeconds * 1000);
      const template = firstVisit ? this.opts.messages.welcomeFirst : this.opts.messages.welcome;
      await this.opts.rest.announce(template!.replaceAll("{name}", name));
    } catch (err) {
      this.opts.logger.warn({ err, name }, "announce de boas-vindas falhou");
    }
  }
}

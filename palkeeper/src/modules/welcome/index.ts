import type { PalworldRestClient } from "../../clients/palworld-rest.js";
import type { MessagesConfig } from "../../config/types.js";
import type { AppEvents } from "../../core/events.js";
import type { Logger } from "../../core/logger.js";
import { sleep } from "../../utils/async.js";

export interface WelcomeOptions {
  events: AppEvents;
  rest: PalworldRestClient;
  logger: Logger;
  messages: MessagesConfig;
  delaySeconds: number;
  sleepFn?: (ms: number) => Promise<void>;
}

/** Announce de boas-vindas ao entrar; mensagem especial na primeira visita. */
export class WelcomeModule {
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(private readonly opts: WelcomeOptions) {
    this.sleepFn = opts.sleepFn ?? sleep;
  }

  start(): void {
    this.opts.events.on("playerJoined", (player, meta) => {
      void this.greet(player.name, meta.firstVisit);
    });
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

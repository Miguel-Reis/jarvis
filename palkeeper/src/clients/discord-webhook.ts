import type { Logger } from "../core/logger.js";
import { sleep } from "../utils/async.js";

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
}

export interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface DiscordWebhookOptions {
  webhookUrl: string;
  logger: Logger;
  username?: string;
  timeoutMs?: number;
  /** Injetável nos testes */
  sleepFn?: (ms: number) => Promise<void>;
}

export const COLORS = {
  green: 0x2ecc71,
  red: 0xe74c3c,
  orange: 0xe67e22,
  blue: 0x3498db,
  grey: 0x95a5a6,
} as const;

/**
 * Cliente de webhooks do Discord (sem bot). Fila serializada com retry em
 * 429 (respeita retry_after). NUNCA lança nem bloqueia o daemon: uma falha
 * de webhook é registada e descartada.
 */
export class DiscordWebhookClient {
  private queue: Promise<void> = Promise.resolve();
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(private readonly opts: DiscordWebhookOptions) {
    this.sleepFn = opts.sleepFn ?? sleep;
  }

  /** Enfileira o envio; devolve quando este envio for processado. */
  send(message: DiscordMessage): Promise<void> {
    this.queue = this.queue.then(() => this.deliver(message));
    return this.queue;
  }

  private async deliver(message: DiscordMessage, attempt = 0): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 10_000);
    try {
      const response = await fetch(this.opts.webhookUrl, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: this.opts.username ?? "PalKeeper", ...message }),
      });
      if (response.status === 429 && attempt < 3) {
        const body = (await response.json().catch(() => ({}))) as { retry_after?: number };
        const waitMs = Math.ceil((body.retry_after ?? 1) * 1000);
        this.opts.logger.warn({ waitMs }, "rate limit do Discord — a aguardar");
        clearTimeout(timer);
        await this.sleepFn(waitMs);
        return this.deliver(message, attempt + 1);
      }
      if (!response.ok && response.status !== 204) {
        this.opts.logger.warn({ status: response.status }, "webhook Discord recusado — mensagem descartada");
      }
    } catch (err) {
      this.opts.logger.warn({ err }, "falha a enviar webhook Discord — mensagem descartada");
    } finally {
      clearTimeout(timer);
    }
  }
}

import type { Logger } from "../core/logger.js";
import { backoffDelay, sleep } from "../utils/async.js";

export type PowerSignal = "start" | "stop" | "restart" | "kill";

export interface PelicanOptions {
  url: string;
  serverId: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  logger: Logger;
}

export class PelicanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PelicanError";
  }
}

/**
 * Cliente mínimo da Client API do Pelican Panel (compatível com Pterodactyl):
 * usado para voltar a arrancar o servidor Palworld após um shutdown gracioso.
 */
export class PelicanClient {
  constructor(private readonly opts: PelicanOptions) {}

  async power(signal: PowerSignal): Promise<void> {
    const maxRetries = this.opts.maxRetries ?? 3;
    const base = this.opts.url.replace(/\/+$/, "");
    const url = `${base}/api/client/servers/${this.opts.serverId}/power`;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000);
      try {
        const response = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ signal }),
        });
        if (response.ok || response.status === 204) {
          this.opts.logger.info({ signal }, "sinal de power enviado ao Pelican");
          return;
        }
        const text = (await response.text()).slice(0, 300);
        lastError = new PelicanError(`Pelican respondeu ${response.status}: ${text}`);
        // 4xx (auth/permissões) não melhora com retries
        if (response.status < 500) throw lastError;
      } catch (err) {
        if (err instanceof PelicanError && lastError === err) throw err;
        lastError = new PelicanError(`falha a contactar o Pelican: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
      if (attempt < maxRetries) await sleep(backoffDelay(attempt, this.opts.retryBaseMs ?? 1000));
    }
    throw lastError ?? new PelicanError("falha desconhecida no Pelican");
  }
}

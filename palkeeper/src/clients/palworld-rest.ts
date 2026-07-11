import type { Logger } from "../core/logger.js";
import type { ServerState } from "../core/server-state.js";
import { backoffDelay, sleep } from "../utils/async.js";
import { CircuitBreaker } from "./circuit-breaker.js";

export interface PalworldInfo {
  version: string;
  servername: string;
  description: string;
  worldguid?: string;
}

export interface PalworldPlayer {
  name: string;
  accountName?: string;
  playerId: string;
  userId: string;
  ip?: string;
  ping?: number;
  location_x?: number;
  location_y?: number;
  level?: number;
  building_count?: number;
}

export interface PalworldMetrics {
  serverfps: number;
  currentplayernum: number;
  serverframetime: number;
  maxplayernum: number;
  uptime: number;
  days?: number;
}

/** O servidor está offline ou o circuito está aberto — condição normal, não é um bug. */
export class ServerUnavailableError extends Error {
  constructor(message = "Servidor Palworld indisponível") {
    super(message);
    this.name = "ServerUnavailableError";
  }
}

/** Resposta HTTP de erro (ex.: 401 password errada) — o servidor ESTÁ vivo. */
export class PalworldApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PalworldApiError";
  }
}

export interface PalworldRestOptions {
  baseUrl: string;
  adminPassword: string;
  timeoutMs: number;
  maxRetries: number;
  failureThreshold: number;
  cooldownMs: number;
  logger: Logger;
  serverState: ServerState;
  /** Base do backoff entre retries (baixo nos testes) */
  retryBaseMs?: number;
}

/**
 * Cliente da REST API oficial do Palworld (/v1/api/*).
 * Retries exponenciais para falhas transitórias + circuit breaker para
 * o daemon nunca martelar (nem crashar com) um servidor offline.
 */
export class PalworldRestClient {
  private readonly breaker: CircuitBreaker;
  private readonly auth: string;
  private readonly retryBaseMs: number;

  constructor(private readonly opts: PalworldRestOptions) {
    this.auth = "Basic " + Buffer.from(`admin:${opts.adminPassword}`).toString("base64");
    this.retryBaseMs = opts.retryBaseMs ?? 1000;
    this.breaker = new CircuitBreaker({
      failureThreshold: opts.failureThreshold,
      cooldownMs: opts.cooldownMs,
      onOpen: () => {
        opts.logger.warn("circuito aberto — servidor Palworld considerado offline");
        opts.serverState.markOffline();
      },
      onClose: () => {
        opts.logger.info("circuito fechado — servidor Palworld de volta");
      },
    });
  }

  get circuitState(): string {
    return this.breaker.state;
  }

  // ---- Endpoints ----

  info(): Promise<PalworldInfo> {
    return this.request<PalworldInfo>("GET", "/v1/api/info");
  }

  async players(): Promise<PalworldPlayer[]> {
    const res = await this.request<{ players: PalworldPlayer[] }>("GET", "/v1/api/players");
    return res.players ?? [];
  }

  metrics(): Promise<PalworldMetrics> {
    return this.request<PalworldMetrics>("GET", "/v1/api/metrics");
  }

  settings(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/v1/api/settings");
  }

  async announce(message: string): Promise<void> {
    await this.request("POST", "/v1/api/announce", { message });
  }

  async kick(userid: string, message: string): Promise<void> {
    await this.request("POST", "/v1/api/kick", { userid, message });
  }

  async ban(userid: string, message: string): Promise<void> {
    await this.request("POST", "/v1/api/ban", { userid, message });
  }

  async unban(userid: string): Promise<void> {
    await this.request("POST", "/v1/api/unban", { userid });
  }

  async save(): Promise<void> {
    await this.request("POST", "/v1/api/save");
  }

  /** Shutdown gracioso: o servidor grava e desliga após `waittime` segundos. */
  async shutdown(waittime: number, message: string): Promise<void> {
    await this.request("POST", "/v1/api/shutdown", { waittime, message });
  }

  /** Paragem imediata (força). */
  async stop(): Promise<void> {
    await this.request("POST", "/v1/api/stop");
  }

  /**
   * Verifica disponibilidade com um GET /info sem retries.
   * Usado pelo poller de estado; alimenta o circuit breaker e o ServerState.
   */
  async probe(): Promise<boolean> {
    if (!this.breaker.canRequest()) return false;
    try {
      await this.doFetch("GET", "/v1/api/info");
      this.breaker.recordSuccess();
      this.opts.serverState.markOnline();
      return true;
    } catch (err) {
      if (err instanceof PalworldApiError) {
        // O servidor respondeu — está vivo, mesmo que a chamada falhe (ex.: 401).
        this.breaker.recordSuccess();
        this.opts.serverState.markOnline();
        this.opts.logger.error({ status: err.status }, "REST API respondeu com erro no probe");
        return true;
      }
      this.breaker.recordFailure();
      if (this.breaker.state !== "open") this.opts.serverState.markOffline();
      return false;
    }
  }

  // ---- Internals ----

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      if (!this.breaker.canRequest()) {
        throw new ServerUnavailableError();
      }
      try {
        const result = await this.doFetch(method, path, body);
        this.breaker.recordSuccess();
        this.opts.serverState.markOnline();
        return result as T;
      } catch (err) {
        lastError = err;
        if (err instanceof PalworldApiError) {
          // Resposta HTTP: o servidor está vivo. 4xx não beneficia de retry.
          this.breaker.recordSuccess();
          this.opts.serverState.markOnline();
          if (err.status >= 500 && attempt < this.opts.maxRetries) {
            await sleep(backoffDelay(attempt, this.retryBaseMs));
            continue;
          }
          throw err;
        }
        // Falha de rede/timeout: conta para o circuito e tenta de novo.
        this.breaker.recordFailure();
        if (attempt < this.opts.maxRetries && this.breaker.state === "closed") {
          await sleep(backoffDelay(attempt, this.retryBaseMs));
          continue;
        }
      }
    }
    if (lastError instanceof PalworldApiError) throw lastError;
    throw new ServerUnavailableError(
      `Sem resposta do servidor Palworld: ${(lastError as Error)?.message ?? "erro desconhecido"}`,
    );
  }

  private async doFetch(method: string, path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const response = await fetch(this.opts.baseUrl + path, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: this.auth,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new PalworldApiError(response.status, `${method} ${path} → ${response.status}: ${text.slice(0, 200)}`);
      }
      // Alguns POST devolvem "OK" em texto simples em vez de JSON.
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

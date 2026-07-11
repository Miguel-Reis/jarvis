export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Falhas consecutivas até abrir */
  failureThreshold: number;
  /** Tempo em aberto antes de permitir um probe */
  cooldownMs: number;
  now?: () => number;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * Circuit breaker clássico: fechado → aberto após N falhas consecutivas;
 * após o cooldown deixa passar UM pedido (half-open); sucesso fecha,
 * falha reabre e reinicia o cooldown.
 */
export class CircuitBreaker {
  private _state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? Date.now;
  }

  get state(): CircuitState {
    return this._state;
  }

  /** true se o pedido pode avançar (transita para half-open quando o cooldown passa). */
  canRequest(): boolean {
    if (this._state === "closed") return true;
    if (this._state === "half-open") return false; // já há um probe em curso
    if (this.now() - this.openedAt >= this.opts.cooldownMs) {
      this._state = "half-open";
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    const wasDown = this._state !== "closed";
    this._state = "closed";
    this.failures = 0;
    if (wasDown) this.opts.onClose?.();
  }

  recordFailure(): void {
    if (this._state === "half-open") {
      this.reopen();
      return;
    }
    this.failures += 1;
    if (this._state === "closed" && this.failures >= this.opts.failureThreshold) {
      this.reopen();
    }
  }

  private reopen(): void {
    const wasUp = this._state !== "open";
    this._state = "open";
    this.openedAt = this.now();
    this.failures = 0;
    if (wasUp) this.opts.onOpen?.();
  }
}

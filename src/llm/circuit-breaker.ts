/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by failing fast when a service is unavailable.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service failing, requests fail immediately
 * - HALF_OPEN: Testing if service recovered, one request allowed through
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting reset (OPEN -> HALF_OPEN) */
  resetTimeoutMs: number;
  /** Time window to count failures */
  failureWindowMs: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 3,
  resetTimeoutMs: 30000,
  failureWindowMs: 60000,
};

type FailureRecord = {
  timestamp: number;
  error: Error;
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: FailureRecord[] = [];
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private nextAttemptTime: number | null = null;
  private options: CircuitBreakerOptions;

  // Metrics
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalRequests = 0;
  private lastStateChange = Date.now();

  constructor(
    private name: string,
    options?: Partial<CircuitBreakerOptions>
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (!this.canExecute()) {
      throw new CircuitBreakerError(
        `Circuit breaker '${this.name}' is OPEN`,
        this.state,
        this.nextAttemptTime ? this.nextAttemptTime - Date.now() : undefined
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Check if a request can be executed
   */
  canExecute(): boolean {
    const now = Date.now();

    switch (this.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        if (this.nextAttemptTime && now >= this.nextAttemptTime) {
          this.transitionTo('HALF_OPEN');
          return true;
        }
        return false;

      case 'HALF_OPEN':
        return true;

      default:
        return false;
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN' && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
      this.transitionTo('HALF_OPEN');
    }
    return this.state;
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): {
    state: CircuitState;
    totalRequests: number;
    totalSuccesses: number;
    totalFailures: number;
    failureRate: number;
    consecutiveFailures: number;
    lastStateChange: number;
  } {
    const recentFailures = this.failures.filter(
      f => Date.now() - f.timestamp < this.options.failureWindowMs
    );

    return {
      state: this.getState(),
      totalRequests: this.totalRequests,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      failureRate: this.totalRequests > 0 ? this.totalFailures / this.totalRequests : 0,
      consecutiveFailures: recentFailures.length,
      lastStateChange: this.lastStateChange,
    };
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = [];
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    this.lastStateChange = Date.now();
    console.log(`[CircuitBreaker] '${this.name}' manually reset`);
  }

  // --- Private methods ---

  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.totalSuccesses++;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
    }

    // Clear failures on success
    this.failures = [];
  }

  private onFailure(error: Error): void {
    const now = Date.now();
    this.lastFailureTime = now;
    this.totalFailures++;

    // Record failure
    this.failures.push({ timestamp: now, error });

    // Remove old failures outside window
    const windowStart = now - this.options.failureWindowMs;
    this.failures = this.failures.filter(f => f.timestamp > windowStart);

    // Check if we should open circuit
    if (this.failures.length >= this.options.failureThreshold) {
      if (this.state !== 'OPEN') {
        this.transitionTo('OPEN');
        this.nextAttemptTime = now + this.options.resetTimeoutMs;
        console.warn(
          `[CircuitBreaker] '${this.name}' opened after ${this.failures.length} failures. Next attempt in ${this.options.resetTimeoutMs / 1000}s`
        );
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    console.log(
      `[CircuitBreaker] '${this.name}' state change: ${oldState} -> ${newState}`
    );
  }
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public state: CircuitState,
    public retryAfterMs?: number
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit Breaker Registry - manage multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  create(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    const breaker = new CircuitBreaker(name, options);
    this.breakers.set(name, breaker);
    return breaker;
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  getMetrics(): Record<string, ReturnType<CircuitBreaker['getMetrics']>> {
    const metrics: Record<string, ReturnType<CircuitBreaker['getMetrics']>> = {};
    for (const [name, breaker] of this.breakers) {
      metrics[name] = breaker.getMetrics();
    }
    return metrics;
  }
}

// Global registry for application-wide circuit breakers
export const globalCircuitBreakerRegistry = new CircuitBreakerRegistry();

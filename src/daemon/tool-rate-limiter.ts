/**
 * Per-tool rate limiter using a sliding window.
 * Prevents a single tool (e.g. run_command, web_search) from being spammed
 * beyond a configurable threshold per minute.
 */

export interface RateLimitConfig {
  windowMs: number;   // Sliding window duration in ms
  maxCalls: number;   // Max calls per window for this tool
}

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  run_command:  { windowMs: 60_000,  maxCalls: 30 },
  web_search:   { windowMs: 60_000,  maxCalls: 20 },
  browser_navigate: { windowMs: 60_000, maxCalls: 60 },
  read_file:    { windowMs: 60_000,  maxCalls: 120 },
  write_file:   { windowMs: 60_000,  maxCalls: 60 },
  /** Tools not listed get a generous default */
};

const DEFAULT_CONFIG: RateLimitConfig = { windowMs: 60_000, maxCalls: 60 };

interface WindowEntry {
  timestamp: number;
}

export class ToolRateLimiter {
  private windows = new Map<string, WindowEntry[]>();
  private customLimits = new Map<string, RateLimitConfig>();

  constructor(customLimits?: Partial<Record<string, RateLimitConfig>>) {
    if (customLimits) {
      for (const [name, cfg] of Object.entries(customLimits)) {
        this.customLimits.set(name, cfg);
      }
    }
  }

  /**
   * Check if a tool call is allowed right now.
   * Returns { allowed: true } if within rate limits.
   * Returns { allowed: false, retryAfterMs: number } if rate limited.
   */
  check(toolName: string): { allowed: boolean; retryAfterMs?: number } {
    const config = this.customLimits.get(toolName) ?? DEFAULT_LIMITS[toolName] ?? DEFAULT_CONFIG;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const entries = this.windows.get(toolName) ?? [];

    // Trim old entries outside the window
    const validEntries = entries.filter(e => e.timestamp > windowStart);
    this.windows.set(toolName, validEntries);

    if (validEntries.length >= config.maxCalls) {
      // Find how long until the oldest entry in this window expires
      const oldest = validEntries[0];
      const retryAfterMs = (oldest.timestamp + config.windowMs) - now;
      return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
    }

    return { allowed: true };
  }

  /**
   * Record a tool call (call after check() returns allowed).
   */
  record(toolName: string): void {
    const entries = this.windows.get(toolName) ?? [];
    entries.push({ timestamp: Date.now() });
    this.windows.set(toolName, entries);
  }

  /**
   * Get remaining calls for a tool in the current window.
   */
  remaining(toolName: string): number {
    const config = this.customLimits.get(toolName) ?? DEFAULT_LIMITS[toolName] ?? DEFAULT_CONFIG;
    const now = Date.now();
    const windowStart = now - config.windowMs;
    const entries = (this.windows.get(toolName) ?? []).filter(e => e.timestamp > windowStart);
    return Math.max(0, config.maxCalls - entries.length);
  }

  /**
   * Reset all rate limit state (e.g. on session change).
   */
  reset(): void {
    this.windows.clear();
  }
}

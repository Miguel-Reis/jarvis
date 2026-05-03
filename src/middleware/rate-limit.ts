/**
 * Rate Limiting Middleware
 *
 * Per-client rate limiting to prevent abuse and resource exhaustion.
 * Uses sliding window algorithm for accurate rate limiting.
 */

export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Skip rate limiting for certain paths */
  skipPaths?: string[];
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
  skipPaths: ['/health', '/favicon.ico'],
};

type WindowEntry = {
  timestamp: number;
  count: number;
};

export class SlidingWindowCounter {
  private entries = new Map<string, WindowEntry>();

  constructor(private config: RateLimitConfig) {}

  /**
   * Check if request is allowed and record it if so
   */
  checkAndRecord(clientId: string): { allowed: boolean; remaining: number; resetAfterMs: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const entry = this.entries.get(clientId) ?? { timestamp: now, count: 0 };

    // Reset if outside window
    if (entry.timestamp < windowStart) {
      entry.timestamp = now;
      entry.count = 0;
    }

    // Calculate remaining requests
    const remaining = Math.max(0, this.config.maxRequests - entry.count);

    if (entry.count >= this.config.maxRequests) {
      // Rate limited
      const resetAfterMs = entry.timestamp + this.config.windowMs - now;
      return { allowed: false, remaining: 0, resetAfterMs: Math.max(0, resetAfterMs) };
    }

    // Record request
    entry.count++;
    this.entries.set(clientId, entry);

    return { allowed: true, remaining: remaining - 1, resetAfterMs: this.config.windowMs };
  }

  /**
   * Clean up old entries (call periodically)
   */
  cleanup(): number {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    let removed = 0;

    for (const [clientId, entry] of this.entries.entries()) {
      if (entry.timestamp < windowStart) {
        this.entries.delete(clientId);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get remaining requests for a client
   */
  getRemaining(clientId: string): number {
    const now = Date.now();
    const entry = this.entries.get(clientId);

    if (!entry || entry.timestamp < now - this.config.windowMs) {
      return this.config.maxRequests;
    }

    return Math.max(0, this.config.maxRequests - entry.count);
  }
}

export class RateLimiter {
  private counter: SlidingWindowCounter;
  private config: RateLimitConfig;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.counter = new SlidingWindowCounter(this.config);

    // Run cleanup every minute
    setInterval(() => {
      const removed = this.counter.cleanup();
      if (removed > 0) {
        console.log(`[RateLimiter] Cleaned up ${removed} stale entries`);
      }
    }, 60000);
  }

  /**
   * Express-style middleware for Bun.serve
   */
  middleware(req: Request): { allowed: boolean; response?: Response; remaining?: number } {
    const url = new URL(req.url);

    // Skip certain paths
    if (this.config.skipPaths?.some(path => url.pathname.startsWith(path))) {
      return { allowed: true };
    }

    // Get client identifier (IP or user ID)
    const clientId = this.getClientId(req);

    const result = this.counter.checkAndRecord(clientId);

    if (!result.allowed) {
      return {
        allowed: false,
        response: new Response(
          JSON.stringify({
            error: 'Rate limit exceeded',
            message: `Too many requests. Try again in ${Math.ceil(result.resetAfterMs / 1000)}s`,
            retryAfter: Math.ceil(result.resetAfterMs / 1000),
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(Math.ceil(result.resetAfterMs / 1000)),
              'X-RateLimit-Limit': String(this.config.maxRequests),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Date.now() + result.resetAfterMs),
            },
          }
        ),
      };
    }

    return {
      allowed: true,
      remaining: result.remaining,
    };
  }

  /**
   * Extract client ID from request
   */
  private getClientId(req: Request): string {
    // Check for user ID header first (authenticated requests)
    const userId = req.headers.get('X-User-ID');
    if (userId) {
      return `user:${userId}`;
    }

    // Fall back to IP address
    const forwardedFor = req.headers.get('X-Forwarded-For');
    if (forwardedFor) {
      // Take first IP in chain
      const ip = forwardedFor.split(',')[0].trim();
      return `ip:${ip}`;
    }

    const realIp = req.headers.get('X-Real-IP');
    if (realIp) {
      return `ip:${realIp}`;
    }

    // Last resort - use a hash of some request characteristics
    const fingerprint = `${req.headers.get('User-Agent') ?? 'unknown'}:${req.headers.get('Accept-Language') ?? 'unknown'}`;
    return `fp:${hashString(fingerprint)}`;
  }

  /**
   * Get rate limit headers for response
   */
  getHeaders(remaining: number, resetAfterMs: number): Headers {
    return new Headers({
      'X-RateLimit-Limit': String(this.config.maxRequests),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Date.now() + resetAfterMs),
    });
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeClients: number;
    config: RateLimitConfig;
  } {
    return {
      activeClients: (this.counter as any).entries.size,
      config: this.config,
    };
  }
}

/**
 * Simple string hash function
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Global rate limiter instance
export const globalRateLimiter = new RateLimiter();

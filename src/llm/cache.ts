/**
 * LLM Response Cache
 *
 * Caches LLM responses to reduce redundant API calls and costs.
 * Uses content hashing for cache keys with configurable TTL.
 */

import { LLMMessage } from './provider';

export interface CacheEntry {
  response: string;
  timestamp: number;
  tokensUsed: number;
  model: string;
}

export interface LLMCacheOptions {
  /** Cache TTL in milliseconds (default: 5 minutes) */
  ttlMs?: number;
  /** Maximum cache size (default: 1000 entries) */
  maxSize?: number;
  /** Enable/disable cache */
  enabled?: boolean;
}

const DEFAULT_OPTIONS: Required<LLMCacheOptions> = {
  ttlMs: 5 * 60 * 1000,
  maxSize: 1000,
  enabled: true,
};

export class LLMResponseCache {
  private cache = new Map<string, CacheEntry>();
  private options: Required<LLMCacheOptions>;

  // Metrics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options?: LLMCacheOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate cache key from messages and options
   */
  private generateKey(messages: LLMMessage[], options?: { model?: string; temperature?: number }): string {
    const normalized = messages.map(m => ({
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls,
    }));

    const keyData = {
      messages: normalized,
      model: options?.model,
      temperature: options?.temperature,
    };

    return hashString(JSON.stringify(keyData));
  }

  /**
   * Get cached response or compute new one
   */
  async getOrCompute(
    messages: LLMMessage[],
    compute: () => Promise<string>,
    options?: { model?: string; temperature?: number }
  ): Promise<string> {
    if (!this.options.enabled) {
      return compute();
    }

    const key = this.generateKey(messages, options);
    const cached = this.cache.get(key);

    // Check if cached and not expired
    if (cached && Date.now() - cached.timestamp < this.options.ttlMs) {
      this.hits++;
      return cached.response;
    }

    // Cache miss or expired - compute new response
    this.misses++;
    const response = await compute();

    // Store in cache (with eviction if needed)
    if (this.cache.size >= this.options.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      tokensUsed: 0, // Would need actual token count from LLM response
      model: options?.model ?? 'unknown',
    });

    return response;
  }

  /**
   * Get cached response (returns null if not found or expired)
   */
  get(
    messages: LLMMessage[],
    options?: { model?: string; temperature?: number }
  ): string | null {
    if (!this.options.enabled) return null;

    const key = this.generateKey(messages, options);
    const cached = this.cache.get(key);

    if (!cached) {
      this.misses++;
      return null;
    }

    if (Date.now() - cached.timestamp >= this.options.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return cached.response;
  }

  /**
   * Set a cache entry manually
   */
  set(
    messages: LLMMessage[],
    response: string,
    options?: { model?: string; temperature?: number; tokensUsed?: number }
  ): void {
    if (!this.options.enabled) return;

    const key = this.generateKey(messages, options);

    if (this.cache.size >= this.options.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      tokensUsed: options?.tokensUsed ?? 0,
      model: options?.model ?? 'unknown',
    });
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    console.log('[LLMCache] Cache cleared');
  }

  /**
   * Remove expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.options.ttlMs) {
        this.cache.delete(key);
        removed++;
        this.evictions++;
      }
    }

    if (removed > 0) {
      console.log(`[LLMCache] Cleaned up ${removed} expired entries`);
    }

    return removed;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    maxSize: number;
    ttlMs: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
      maxSize: this.options.maxSize,
      ttlMs: this.options.ttlMs,
    };
  }

  /**
   * Enable or disable caching
   */
  setEnabled(enabled: boolean): void {
    this.options.enabled = enabled;
  }

  // --- Private methods ---

  private evictOldest(): void {
    // Remove oldest entry (first inserted)
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      this.cache.delete(firstKey);
      this.evictions++;
    }
  }
}

/**
 * Simple string hash function for cache keys
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

// Global cache instance
export const globalLLMCache = new LLMResponseCache();

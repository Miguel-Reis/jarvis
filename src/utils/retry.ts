/**
 * Retry with Exponential Backoff
 *
 * Centralized retry utility for handling transient failures.
 * Uses exponential backoff with jitter to prevent thundering herd.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms (default: 1000) */
  baseDelay?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelay?: number;
  /** Jitter factor 0-1 (default: 0.5) - adds randomness to prevent thundering herd */
  jitter?: number;
  /** Custom condition to determine if retry should happen */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback invoked on each retry attempt */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: 0.5,
  shouldRetry: () => true,
  onRetry: () => {},
};

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // Don't retry if we've exhausted attempts
      if (attempt === opts.maxRetries) {
        throw error;
      }

      // Check custom retry condition
      if (!opts.shouldRetry(error, attempt + 1)) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = opts.baseDelay * Math.pow(2, attempt);
      const jitterDelay = Math.random() * opts.jitter * exponentialDelay;
      const delay = Math.min(exponentialDelay + jitterDelay, opts.maxDelay);

      // Invoke retry callback
      opts.onRetry(error, attempt + 1, Math.round(delay));

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Retry with fixed delay (simpler alternative)
 */
export async function retryWithFixedDelay<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, delayMs = 1000 } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries) {
        throw lastError;
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Check if an error is retryable (network timeouts, rate limits, etc.)
 */
export function isRetryableError(error: Error): boolean {
  const retryablePatterns = [
    /timeout/i,
    /ETIMEDOUT/,
    /ECONNRESET/,
    /ECONNREFUSED/,
    /ENOTFOUND/,
    /rate.?limit/i,
    /too.?many.?requests/i,
    /temporarily.?unavailable/i,
    /service.?unavailable/i,
    /503/i,
    /502/i,
    /429/i,
  ];

  const message = error.message;
  return retryablePatterns.some(pattern => pattern.test(message));
}

/**
 * Retry only on retryable errors
 */
export async function retryOnRetryableError<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  return retryWithBackoff(fn, {
    ...options,
    shouldRetry: (error) => isRetryableError(error),
  });
}

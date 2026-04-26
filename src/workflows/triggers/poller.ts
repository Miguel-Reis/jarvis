/**
 * PollingEngine — outbound HTTP polling with deduplication
 *
 * Registers named polling jobs that periodically fetch a URL and invoke
 * a callback when new data is detected (deduplicated by a configured field).
 */

// ── Types ──

export type PollConfig = {
  /** Target URL to poll */
  url: string;
  /** How often to poll in milliseconds */
  intervalMs: number;
  /** HTTP method (default: GET) */
  method?: string;
  /** Additional request headers */
  headers?: Record<string, string>;
  /** Request body (for POST/PUT) */
  body?: string;
  /**
   * JSON path (dot-notation) into the response used for deduplication.
   * If set, the callback is only fired when this value changes.
   * Example: "data.updatedAt" or "id"
   */
  deduplicateField?: string;
};

export type PollCallback = (data: unknown, meta: PollMeta) => void;

export type PollMeta = {
  id: string;
  url: string;
  status: number;
  timestamp: number;
};

type PollJob = {
  id: string;
  config: PollConfig;
  callback: PollCallback;
  handle: ReturnType<typeof setInterval>;
  lastDeduplicateValue: unknown;
  lastPolledAt: number | null;
};

// ── Helpers ──

/**
 * Traverse a dot-separated path on an object.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── PollingEngine ──

export class PollingEngine {
  private jobs: Map<string, PollJob> = new Map();

  /**
   * Register and start a polling job.
   */
  register(id: string, config: PollConfig, callback: PollCallback): void {
    if (this.jobs.has(id)) {
      this.unregister(id);
    }

    if (config.intervalMs < 1000) {
      throw new Error(`Poll interval for "${id}" must be at least 1000ms`);
    }

    const job: PollJob = {
      id,
      config,
      callback,
      handle: null as unknown as ReturnType<typeof setInterval>,
      lastDeduplicateValue: Symbol('unset'),  // Sentinel: never equal to real data
      lastPolledAt: null,
    };

    const handle = setInterval(() => this.poll(id), config.intervalMs);
    job.handle = handle;
    this.jobs.set(id, job);

    console.log(`[PollingEngine] Registered poll job "${id}" -> ${config.url} (every ${config.intervalMs}ms)`);

    // Run immediately on first registration
    this.poll(id).catch(err => {
      console.error(`[PollingEngine] Initial poll for "${id}" failed:`, err);
    });
  }

  /**
   * Stop and remove a polling job.
   */
  unregister(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      clearInterval(job.handle);
      this.jobs.delete(id);
      console.log(`[PollingEngine] Unregistered poll job "${id}"`);
    }
  }

  /**
   * Stop and remove all polling jobs.
   */
  unregisterAll(): void {
    for (const job of this.jobs.values()) {
      clearInterval(job.handle);
    }
    this.jobs.clear();
    console.log('[PollingEngine] All poll jobs unregistered');
  }

  /**
   * Returns IDs of all active poll jobs.
   */
  getJobIds(): string[] {
    return Array.from(this.jobs.keys());
  }

  // ── Internal ──

  private async poll(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;

    const { config, callback } = job;
    const timestamp = Date.now();
    job.lastPolledAt = timestamp;

    let response: Response;
    try {
      response = await fetch(config.url, {
        method: config.method ?? 'GET',
        headers: config.headers,
        body: config.body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      console.error(`[PollingEngine] Fetch failed for "${id}" (${config.url}):`, err);
      return;
    }

    if (!response.ok) {
      console.warn(`[PollingEngine] Poll "${id}" got HTTP ${response.status}`);
      return;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') ?? '';

    try {
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
    } catch (err) {
      console.error(`[PollingEngine] Failed to parse response for "${id}":`, err);
      return;
    }

    // Deduplication check
    if (config.deduplicateField) {
      const currentValue = getNestedValue(data, config.deduplicateField);
      const serialized = JSON.stringify(currentValue);
      const lastSerialized = JSON.stringify(job.lastDeduplicateValue);

      if (serialized === lastSerialized) {
        // No change — skip callback
        return;
      }

      job.lastDeduplicateValue = currentValue;
    }

    const meta: PollMeta = {
      id,
      url: config.url,
      status: response.status,
      timestamp,
    };

    try {
      callback(data, meta);
    } catch (err) {
      console.error(`[PollingEngine] Callback for "${id}" threw:`, err);
    }
  }
}

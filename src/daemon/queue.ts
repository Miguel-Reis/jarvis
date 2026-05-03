/**
 * Message Queue for Background Jobs
 *
 * Provides guaranteed delivery for background jobs with persistence,
 * retry logic, and failure handling.
 */

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  scheduledAt?: number;
  completedAt?: number;
  failedAt?: number;
  error?: string;
  result?: unknown;
}

export interface JobHandler<T = unknown, R = unknown> {
  (payload: T): Promise<R>;
}

export interface QueueOptions {
  /** Maximum concurrent jobs */
  concurrency?: number;
  /** Default max attempts before giving up */
  defaultMaxAttempts?: number;
  /** Base delay for retries */
  baseRetryDelayMs?: number;
  /** Persist jobs to disk */
  persist?: boolean;
  /** Path for persistence */
  persistPath?: string;
}

const DEFAULT_OPTIONS: Required<QueueOptions> = {
  concurrency: 5,
  defaultMaxAttempts: 3,
  baseRetryDelayMs: 1000,
  persist: false,
  persistPath: './.jarvis/queue.json',
};

export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private pendingJobs: Job[] = [];
  private processingJobs = new Map<string, Job>();
  private options: Required<QueueOptions>;
  private processing = false;
  private activeWorkers = 0;

  // Metrics
  private totalProcessed = 0;
  private totalFailed = 0;
  private totalRetries = 0;

  constructor(options?: QueueOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Register a job handler
   */
  register<T, R>(type: string, handler: JobHandler<T, R>): void {
    this.handlers.set(type, handler as JobHandler);
    console.log(`[JobQueue] Registered handler for: ${type}`);
  }

  /**
   * Add a job to the queue
   */
  async enqueue<T>(
    type: string,
    payload: T,
    options?: { priority?: number; scheduledAt?: number; maxAttempts?: number }
  ): Promise<string> {
    const job: Job<T> = {
      id: crypto.randomUUID(),
      type,
      payload,
      status: 'pending',
      priority: options?.priority ?? 0,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? this.options.defaultMaxAttempts,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheduledAt: options?.scheduledAt,
    };

    // Persist if enabled
    if (this.options.persist) {
      await this.persistJob(job);
    }

    // Sort by priority (higher first) then by creation time
    this.pendingJobs.push(job);
    this.pendingJobs.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.createdAt - b.createdAt;
    });

    // Start processing if not already running
    this.process();

    return job.id;
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): JobStatus | undefined {
    const pending = this.pendingJobs.find(j => j.id === jobId);
    if (pending) return pending.status;

    const processing = this.processingJobs.get(jobId);
    if (processing) return processing.status;

    return undefined;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    processing: number;
    activeWorkers: number;
    totalProcessed: number;
    totalFailed: number;
    totalRetries: number;
  } {
    return {
      pending: this.pendingJobs.length,
      processing: this.processingJobs.size,
      activeWorkers: this.activeWorkers,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      totalRetries: this.totalRetries,
    };
  }

  /**
   * Clear all pending jobs
   */
  clear(): void {
    this.pendingJobs = [];
    console.log('[JobQueue] All pending jobs cleared');
  }

  // --- Private methods ---

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.pendingJobs.length > 0 && this.activeWorkers < this.options.concurrency) {
      // Find next job that's ready to run
      const now = Date.now();
      const jobIndex = this.pendingJobs.findIndex(j => {
        if (j.status !== 'pending') return false;
        if (j.scheduledAt && j.scheduledAt > now) return false;
        return true;
      });

      if (jobIndex === -1) break;

      const job = this.pendingJobs.splice(jobIndex, 1)[0];
      this.processingJobs.set(job.id, job);
      this.activeWorkers++;

      // Process job in background
      this.executeJob(job).finally(() => {
        this.activeWorkers--;
        this.processingJobs.delete(job.id);
      });
    }

    this.processing = false;

    // Schedule next processing if jobs remain
    if (this.pendingJobs.length > 0) {
      setTimeout(() => this.process(), 100);
    }
  }

  private async executeJob(job: Job): Promise<void> {
    job.status = 'processing';
    job.attempts++;
    job.updatedAt = Date.now();

    const handler = this.handlers.get(job.type);

    if (!handler) {
      this.handleJobFailure(job, new Error(`No handler registered for job type: ${job.type}`));
      return;
    }

    try {
      const result = await handler(job.payload);
      this.handleJobSuccess(job, result);
    } catch (error) {
      this.handleJobFailure(job, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleJobSuccess(job: Job, result: unknown): void {
    job.status = 'completed';
    job.result = result;
    job.completedAt = Date.now();
    job.updatedAt = Date.now();

    this.totalProcessed++;
    console.log(`[JobQueue] Job ${job.id} (${job.type}) completed successfully`);

    // Remove from persistence if completed
    if (this.options.persist) {
      this.removePersistedJob(job.id);
    }

    // Continue processing
    this.process();
  }

  private handleJobFailure(job: Job, error: Error): void {
    job.error = error.message;
    job.updatedAt = Date.now();

    if (job.attempts < job.maxAttempts) {
      // Retry with exponential backoff
      job.status = 'retrying';
      const delay = this.options.baseRetryDelayMs * Math.pow(2, job.attempts - 1);
      job.scheduledAt = Date.now() + delay;
      this.totalRetries++;

      console.warn(
        `[JobQueue] Job ${job.id} (${job.type}) failed (attempt ${job.attempts}/${job.maxAttempts}), retrying in ${delay}ms: ${error.message}`
      );

      // Re-queue for retry
      this.pendingJobs.push(job);
      this.pendingJobs.sort((a, b) => b.priority - a.priority);
    } else {
      // Give up
      job.status = 'failed';
      job.failedAt = Date.now();
      this.totalFailed++;

      console.error(`[JobQueue] Job ${job.id} (${job.type}) failed permanently after ${job.attempts} attempts: ${error.message}`);

      // Persist failed job for later inspection
      if (this.options.persist) {
        this.persistJob(job);
      }
    }

    // Continue processing
    this.process();
  }

  // --- Persistence helpers ---

  private async persistJob(job: Job): Promise<void> {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const dir = path.dirname(this.options.persistPath);
      fs.mkdirSync(dir, { recursive: true });

      const existing = this.loadPersistedJobs();
      existing.set(job.id, job);
      this.savePersistedJobs(existing);
    } catch (err) {
      console.error('[JobQueue] Failed to persist job:', err);
    }
  }

  private async removePersistedJob(jobId: string): Promise<void> {
    try {
      const existing = this.loadPersistedJobs();
      existing.delete(jobId);
      this.savePersistedJobs(existing);
    } catch (err) {
      console.error('[JobQueue] Failed to remove persisted job:', err);
    }
  }

  private loadPersistedJobs(): Map<string, Job> {
    try {
      const fs = await import('node:fs');
      if (fs.existsSync(this.options.persistPath)) {
        const data = fs.readFileSync(this.options.persistPath, 'utf-8');
        const jobs = JSON.parse(data) as Job[];
        return new Map(jobs.map(j => [j.id, j]));
      }
    } catch (err) {
      console.error('[JobQueue] Failed to load persisted jobs:', err);
    }
    return new Map();
  }

  private savePersistedJobs(jobs: Map<string, Job>): void {
    try {
      const fs = await import('node:fs');
      const data = JSON.stringify(Array.from(jobs.values()), null, 2);
      fs.writeFileSync(this.options.persistPath, data, 'utf-8');
    } catch (err) {
      console.error('[JobQueue] Failed to save persisted jobs:', err);
    }
  }

  /**
   * Load persisted jobs on startup
   */
  async loadPersistedJobsOnStartup(): Promise<void> {
    if (!this.options.persist) return;

    const jobs = this.loadPersistedJobs();
    for (const job of jobs.values()) {
      if (job.status === 'pending' || job.status === 'retrying') {
        // Reset to pending for re-processing
        job.status = 'pending';
        this.pendingJobs.push(job);
      }
    }

    this.pendingJobs.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.createdAt - b.createdAt;
    });

    console.log(`[JobQueue] Loaded ${jobs.size} persisted jobs`);
  }
}

// Global queue instance
export const globalJobQueue = new JobQueue({
  concurrency: 10,
  defaultMaxAttempts: 3,
  persist: true,
});

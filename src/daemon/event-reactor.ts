/**
 * Event Reactor — Immediate Response Engine
 *
 * Handles critical/high priority events by sending them to the agent
 * as synthetic messages with full tool access. Includes cooldown and
 * deduplication to prevent reaction storms.
 */

import type { ClassifiedEvent } from './event-classifier.ts';
import type { IAgentService } from './agent-service-interface.ts';
import { getDb } from '../vault/schema.ts';

export type ReactorConfig = {
  /** Max reactions per event type within the cooldown window */
  maxPerType: number;
  /** Cooldown window per event type in ms (default: 60s) */
  typeCooldownMs: number;
  /** Global max reactions within the global window */
  globalMax: number;
  /** Global cooldown window in ms (default: 10 min) */
  globalWindowMs: number;
};

const DEFAULT_CONFIG: ReactorConfig = {
  maxPerType: 5,
  typeCooldownMs: 10_000,
  globalMax: 15,
  globalWindowMs: 10 * 60_000,
};

export type ReactionCallback = (text: string, priority: 'urgent' | 'normal') => void;

type QueueRow = {
  id: number;
  event_type: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  reason: string;
  event_data: string;
  event_hash: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
};

function safeParse(json: string): unknown {
  try { return JSON.parse(json); } catch { return {}; }
}

export class EventReactor {
  private agentService: IAgentService | null = null;
  private config: ReactorConfig;
  private onReaction: ReactionCallback | null = null;
  private processing = false;
  // All state persists in SQLite: event_queue, reaction_log, seen_hashes

  constructor(config?: Partial<ReactorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Wire the reactor to the agent service (called during daemon startup).
   */
  setAgentService(agent: IAgentService): void {
    this.agentService = agent;
  }

  /**
   * Set callback for when a reaction is produced (e.g., broadcast via WebSocket).
   */
  setReactionCallback(cb: ReactionCallback): void {
    this.onReaction = cb;
  }

  /**
   * Attempt to react to a classified event.
   * Returns true if reaction was triggered, false if throttled/deduped.
   */
  async react(classified: ClassifiedEvent): Promise<boolean> {
    if (!this.agentService) {
      console.warn('[EventReactor] No agent service configured, skipping reaction');
      return false;
    }

    const hash = this.hashEvent(classified);

    // Deduplication: don't react to the exact same event twice
    if (this.isHashSeen(hash)) {
      return false;
    }

    // Cooldown: check per-type rate limit
    if (!this.canReactForType(classified.event.type)) {
      console.log(`[EventReactor] Cooldown active for type: ${classified.event.type}`);
      return false;
    }

    // Cooldown: check global rate limit
    if (!this.canReactGlobally()) {
      console.log('[EventReactor] Global reaction limit reached');
      return false;
    }

    // If already processing, persist for later (queue lives in SQLite — survives restart).
    if (this.processing) {
      this.enqueueEvent(classified, hash);
      const pending = this.pendingCount();
      console.log(`[EventReactor] Queued event (pending=${pending}): ${classified.reason}`);
      return true;
    }

    await this.processEvent(classified, hash);
    return true;
  }

  private enqueueEvent(classified: ClassifiedEvent, hash: string): void {
    try {
      const now = Date.now();
      getDb().prepare(`
        INSERT INTO event_queue (event_type, priority, reason, event_data, event_hash, status, attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `).run(
        classified.event.type,
        classified.priority,
        classified.reason,
        JSON.stringify(classified.event.data ?? {}),
        hash,
        now,
        now,
      );
    } catch (err) {
      console.error('[EventReactor] Failed to persist queued event:', err instanceof Error ? err.message : err);
    }
  }

  private pendingCount(): number {
    try {
      const row = getDb().prepare(`SELECT COUNT(*) as c FROM event_queue WHERE status = 'pending'`).get() as { c: number } | undefined;
      return row?.c ?? 0;
    } catch { return 0; }
  }

  /**
   * Recover any events left in 'processing' state from a previous run (daemon crash mid-react).
   * Called once at startup by the daemon.
   */
  recoverInflight(): void {
    try {
      const now = Date.now();
      const res = getDb().prepare(`
        UPDATE event_queue SET status = 'pending', updated_at = ? WHERE status = 'processing'
      `).run(now);
      const changes = (res as { changes?: number }).changes ?? 0;
      if (changes > 0) {
        console.log(`[EventReactor] Recovered ${changes} in-flight event(s) from previous run`);
      }
    } catch (err) {
      console.warn('[EventReactor] recoverInflight failed:', err instanceof Error ? err.message : err);
    }
  }

  // --- Private helpers ---

  private async processEvent(classified: ClassifiedEvent, hash: string): Promise<void> {
    this.processing = true;

    try {
      const prompt = this.buildReactionPrompt(classified);
      console.log(`[EventReactor] Reacting to ${classified.priority} event: ${classified.reason}`);

      const response = await this.agentService!.handleMessage(prompt, 'system');

      // Record the reaction
      this.recordReaction(hash, classified.event.type);

      // Broadcast via callback
      const priority = classified.priority === 'critical' ? 'urgent' : 'normal';
      if (this.onReaction && response) {
        this.onReaction(response, priority);
      }
    } catch (err) {
      console.error('[EventReactor] Reaction failed:', err);
    } finally {
      this.processing = false;

      // Drain the queue
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    const maxQueueDrain = 10; // Prevent runaway queue processing
    let drained = 0;

    while (drained < maxQueueDrain && !this.processing) {
      const next = this.dequeueNext();
      if (!next) break;

      const parsed = safeParse(next.event_data);
      const classified: ClassifiedEvent = {
        event: { type: next.event_type as ClassifiedEvent['event']['type'], data: (parsed ?? {}) as Record<string, unknown> } as ClassifiedEvent['event'],
        priority: next.priority,
        reason: next.reason,
      };

      // Re-check dedup and cooldowns before processing queued event
      if (this.isHashSeen(next.event_hash)) { this.markQueueRow(next.id, 'done'); continue; }
      if (!this.canReactForType(classified.event.type)) { this.markQueueRow(next.id, 'pending'); continue; }
      if (!this.canReactGlobally()) { this.markQueueRow(next.id, 'pending'); break; }

      try {
        await this.processEvent(classified, next.event_hash);
        this.markQueueRow(next.id, 'done');
      } catch (err) {
        this.markQueueRow(next.id, 'failed', err instanceof Error ? err.message : String(err));
      }
      drained++;
    }

    if (drained >= maxQueueDrain && this.pendingCount() > 0) {
      console.warn(`[EventReactor] Queue drain limit reached (${maxQueueDrain}), ${this.pendingCount()} events remaining`);
    }
  }

  private dequeueNext(): QueueRow | null {
    try {
      const db = getDb();
      // Atomic-ish: pick oldest pending, mark processing.
      const row = db.prepare(`
        SELECT id, event_type, priority, reason, event_data, event_hash, status, attempts
        FROM event_queue
        WHERE status = 'pending'
        ORDER BY
          CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          created_at
        LIMIT 1
      `).get() as QueueRow | undefined;
      if (!row) return null;
      const now = Date.now();
      db.prepare(`UPDATE event_queue SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'`).run(now, row.id);
      return row;
    } catch (err) {
      console.error('[EventReactor] dequeueNext failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private markQueueRow(id: number, status: QueueRow['status'], lastError?: string): void {
    try {
      const now = Date.now();
      getDb().prepare(`UPDATE event_queue SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
        .run(status, lastError ?? null, now, id);
    } catch (err) {
      console.error('[EventReactor] markQueueRow failed:', err instanceof Error ? err.message : err);
    }
  }

  private buildReactionPrompt(classified: ClassifiedEvent): string {
    const { event, priority, reason } = classified;
    const dataStr = JSON.stringify(event.data, null, 2);

    return [
      `[PROACTIVE — ${priority.toUpperCase()}]`,
      '',
      reason,
      '',
      `Event type: ${event.type}`,
      `Event data: ${dataStr}`,
      '',
      'Take appropriate action. You have full access to your tools (browser, terminal, files).',
      'If this requires user attention, explain clearly what happened and what you did or recommend.',
      'If you can handle it autonomously, do so and report what you did.',
    ].join('\n');
  }

  private hashEvent(classified: ClassifiedEvent): string {
    // Use a timestamp-bucketed key so deduplication only applies within a short window,
    // not permanently. This prevents 32-bit hash collisions from dropping distinct events.
    const bucket = Math.floor(classified.event.timestamp / 10_000); // 10-second windows
    const key = `${bucket}:${classified.event.type}:${JSON.stringify(classified.event.data).slice(0, 500)}`;
    // djb2 over a longer key — collision rate drops significantly with the bucket prefix
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
      hash |= 0;
    }
    return `${bucket}:${(hash >>> 0).toString(36)}`;
  }

  // SQLite-backed deduplication check
  private isHashSeen(hash: string): boolean {
    try {
      const row = getDb().prepare(`SELECT 1 FROM seen_hashes WHERE hash = ?`).get(hash);
      return !!row;
    } catch (err) {
      console.warn('[EventReactor] isHashSeen failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  // Record hash in seen_hashes with LRU-style tracking
  private recordHashSeen(hash: string, eventType: string): void {
    try {
      const db = getDb();
      const now = Date.now();

      // Get current head (most recently used)
      const headRow = db.prepare(`SELECT hash FROM seen_hashes WHERE next_hash IS NULL`).get() as { hash: string } | undefined;
      const currentHead = headRow?.hash ?? null;

      // Insert new hash as new head
      db.prepare(`
        INSERT INTO seen_hashes (hash, event_type, timestamp, previous_hash, next_hash)
        VALUES (?, ?, ?, ?, NULL)
      `).run(hash, eventType, now, currentHead);

      // Update old head to point to new hash
      if (currentHead) {
        db.prepare(`UPDATE seen_hashes SET next_hash = ? WHERE hash = ?`).run(hash, currentHead);
      }

      // Prune if over limit (500 entries)
      this.pruneSeenHashes(500);
    } catch (err) {
      console.warn('[EventReactor] recordHashSeen failed:', err instanceof Error ? err.message : err);
    }
  }

  // Prune oldest hashes when over limit
  private pruneSeenHashes(maxEntries: number): void {
    try {
      const db = getDb();

      // Find the tail that should become the new tail (maxEntries from head)
      const tailRow = db.prepare(`
        SELECT hash FROM seen_hashes
        ORDER BY timestamp DESC
        LIMIT 1 OFFSET ?
      `).get(maxEntries) as { hash: string } | undefined;

      if (tailRow) {
        // Delete everything older than this tail
        db.prepare(`
          DELETE FROM seen_hashes
          WHERE timestamp < (SELECT timestamp FROM seen_hashes WHERE hash = ?)
        `).run(tailRow.hash);

        // Clear the next_hash pointer of the new tail
        db.prepare(`UPDATE seen_hashes SET next_hash = NULL WHERE hash = ?`).run(tailRow.hash);
      }
    } catch (err) {
      console.warn('[EventReactor] pruneSeenHashes failed:', err instanceof Error ? err.message : err);
    }
  }

  private canReactForType(eventType: string): boolean {
    try {
      const now = Date.now();
      const cutoff = now - this.config.typeCooldownMs;

      const row = getDb().prepare(`
        SELECT COUNT(*) as c FROM reaction_log
        WHERE event_type = ? AND timestamp > ?
      `).get(eventType, cutoff) as { c: number } | undefined;

      return (row?.c ?? 0) < this.config.maxPerType;
    } catch (err) {
      console.warn('[EventReactor] canReactForType failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  private canReactGlobally(): boolean {
    try {
      const now = Date.now();
      const cutoff = now - this.config.globalWindowMs;

      const row = getDb().prepare(`
        SELECT COUNT(*) as c FROM reaction_log
        WHERE timestamp > ?
      `).get(cutoff) as { c: number } | undefined;

      return (row?.c ?? 0) < this.config.globalMax;
    } catch (err) {
      console.warn('[EventReactor] canReactGlobally failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  private recordReaction(hash: string, eventType: string): void {
    try {
      const db = getDb();
      const now = Date.now();

      // Record reaction for rate limiting
      db.prepare(`
        INSERT INTO reaction_log (event_hash, event_type, timestamp)
        VALUES (?, ?, ?)
      `).run(hash, eventType, now);

      // Record hash for deduplication
      this.recordHashSeen(hash, eventType);

      // Prune old reaction logs (keep last hour)
      const oneHourAgo = now - 60 * 60_000;
      db.prepare(`DELETE FROM reaction_log WHERE timestamp < ?`).run(oneHourAgo);
    } catch (err) {
      console.warn('[EventReactor] recordReaction failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Recover seen hashes from previous run (dedup cache warmup)
   * Called once at startup.
   */
  recoverSeenHashes(): void {
    try {
      // Keep only hashes from last hour (matches in-memory pruning behavior)
      const oneHourAgo = Date.now() - 60 * 60_000;
      const deleted = getDb().prepare(`
        DELETE FROM seen_hashes WHERE timestamp < ?
      `).run(oneHourAgo);
      const count = (deleted as { changes?: number }).changes ?? 0;
      if (count > 0) {
        console.log(`[EventReactor] Pruned ${count} expired seen hashes from previous run`);
      }
    } catch (err) {
      console.warn('[EventReactor] recoverSeenHashes failed:', err instanceof Error ? err.message : err);
    }
  }
}

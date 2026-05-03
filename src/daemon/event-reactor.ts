/**
 * Event Reactor — Immediate Response Engine
 *
 * Handles critical/high priority events by sending them to the agent
 * as synthetic messages with full tool access. Includes cooldown and
 * deduplication to prevent reaction storms.
 */

import type { ClassifiedEvent } from './event-classifier.ts';
import type { IAgentService } from './agent-service-interface.ts';

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

type ReactionRecord = {
  eventHash: string;
  eventType: string;
  timestamp: number;
};

// Simple LRU cache for deduplication with TTL
type HashEntry = {
  timestamp: number;
  previous: string | null;
  next: string | null;
};

export type ReactionCallback = (text: string, priority: 'urgent' | 'normal') => void;

const MAX_QUEUE_SIZE = 100; // Prevent unbounded queue growth

export class EventReactor {
  private agentService: IAgentService | null = null;
  private config: ReactorConfig;
  private reactionLog: ReactionRecord[] = [];
  // LRU-style doubly linked list for efficient O(1) access and pruning
  private seenHashes = new Map<string, HashEntry>();
  private seenHashHead: string | null = null;  // Most recently used
  private seenHashTail: string | null = null;  // Least recently used
  private maxHashes = 500;  // Max entries before pruning
  private onReaction: ReactionCallback | null = null;
  private queue: ClassifiedEvent[] = [];
  private processing = false;

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
    if (this.seenHashes.has(hash)) {
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

    // If already processing, queue for later (with max size limit)
    if (this.processing) {
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        console.warn(`[EventReactor] Queue full (${MAX_QUEUE_SIZE}), dropping event: ${classified.reason}`);
        return false; // Drop event if queue is full
      }
      console.log(`[EventReactor] Queuing event (${this.queue.length + 1} in queue): ${classified.reason}`);
      this.queue.push(classified);
      return true; // Will be processed later
    }

    await this.processEvent(classified, hash);
    return true;
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

    while (this.queue.length > 0 && !this.processing && drained < maxQueueDrain) {
      const next = this.queue.shift()!;
      const hash = this.hashEvent(next);

      // Re-check dedup and cooldowns before processing queued event
      if (this.seenHashes.has(hash)) continue;
      if (!this.canReactForType(next.event.type)) continue;
      if (!this.canReactGlobally()) break;

      await this.processEvent(next, hash);
      drained++;
    }

    if (this.queue.length > 0 && drained >= maxQueueDrain) {
      console.warn(`[EventReactor] Queue drain limit reached (${maxQueueDrain}), ${this.queue.length} events remaining`);
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
    // Simple hash: type + stringified data (first 500 chars to avoid huge hashes)
    const key = `${classified.event.type}:${JSON.stringify(classified.event.data).slice(0, 500)}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  // LRU cache helpers for seenHashes
  private addHashEntry(hash: string): void {
    const now = Date.now();
    const entry: HashEntry = { timestamp: now, previous: this.seenHashHead, next: null };

    if (this.seenHashHead) {
      const headEntry = this.seenHashes.get(this.seenHashHead)!;
      headEntry.next = hash;
    }

    this.seenHashes.set(hash, entry);
    this.seenHashHead = hash;

    if (!this.seenHashTail) {
      this.seenHashTail = hash;
    }

    // Prune if over limit
    while (this.seenHashes.size > this.maxHashes && this.seenHashTail) {
      const tailHash: string = this.seenHashTail;
      const tailEntry = this.seenHashes.get(tailHash)!;
      this.seenHashes.delete(tailHash);
      this.seenHashTail = tailEntry.previous;
      if (this.seenHashTail) {
        const newTailEntry = this.seenHashes.get(this.seenHashTail)!;
        newTailEntry.next = null;
      }
    }
  }

  private canReactForType(eventType: string): boolean {
    const now = Date.now();
    const cutoff = now - this.config.typeCooldownMs;

    const recentForType = this.reactionLog.filter(
      r => r.eventType === eventType && r.timestamp > cutoff
    );

    return recentForType.length < this.config.maxPerType;
  }

  private canReactGlobally(): boolean {
    const now = Date.now();
    const cutoff = now - this.config.globalWindowMs;

    const recentGlobal = this.reactionLog.filter(r => r.timestamp > cutoff);

    return recentGlobal.length < this.config.globalMax;
  }

  private recordReaction(hash: string, eventType: string): void {
    const now = Date.now();

    this.reactionLog.push({ eventHash: hash, eventType, timestamp: now });
    this.addHashEntry(hash);

    // Prune old records (keep last hour)
    const oneHourAgo = now - 60 * 60_000;
    this.reactionLog = this.reactionLog.filter(r => r.timestamp > oneHourAgo);
  }
}

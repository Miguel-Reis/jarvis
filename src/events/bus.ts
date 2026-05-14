/**
 * Event Bus
 *
 * Centralized event emitter for decoupled communication between services.
 * Replaces direct callback wiring with publish/subscribe pattern.
 */

type EventCallback<T extends unknown[]> = (...args: T) => void;

export class EventBus {
  private listeners: Map<string, Set<EventCallback<unknown[]>>> = new Map();

  /**
   * Subscribe to an event
   */
  on<T extends unknown[]>(event: string, callback: EventCallback<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback<unknown[]>);
  }

  /**
   * Unsubscribe from an event
   */
  off<T extends unknown[]>(event: string, callback: EventCallback<T>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback as EventCallback<unknown[]>);
    }
  }

  /**
   * Emit an event to all subscribers
   */
  emit<T extends unknown[]>(event: string, ...args: T): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const callback of set) {
        try {
          callback(...args);
        } catch (err) {
          console.error(`[EventBus] Error in event handler for '${event}':`, err);
        }
      }
    }
  }

  /**
   * Clear all listeners for an event (or all events if no event specified)
   */
  clear(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get number of listeners for an event
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// Singleton event bus for the application
export const eventBus = new EventBus();

// Pre-defined event types for type safety
export const DaemonEvents = {
  // Notifications
  NOTIFICATION: 'notification',           // (text: string, priority: string)

  // Agent delegation
  AGENT_DELEGATION: 'agent:delegation',   // (specialistName: string, task: string)
  AGENT_PROGRESS: 'agent:progress',       // (event: DelegationProgressEvent)

  // Sub-agent management
  SUBAGENT_START: 'subagent:start',       // (name: string, task: string)
  SUBAGENT_COMPLETE: 'subagent:complete', // (name: string, result: string)

  // Observer events
  OBSERVER_EVENT: 'observer:event',       // (event: ObserverEvent)

  // Commitment events
  COMMITMENT_DUE: 'commitment:due',       // (commitment: Commitment)
  COMMITMENT_EXECUTED: 'commitment:executed', // (commitment: Commitment)

  // Channel events
  CHANNEL_MESSAGE: 'channel:message',     // (channel: string, message: ChannelMessage)
  CHANNEL_BROADCAST: 'channel:broadcast', // (message: string)

  // System events
  HEARTBEAT_START: 'heartbeat:start',
  HEARTBEAT_COMPLETE: 'heartbeat:complete',
  HEARTBEAT_FAILURE: 'heartbeat:failure',   // (info: { attempts: number; lastError?: string })
  SHUTDOWN_START: 'shutdown:start',
  SHUTDOWN_COMPLETE: 'shutdown:complete',
} as const;

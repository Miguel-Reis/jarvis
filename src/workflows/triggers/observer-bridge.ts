/**
 * ObserverBridge — thin adapter between the Observer layer and workflow triggers
 *
 * Subscribes to ObserverManager events and routes them to the trigger system,
 * mapping observer event types to canonical workflow trigger event types.
 */

import type { ObserverManager, ObserverEvent } from '../../observers/index.ts';

// ── Types ──

/**
 * Canonical workflow trigger event types sourced from the Observer layer.
 */
export type ObserverTriggerType =
  | 'file_change'
  | 'clipboard'
  | 'process'
  | 'email'
  | 'calendar'
  | 'notification'
  | 'screen';

export type TriggerCallback = (eventType: ObserverTriggerType, data: Record<string, unknown>) => void;

// ── Event type mapping ──

/**
 * Maps raw observer event type strings (observer.name + "." + event sub-type)
 * to canonical workflow trigger types.
 *
 * Observer names and event types observed in the codebase:
 *   - FileWatcher:          file_changed, file_created, file_deleted
 *   - ClipboardMonitor:     clipboard_changed
 *   - ProcessMonitor:       process_started, process_stopped, process_changed
 *   - EmailSync:            email_received, email_sent
 *   - CalendarSync:         calendar_event_created, calendar_event_updated, calendar_event_reminder
 *   - NotificationListener: notification_received
 *   - Screen/awareness:     screen_changed, screen_text_detected
 */
const EVENT_TYPE_MAP: Record<string, ObserverTriggerType> = {
  // File watcher
  file_changed: 'file_change',
  file_created: 'file_change',
  file_deleted: 'file_change',
  file_modified: 'file_change',

  // Clipboard
  clipboard_changed: 'clipboard',
  clipboard_copied: 'clipboard',

  // Process monitor
  process_started: 'process',
  process_stopped: 'process',
  process_changed: 'process',
  process_exited: 'process',

  // Email
  email_received: 'email',
  email_sent: 'email',
  email_new: 'email',

  // Calendar
  calendar_event_created: 'calendar',
  calendar_event_updated: 'calendar',
  calendar_event_reminder: 'calendar',
  calendar_event_deleted: 'calendar',

  // Notifications
  notification_received: 'notification',

  // Screen / awareness
  screen_changed: 'screen',
  screen_text_detected: 'screen',
  screen_app_switched: 'screen',
  ocr_text_changed: 'screen',
};

// ── ObserverBridge ──

export class ObserverBridge {
  private observerManager: ObserverManager;
  private triggerCallback: TriggerCallback | null = null;
  private running = false;

  constructor(observerManager: ObserverManager) {
    this.observerManager = observerManager;
  }

  /**
   * Set the callback invoked when an observer event arrives.
   */
  setTriggerCallback(cb: TriggerCallback): void {
    this.triggerCallback = cb;
  }

  /**
   * Start the bridge — subscribe to all observer events.
   */
  start(): void {
    if (this.running) return;

    this.observerManager.setEventHandler((event: ObserverEvent) => {
      this.routeEvent(event);
    });

    this.running = true;
    console.log('[ObserverBridge] Started — listening to observer events');
  }

  /**
   * Stop the bridge — clear the event handler.
   * Observers continue running; we just stop routing their events.
   */
  stop(): void {
    if (!this.running) return;

    // Replace the handler with a no-op so we stop routing events
    this.observerManager.setEventHandler(() => {});

    this.running = false;
    console.log('[ObserverBridge] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Internal ──

  private routeEvent(event: ObserverEvent): void {
    if (!this.triggerCallback) return;

    const triggerType = this.mapEventType(event.type);
    if (!triggerType) {
      // Unknown event type — skip silently
      return;
    }

    const data: Record<string, unknown> = {
      ...event.data,
      _observer: {
        originalType: event.type,
        timestamp: event.timestamp,
      },
    };

    try {
      this.triggerCallback(triggerType, data);
    } catch (err) {
      console.error(`[ObserverBridge] Trigger callback threw for event type "${triggerType}":`, err);
    }
  }

  private mapEventType(rawType: string): ObserverTriggerType | null {
    // Direct match
    if (rawType in EVENT_TYPE_MAP) {
      return EVENT_TYPE_MAP[rawType]!;
    }

    // Prefix match (e.g. "file_" -> file_change)
    if (rawType.startsWith('file_')) return 'file_change';
    if (rawType.startsWith('clipboard_')) return 'clipboard';
    if (rawType.startsWith('process_')) return 'process';
    if (rawType.startsWith('email_')) return 'email';
    if (rawType.startsWith('calendar_')) return 'calendar';
    if (rawType.startsWith('notification_')) return 'notification';
    if (rawType.startsWith('screen_') || rawType.startsWith('ocr_')) return 'screen';

    return null;
  }
}

/**
 * Smart Notification Service
 *
 * Centralized notification management with:
 * - Priority classification (critical, high, normal, low)
 * - Grouping of related notifications
 * - Silent hours support
 * - Digest mode (batch notifications)
 * - Multi-channel delivery (desktop, voice, WebSocket)
 */

import type { Service, ServiceStatus } from '../daemon/types.ts';
import { sendDesktopNotification } from '../comms/desktop-notify.ts';

export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

export type NotificationCategory = 'error' | 'success' | 'info' | 'warning' | 'question' | 'system';

export interface Notification {
  id: string;
  priority: NotificationPriority;
  category: NotificationCategory;
  title: string;
  message: string;
  group?: string;           // For grouping related notifications
  timestamp: number;
  expireAfterMs?: number;   // Auto-expire after this time
  requireAck?: boolean;     // Requires user acknowledgment
  acknowledged?: boolean;
  data?: Record<string, unknown>;
}

export interface NotificationConfig {
  enabled: boolean;
  silentHours?: {
    start: number;    // Hour (0-23)
    end: number;      // Hour (0-23)
  };
  digestMode: boolean;
  digestIntervalMs: number;
  maxGroupSize: number;
  voiceForCritical: boolean;
}

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: true,
  silentHours: undefined,
  digestMode: false,
  digestIntervalMs: 300000,  // 5 minutes
  maxGroupSize: 5,
  voiceForCritical: true,
};

export class NotificationService implements Service {
  name = 'notifications';
  private config: NotificationConfig;
  private statusState: ServiceStatus = 'stopped';
  private notificationQueue: Notification[] = [];
  private groupedNotifications: Map<string, Notification[]> = new Map();
  private digestTimer: Timer | null = null;
  private onNotification?: (notification: Notification) => void;

  constructor(config?: Partial<NotificationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[NotificationService] Starting...');
    this.statusState = 'starting';

    try {
      // Start digest timer if enabled
      if (this.config.digestMode) {
        this.startDigestTimer();
      }

      this.statusState = 'running';
      console.log('[NotificationService] Running');
    } catch (err) {
      this.statusState = 'error';
      console.error('[NotificationService] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[NotificationService] Stopping...');
    this.statusState = 'stopping';

    if (this.digestTimer) {
      clearInterval(this.digestTimer);
      this.digestTimer = null;
    }

    this.statusState = 'stopped';
    console.log('[NotificationService] Stopped');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Set notification callback (for WebSocket broadcast)
   */
  setNotificationCallback(callback: (notification: Notification) => void): void {
    this.onNotification = callback;
  }

  /**
   * Send a notification
   */
  async send(notification: Omit<Notification, 'id' | 'timestamp'>): Promise<Notification> {
    const fullNotification: Notification = {
      ...notification,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    // Check silent hours
    if (this.isSilentHours() && notification.priority !== 'critical') {
      console.log('[NotificationService] Silent hours — queuing notification');
      this.notificationQueue.push(fullNotification);
      return fullNotification;
    }

    // Group if needed
    if (notification.group) {
      this.addToGroup(fullNotification);
    }

    // Deliver immediately or queue for digest
    if (!this.config.digestMode || notification.priority === 'critical' || notification.priority === 'high') {
      await this.deliver(fullNotification);
    } else {
      this.notificationQueue.push(fullNotification);
    }

    // Callback for WebSocket
    if (this.onNotification) {
      this.onNotification(fullNotification);
    }

    return fullNotification;
  }

  /**
   * Check if currently in silent hours
   */
  private isSilentHours(): boolean {
    if (!this.config.silentHours) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const { start, end } = this.config.silentHours;

    if (start < end) {
      // Same day range (e.g., 22-7)
      return currentHour >= start || currentHour < end;
    } else {
      // Overnight range (e.g., 22-7)
      return currentHour >= start && currentHour < end;
    }
  }

  /**
   * Deliver a notification to user
   */
  private async deliver(notification: Notification): Promise<void> {
    const { title, message, priority } = notification;

    // Desktop notification
    const urgency = priority === 'critical' ? 'critical' :
                    priority === 'high' ? 'normal' : 'low';
    const expireMs = notification.expireAfterMs ??
                     (priority === 'critical' ? 30000 : 10000);

    sendDesktopNotification(title, message, { urgency, expireMs });

    // Voice for critical notifications
    if (this.config.voiceForCritical && priority === 'critical') {
      // Will be broadcast via WebSocket by the callback
      console.log('[NotificationService] 🚨 CRITICAL:', title);
    }

    console.log(`[NotificationService] Delivered: [${priority.toUpperCase()}] ${title}`);
  }

  /**
   * Add notification to a group
   */
  private addToGroup(notification: Notification): void {
    const group = notification.group!;
    const existing = this.groupedNotifications.get(group) ?? [];

    if (existing.length >= this.config.maxGroupSize) {
      // Remove oldest
      existing.shift();
    }

    existing.push(notification);
    this.groupedNotifications.set(group, existing);
  }

  /**
   * Get grouped notifications
   */
  getGroupedNotifications(): Map<string, Notification[]> {
    return new Map(this.groupedNotifications);
  }

  /**
   * Get queued notifications (for digest)
   */
  getQueuedNotifications(): Notification[] {
    return [...this.notificationQueue];
  }

  /**
   * Clear queued notifications
   */
  clearQueue(): void {
    this.notificationQueue = [];
  }

  /**
   * Clear a specific group
   */
  clearGroup(group: string): void {
    this.groupedNotifications.delete(group);
  }

  /**
   * Acknowledge a notification
   */
  acknowledge(notificationId: string): boolean {
    const notification = this.notificationQueue.find(n => n.id === notificationId);
    if (notification) {
      notification.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Start digest timer (batch delivery)
   */
  private startDigestTimer(): void {
    this.digestTimer = setInterval(() => {
      if (this.notificationQueue.length > 0 && !this.isSilentHours()) {
        console.log(`[NotificationService] Digest delivering ${this.notificationQueue.length} notifications`);

        const batch = [...this.notificationQueue];
        this.notificationQueue = [];

        for (const notification of batch) {
          this.deliver(notification).catch(err =>
            console.error('[NotificationService] Digest delivery error:', err)
          );
        }
      }
    }, this.config.digestIntervalMs);

    console.log(`[NotificationService] Digest timer started (${this.config.digestIntervalMs}ms)`);
  }

  /**
   * Generate unique notification ID
   */
  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Configure silent hours
   */
  setSilentHours(start: number, end: number): void {
    this.config.silentHours = { start, end };
    console.log(`[NotificationService] Silent hours set: ${start}:00 - ${end}:00`);
  }

  /**
   * Enable/disable digest mode
   */
  setDigestMode(enabled: boolean): void {
    this.config.digestMode = enabled;

    if (enabled && !this.digestTimer) {
      this.startDigestTimer();
    } else if (!enabled && this.digestTimer) {
      clearInterval(this.digestTimer);
      this.digestTimer = null;
    }

    console.log(`[NotificationService] Digest mode: ${enabled ? 'on' : 'off'}`);
  }
}

/**
 * Singleton instance for global notifications
 */
export const globalNotificationService = new NotificationService();

/**
 * Send a notification through the global service
 */
export async function sendNotification(
  priority: NotificationPriority,
  category: NotificationCategory,
  title: string,
  message: string,
  options?: Partial<Omit<Notification, 'id' | 'timestamp'>>
): Promise<Notification> {
  return globalNotificationService.send({
    priority,
    category,
    title,
    message,
    ...options,
  });
}

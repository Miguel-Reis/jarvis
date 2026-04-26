/**
 * NotificationListener — D-Bus Notification Monitor (Linux/WSL2)
 *
 * Monitors system notifications by watching D-Bus for
 * org.freedesktop.Notifications.Notify method calls.
 * Parses notification fields: app_name, summary, body, urgency.
 *
 * Graceful: if dbus-monitor is not found, logs warning and stays no-op.
 */

import type { Observer, ObserverEventHandler } from './index';
import type { Subprocess } from 'bun';

type NotificationData = {
  app: string;
  title: string;
  body: string;
  urgency: string;
};

export class NotificationListener implements Observer {
  name = 'notifications';
  private running = false;
  private handler: ObserverEventHandler | null = null;
  private process: Subprocess | null = null;
  private available = false;

  async start(): Promise<void> {
    this.running = true;

    // Check if dbus-monitor exists
    try {
      const check = Bun.spawnSync(['which', 'dbus-monitor']);
      if (check.exitCode !== 0) {
        console.log('[notifications] dbus-monitor not found — notification monitoring disabled');
        return;
      }
      this.available = true;
    } catch {
      console.log('[notifications] Cannot check for dbus-monitor — notification monitoring disabled');
      return;
    }

    // Spawn dbus-monitor watching for Notify signals
    try {
      this.process = Bun.spawn(
        [
          'dbus-monitor',
          '--session',
          "interface='org.freedesktop.Notifications',member='Notify'",
        ],
        {
          stdout: 'pipe',
          stderr: 'ignore',
        }
      );

      console.log('[notifications] Observer started — monitoring D-Bus notifications');

      // Parse stdout in background
      this.readOutput();
    } catch (err) {
      console.error('[notifications] Failed to start dbus-monitor:', err);
      this.available = false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // Ignore
      }
      this.process = null;
    }

    console.log('[notifications] Observer stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(handler: ObserverEventHandler): void {
    this.handler = handler;
  }

  /**
   * Read dbus-monitor output and parse notification blocks.
   *
   * D-Bus notification format (method_call):
   *   method call ... dest=org.freedesktop.Notifications ... member=Notify
   *   string "app_name"
   *   uint32 ...
   *   string "icon"
   *   string "summary"
   *   string "body"
   *   array [ ... ]
   *   ...
   */
  private async readOutput(): Promise<void> {
    if (!this.process?.stdout) return;

    const reader = (this.process.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // State machine for parsing method_call blocks
    let inMethodCall = false;
    let stringIndex = 0;
    let currentNotification: Partial<NotificationData> = {};

    try {
      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          // Detect start of a new method call
          if (trimmed.startsWith('method call') && trimmed.includes('member=Notify')) {
            inMethodCall = true;
            stringIndex = 0;
            currentNotification = {};
            continue;
          }

          // Detect start of next method/signal (end of current block)
          if (inMethodCall && (trimmed.startsWith('method call') || trimmed.startsWith('signal') || trimmed.startsWith('method return'))) {
            // Emit the notification if we got enough data
            this.emitNotification(currentNotification);
            inMethodCall = trimmed.startsWith('method call') && trimmed.includes('member=Notify');
            stringIndex = 0;
            currentNotification = {};
            continue;
          }

          if (!inMethodCall) continue;

          // Parse string values — the Notify method has these string args in order:
          // 0: app_name, 1: (replaces_id is uint32, skip), 2: icon, 3: summary, 4: body
          const stringMatch = trimmed.match(/^string\s+"(.*)"/);
          if (stringMatch) {
            const val = stringMatch[1];
            switch (stringIndex) {
              case 0: currentNotification.app = val; break;
              // index 1 is icon (we skip)
              case 1: break; // icon
              case 2: currentNotification.title = val; break;
              case 3: currentNotification.body = val; break;
            }
            stringIndex++;
            continue;
          }

          // Parse urgency from hints dict (byte value)
          const urgencyMatch = trimmed.match(/byte\s+(\d+)/);
          if (urgencyMatch) {
            const urgencyLevel = parseInt(urgencyMatch[1]!);
            currentNotification.urgency =
              urgencyLevel === 2 ? 'critical' :
              urgencyLevel === 1 ? 'normal' :
              'low';
          }
        }
      }
    } catch (err) {
      if (this.running) {
        console.error('[notifications] Read error:', err);
      }
    }
  }

  private emitNotification(data: Partial<NotificationData>): void {
    if (!data.title && !data.body) return;
    if (!this.handler) return;

    this.handler({
      type: 'notification',
      data: {
        app: data.app ?? 'unknown',
        title: data.title ?? '',
        body: data.body ?? '',
        urgency: data.urgency ?? 'normal',
      },
      timestamp: Date.now(),
    });
  }
}

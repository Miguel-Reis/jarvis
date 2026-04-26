/**
 * ClipboardMonitor - Monitors clipboard changes
 *
 * Polls the system clipboard at regular intervals and emits events when content changes.
 * Uses platform-specific commands to read clipboard content.
 */

import type { Observer, ObserverEvent, ObserverEventHandler } from './index';

export class ClipboardMonitor implements Observer {
  name = 'clipboard';
  private interval: Timer | null = null;
  private lastContent: string = '';
  private handler: ObserverEventHandler | null = null;
  private running = false;
  private pollMs: number;

  constructor(pollMs: number = 1000) {
    this.pollMs = pollMs;
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log('[clipboard] Already running');
      return;
    }

    console.log(`[clipboard] Starting clipboard monitoring (polling every ${this.pollMs}ms)...`);

    // Initialize with current clipboard content
    try {
      this.lastContent = await this.readClipboard();
    } catch (error) {
      console.error('[clipboard] Failed to read initial clipboard:', error);
      this.lastContent = '';
    }

    // Start polling
    this.interval = setInterval(async () => {
      try {
        const content = await this.readClipboard();

        if (content !== this.lastContent) {
          this.lastContent = content;

          if (this.handler) {
            const event: ObserverEvent = {
              type: 'clipboard',
              data: {
                content,
                length: content.length,
              },
              timestamp: Date.now(),
            };

            this.handler(event);
          }
        }
      } catch (error) {
        // Silent fail on read errors to avoid spam
        // console.error('[clipboard] Failed to read clipboard:', error);
      }
    }, this.pollMs);

    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log('[clipboard] Stopping clipboard monitoring...');

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(handler: ObserverEventHandler): void {
    this.handler = handler;
  }

  /**
   * Read clipboard content using platform-specific commands
   */
  private async readClipboard(): Promise<string> {
    const platform = process.platform;

    try {
      let result: { stdout: Buffer; stderr: Buffer };

      if (platform === 'linux') {
        // Try xclip first
        try {
          result = await Bun.$`xclip -selection clipboard -o`.quiet();
          return result.stdout.toString().trim();
        } catch {
          // Fall back to xsel
          try {
            result = await Bun.$`xsel --clipboard --output`.quiet();
            return result.stdout.toString().trim();
          } catch {
            // Check if we're in WSL and can use PowerShell
            try {
              result = await Bun.$`powershell.exe Get-Clipboard`.quiet();
              return result.stdout.toString().trim();
            } catch {
              throw new Error('No clipboard tool available (tried xclip, xsel, powershell.exe)');
            }
          }
        }
      } else if (platform === 'darwin') {
        // macOS
        result = await Bun.$`pbpaste`.quiet();
        return result.stdout.toString().trim();
      } else if (platform === 'win32') {
        // Windows
        result = await Bun.$`powershell.exe Get-Clipboard`.quiet();
        return result.stdout.toString().trim();
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch (error) {
      // Return empty string on error
      return '';
    }
  }
}

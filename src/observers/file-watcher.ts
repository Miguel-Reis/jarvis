/**
 * FileWatcher - Monitors file system changes
 *
 * Watches specified directories recursively and emits events when files change.
 * Includes debouncing to avoid duplicate rapid-fire events.
 */

import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { Observer, ObserverEvent, ObserverEventHandler } from './index';

type DebounceEntry = {
  path: string;
  timestamp: number;
};

export class FileWatcher implements Observer {
  name = 'file-watcher';
  private watchers: FSWatcher[] = [];
  private paths: string[];
  private handler: ObserverEventHandler | null = null;
  private running = false;
  private recentChanges: Map<string, number> = new Map();
  private debounceMs = 100; // Ignore duplicate events within 100ms

  constructor(paths: string[]) {
    this.paths = paths;
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log('[file-watcher] Already running');
      return;
    }

    console.log('[file-watcher] Starting file system monitoring...');

    for (const path of this.paths) {
      try {
        const watcher = watch(path, { recursive: true }, (eventType, filename) => {
          this.handleFileEvent(path, eventType, filename);
        });

        watcher.on('error', (error) => {
          console.error(`[file-watcher] Error watching ${path}:`, error);
        });

        this.watchers.push(watcher);
        console.log(`[file-watcher] Watching: ${path}`);
      } catch (error) {
        console.error(`[file-watcher] Failed to watch ${path}:`, error);
      }
    }

    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log('[file-watcher] Stopping file system monitoring...');

    for (const watcher of this.watchers) {
      watcher.close();
    }

    this.watchers = [];
    this.recentChanges.clear();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(handler: ObserverEventHandler): void {
    this.handler = handler;
  }

  private handleFileEvent(
    basePath: string,
    eventType: 'rename' | 'change',
    filename: string | null
  ): void {
    if (!filename || !this.handler) {
      return;
    }

    const fullPath = join(basePath, filename);
    const now = Date.now();

    // Debounce: skip if same file changed within debounceMs
    const lastChange = this.recentChanges.get(fullPath);
    if (lastChange && now - lastChange < this.debounceMs) {
      return;
    }

    this.recentChanges.set(fullPath, now);

    // Clean up old entries to prevent memory leak
    if (this.recentChanges.size > 1000) {
      const cutoff = now - this.debounceMs * 2;
      for (const [path, timestamp] of this.recentChanges.entries()) {
        if (timestamp < cutoff) {
          this.recentChanges.delete(path);
        }
      }
    }

    const event: ObserverEvent = {
      type: 'file_change',
      data: {
        path: fullPath,
        eventType,
        filename,
        basePath,
      },
      timestamp: now,
    };

    this.handler(event);
  }
}

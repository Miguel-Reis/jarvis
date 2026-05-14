/**
 * EditorActivityObserver — tracks recent source-file edits and linter errors.
 *
 * Watches code directories, aggregates edit bursts per file, and emits
 * periodic `editor_activity` events. Linter errors can be pushed in via
 * recordLinterErrors() from whichever process runs tsc/eslint.
 */

import { watch, type FSWatcher } from 'node:fs';
import { join, extname } from 'node:path';
import type { Observer, ObserverEvent, ObserverEventHandler } from './index';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.json', '.md']);

export type LinterError = {
  file: string;
  line: number;
  message: string;
  severity: 'error' | 'warning';
};

type EditEntry = {
  path: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

export type EditorActivitySnapshot = {
  totalEdits: number;
  fileCount: number;
  burstFiles: string[];           // files edited 5+ times in the window
  extensions: Record<string, number>;
  linterErrors: LinterError[];
};

export class EditorActivityObserver implements Observer {
  name = 'editor-activity';
  private watchers: FSWatcher[] = [];
  private handler: ObserverEventHandler | null = null;
  private running = false;
  private edits = new Map<string, EditEntry>();
  private linterErrors: LinterError[] = [];
  private flushTimer: Timer | null = null;
  private paths: string[];
  private flushIntervalMs: number;
  private burstThreshold: number;

  constructor(paths: string[], options: { flushIntervalMs?: number; burstThreshold?: number } = {}) {
    this.paths = paths;
    this.flushIntervalMs = options.flushIntervalMs ?? 30_000;
    this.burstThreshold = options.burstThreshold ?? 5;
  }

  async start(): Promise<void> {
    if (this.running) return;

    for (const path of this.paths) {
      try {
        const watcher = watch(path, { recursive: true }, (_eventType, filename) => {
          if (!filename) return;
          const ext = extname(filename);
          if (!SOURCE_EXTS.has(ext)) return;
          this.recordEdit(join(path, filename));
        });
        watcher.on('error', err => console.error(`[editor-activity] Watch error on ${path}:`, err));
        this.watchers.push(watcher);
      } catch (err) {
        console.error(`[editor-activity] Failed to watch ${path}:`, err);
      }
    }

    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    this.running = true;
    console.log(`[editor-activity] Watching ${this.paths.length} path(s); flush every ${this.flushIntervalMs / 1000}s`);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(handler: ObserverEventHandler): void {
    this.handler = handler;
  }

  recordLinterErrors(errors: LinterError[]): void {
    this.linterErrors = errors.slice(0, 100);
  }

  getSnapshot(): EditorActivitySnapshot {
    const extensions: Record<string, number> = {};
    const burstFiles: string[] = [];
    let totalEdits = 0;
    for (const entry of this.edits.values()) {
      totalEdits += entry.count;
      const ext = extname(entry.path) || 'other';
      extensions[ext] = (extensions[ext] ?? 0) + entry.count;
      if (entry.count >= this.burstThreshold) burstFiles.push(entry.path);
    }
    return {
      totalEdits,
      fileCount: this.edits.size,
      burstFiles,
      extensions,
      linterErrors: [...this.linterErrors],
    };
  }

  private recordEdit(path: string): void {
    const now = Date.now();
    const existing = this.edits.get(path);
    if (existing) {
      existing.count++;
      existing.lastSeen = now;
    } else {
      this.edits.set(path, { path, count: 1, firstSeen: now, lastSeen: now });
    }
  }

  private flush(): void {
    if (this.edits.size === 0 && this.linterErrors.length === 0) return;
    const snapshot = this.getSnapshot();
    const event: ObserverEvent = {
      type: 'editor_activity',
      data: snapshot as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    };
    this.handler?.(event);
    this.edits.clear();
  }
}

/**
 * BrowserActivityObserver — tracks tab/URL state pushed from the browser side.
 *
 * The observer itself does no scraping. Browser extensions, MCP integrations,
 * or dashboard panels call recordTab() / recordNavigation() and the observer
 * aggregates + emits periodic snapshots for struggle-detection correlation.
 */

import type { Observer, ObserverEvent, ObserverEventHandler } from './index';

export type BrowserTab = {
  tabId: string;
  url: string;
  title: string;
  active: boolean;
  ts: number;
};

export type BrowserNavigation = {
  tabId: string;
  fromUrl: string | null;
  toUrl: string;
  ts: number;
};

export type BrowserActivitySnapshot = {
  activeTabs: BrowserTab[];
  navigationCount: number;
  domains: Record<string, number>;
  searchQueries: string[];
};

export class BrowserActivityObserver implements Observer {
  name = 'browser-activity';
  private handler: ObserverEventHandler | null = null;
  private running = false;
  private tabs = new Map<string, BrowserTab>();
  private navigations: BrowserNavigation[] = [];
  private searchQueries: string[] = [];
  private flushTimer: Timer | null = null;
  private flushIntervalMs: number;

  constructor(options: { flushIntervalMs?: number } = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? 30_000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    this.running = true;
    console.log(`[browser-activity] Started (flush every ${this.flushIntervalMs / 1000}s)`);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
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

  recordTab(tab: BrowserTab): void {
    this.tabs.set(tab.tabId, tab);
  }

  removeTab(tabId: string): void {
    this.tabs.delete(tabId);
  }

  recordNavigation(nav: BrowserNavigation): void {
    this.navigations.push(nav);
    const query = extractSearchQuery(nav.toUrl);
    if (query) this.searchQueries.push(query);
    if (this.navigations.length > 200) this.navigations.shift();
    if (this.searchQueries.length > 50) this.searchQueries.shift();
  }

  getSnapshot(): BrowserActivitySnapshot {
    const domains: Record<string, number> = {};
    for (const nav of this.navigations) {
      const host = safeHost(nav.toUrl);
      if (host) domains[host] = (domains[host] ?? 0) + 1;
    }
    return {
      activeTabs: Array.from(this.tabs.values()).filter(t => t.active),
      navigationCount: this.navigations.length,
      domains,
      searchQueries: [...this.searchQueries],
    };
  }

  private flush(): void {
    if (this.navigations.length === 0 && this.tabs.size === 0) return;
    const event: ObserverEvent = {
      type: 'browser_activity',
      data: this.getSnapshot() as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    };
    this.handler?.(event);
    this.navigations = [];
    this.searchQueries = [];
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function extractSearchQuery(url: string): string | null {
  try {
    const u = new URL(url);
    const q = u.searchParams.get('q') ?? u.searchParams.get('query') ?? u.searchParams.get('search');
    return q?.trim() || null;
  } catch {
    return null;
  }
}

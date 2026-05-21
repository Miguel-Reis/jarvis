/**
 * NetworkMonitor — Network Connectivity Observer
 *
 * Monitors network connectivity, latency, and DNS resolution.
 * Emits events on connection changes, high latency, or failures.
 */

import type { Observer, ObserverEventHandler } from './index';

const POLL_INTERVAL_MS = 30_000;      // 30 seconds
const LATENCY_THRESHOLD_MS = 500;     // High latency threshold
const DNS_HOSTS = [
  '8.8.8.8',      // Google DNS
  '1.1.1.1',      // Cloudflare DNS
  'api.github.com',  // External service
];

type NetworkStatus = 'online' | 'offline' | 'degraded';

export class NetworkMonitor implements Observer {
  name = 'network-monitor';
  private running = false;
  private handler: ObserverEventHandler | null = null;
  private pollTimer: Timer | null = null;
  private currentStatus: NetworkStatus = 'online';
  private latencyHistory: number[] = [];
  private readonly maxHistorySize = 10;

  async start(): Promise<void> {
    this.running = true;
    console.log('[network-monitor] Observer started — polling every 30s');

    // Initial check
    this.poll();

    // Set up recurring poll
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    console.log('[network-monitor] Observer stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(handler: ObserverEventHandler): void {
    this.handler = handler;
  }

  getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  getAverageLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencyHistory.length);
  }

  private async poll(): Promise<void> {
    if (!this.handler) return;

    try {
      const { status, latency, dnsHost, message } = await this.checkConnectivity();

      // Update status
      const oldStatus = this.currentStatus;
      this.currentStatus = status;

      // Track latency history
      if (latency) {
        this.latencyHistory.push(latency);
        if (this.latencyHistory.length > this.maxHistorySize) {
          this.latencyHistory.shift();
        }
      }

      // Emit event on status change or significant issues
      if (status !== oldStatus || status === 'degraded' || status === 'offline') {
        this.handler({
          type: 'network',
          data: {
            status,
            latencyMs: latency,
            dnsHost,
            message,
            averageLatency: this.getAverageLatency(),
          },
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.error('[network-monitor] Poll error:', err);
    }
  }

  private async checkConnectivity(): Promise<{
    status: NetworkStatus;
    latency?: number;
    dnsHost?: string;
    message?: string;
  }> {
    // Try to reach DNS hosts
    for (const host of DNS_HOSTS) {
      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        // Use fetch to test connectivity (HEAD request to minimize data)
        const url = host.includes('://') ? host : `http://${host}`;
        await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          mode: 'no-cors',
        });

        clearTimeout(timeoutId);
        const latency = Date.now() - start;

        // Check latency threshold
        if (latency > LATENCY_THRESHOLD_MS) {
          return {
            status: 'degraded',
            latency,
            dnsHost: host,
            message: `High latency detected: ${latency}ms`,
          };
        }

        // Connection OK
        return {
          status: 'online',
          latency,
          dnsHost: host,
        };
      } catch (err) {
        // Try next host
        continue;
      }
    }

    // All hosts failed
    return {
      status: 'offline',
      message: 'Unable to reach any DNS host',
    };
  }
}

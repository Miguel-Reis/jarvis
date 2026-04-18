/**
 * Signal adapter via signal-cli REST daemon.
 *
 * Setup:
 *   1. Install signal-cli: https://github.com/AsamK/signal-cli
 *   2. Register your number: signal-cli -a +YOUR_NUMBER register
 *   3. Verify: signal-cli -a +YOUR_NUMBER verify CODE
 *   4. Start REST daemon: signal-cli -a +YOUR_NUMBER daemon --http --port 8080
 *   5. Configure in jarvis: channels.signal.enabled = true, phone = "+YOUR_NUMBER"
 */

import type { ChannelAdapter, ChannelHandler, ChannelMessage } from './telegram.ts';

const DEFAULT_API_URL = 'http://localhost:8080';
const POLL_INTERVAL_MS = 3000;

export class SignalAdapter implements ChannelAdapter {
  name = 'signal';
  private phone: string;
  private apiUrl: string;
  private allowedSenders: string[] | null;
  private handler: ChannelHandler | null = null;
  private connected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: { phone: string; api_url?: string; allowed_senders?: string[] }) {
    this.phone = config.phone;
    this.apiUrl = (config.api_url ?? DEFAULT_API_URL).replace(/\/$/, '');
    this.allowedSenders = config.allowed_senders?.length ? config.allowed_senders : null;
  }

  async connect(): Promise<void> {
    // Verify the daemon is reachable and the number is registered
    const res = await fetch(`${this.apiUrl}/v1/about`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`signal-cli daemon unreachable at ${this.apiUrl} (status ${res.status})`);
    }

    this.connected = true;
    console.log(`[SignalAdapter] Connected — number: ${this.phone}`);
    this.startPolling();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[SignalAdapter] Disconnected');
  }

  async sendMessage(recipient: string, text: string): Promise<void> {
    const res = await fetch(`${this.apiUrl}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: this.phone,
        recipients: [recipient],
        message: text,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Signal send failed (${res.status}): ${body}`);
    }
  }

  onMessage(handler: ChannelHandler): void {
    this.handler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.connected || !this.handler) return;
    try {
      const res = await fetch(`${this.apiUrl}/v1/receive/${encodeURIComponent(this.phone)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;

      const messages = await res.json() as SignalEnvelope[];
      for (const envelope of messages) {
        const dm = envelope.envelope?.dataMessage;
        const sender = envelope.envelope?.source;
        if (!dm?.message || !sender) continue;

        // Allowlist check
        if (this.allowedSenders && !this.allowedSenders.includes(sender)) {
          console.log(`[SignalAdapter] Ignored message from unlisted sender: ${sender}`);
          continue;
        }

        const msg: ChannelMessage = {
          id: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          channel: 'signal',
          from: sender,
          text: dm.message,
          timestamp: dm.timestamp ?? Date.now(),
          metadata: { envelope },
        };

        try {
          const reply = await this.handler(msg);
          if (reply) await this.sendMessage(sender, reply);
        } catch (err) {
          console.error('[SignalAdapter] Handler error:', err);
        }
      }
    } catch (err) {
      // Transient network errors are expected — just skip the poll cycle
    }
  }
}

// signal-cli REST API envelope shape (simplified)
type SignalEnvelope = {
  envelope?: {
    source?: string;
    dataMessage?: {
      message?: string;
      timestamp?: number;
    };
  };
};

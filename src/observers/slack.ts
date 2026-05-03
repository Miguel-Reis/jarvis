/**
 * Slack Observer
 *
 * Monitors Slack channels for mentions, keywords, and messages.
 * Emits events when relevant activity is detected.
 */

import type { Observer, ObserverEventHandler } from './index';
import { SlackClient, type SlackConfig, type SlackMessage } from '../integrations/slack-api';

const POLL_INTERVAL_MS = 30_000;  // 30 seconds

type SlackMonitorConfig = SlackConfig & {
  channels?: string[];           // Channel IDs or names to monitor
  keywords?: string[];           // Keywords to trigger events
  mentionBot?: boolean;          // Trigger on bot mentions
  monitoredUsers?: string[];     // Specific users to monitor
};

export class SlackObserver implements Observer {
  name = 'slack';
  private running = false;
  private handler: ObserverEventHandler | null = null;
  private pollTimer: Timer | null = null;
  private client: SlackClient;
  private config: SlackMonitorConfig;
  private lastTs: Map<string, string> = new Map();  // Track last message ts per channel

  constructor(config: SlackMonitorConfig) {
    this.config = config;
    this.client = new SlackClient(config);
  }

  async start(): Promise<void> {
    this.running = true;

    // Test connection first
    try {
      const result = await this.client.test();
      console.log(`[slack] Connected as ${result.user} in ${result.team}`);
    } catch (err) {
      console.error('[slack] Connection failed:', err);
      this.running = false;
      return;
    }

    console.log(`[slack] Observer started — monitoring ${this.config.channels?.length || 'all'} channels`);

    // Initial poll
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

    console.log('[slack] Observer stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(handler: ObserverEventHandler): void {
    this.handler = handler;
  }

  private async poll(): Promise<void> {
    if (!this.handler || !this.running) return;

    try {
      let channels = this.config.channels;

      // If no channels specified, get all joined channels
      if (!channels || channels.length === 0) {
        const allChannels = await this.client.listChannels(true);
        channels = allChannels.filter(c => c.is_member).map(c => c.id);
      }

      // Poll each channel
      for (const channelId of channels) {
        await this.pollChannel(channelId);
      }
    } catch (err) {
      console.error('[slack] Poll error:', err);
    }
  }

  private async pollChannel(channelId: string): Promise<void> {
    if (!this.handler) return;

    try {
      const lastTs = this.lastTs.get(channelId);
      const messages = await this.client.getChannelHistory(channelId, {
        limit: 50,
        oldest: lastTs,
      });

      if (messages.length === 0) return;

      // Process new messages (reverse to get chronological order)
      const newMessages = messages.reverse();

      for (const msg of newMessages) {
        // Skip our own messages
        if (msg.subtype === 'bot_message') continue;

        // Check if this message should trigger an event
        const shouldTrigger = this.shouldTriggerEvent(msg);

        if (shouldTrigger) {
          this.handler({
            type: 'slack',
            data: {
              channel: channelId,
              message: msg.text,
              user: msg.user,
              ts: msg.ts,
              threadTs: msg.thread_ts,
              hasThread: !!msg.thread_ts,
              keywords: this.matchKeywords(msg.text),
              isMention: this.isBotMention(msg.text),
            },
            timestamp: Date.now(),
          });
        }

        // Update last ts
        this.lastTs.set(channelId, msg.ts);
      }
    } catch (err) {
      console.error(`[slack] Error polling channel ${channelId}:`, err);
    }
  }

  private shouldTriggerEvent(msg: SlackMessage): boolean {
    // Always trigger on mentions
    if (this.config.mentionBot && this.isBotMention(msg.text)) {
      return true;
    }

    // Trigger on monitored users
    if (this.config.monitoredUsers?.includes(msg.user)) {
      return true;
    }

    // Trigger on keywords
    if (this.config.keywords?.length && this.matchKeywords(msg.text).length > 0) {
      return true;
    }

    return false;
  }

  private isBotMention(text: string): boolean {
    // Slack bot mention format: <@BOT_USER_ID>
    return /<@[A-Z0-9]+>/.test(text);
  }

  private matchKeywords(text: string): string[] {
    if (!this.config.keywords) return [];

    const lowerText = text.toLowerCase();
    return this.config.keywords.filter(kw =>
      lowerText.includes(kw.toLowerCase())
    );
  }
}

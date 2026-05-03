/**
 * Slack API Client
 *
 * Wrapper for Slack Web API.
 * Docs: https://api.slack.com/web
 */

const SLACK_API_BASE = 'https://slack.com/api';

export type SlackConfig = {
  botToken: string;
  signingSecret?: string;
};

export type SlackChannel = {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_im: boolean;
  created: number;
  creator: string;
  is_archived: boolean;
  is_general: boolean;
  name_normalized: string;
  is_shared: boolean;
  is_member: boolean;
  topic?: { value: string; creator: string; last_set: number };
  purpose?: { value: string; creator: string; last_set: number };
};

export type SlackMessage = {
  type: 'message' | 'event_callback' | 'url_verification';
  subtype?: string;
  text: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  blocks?: Array<{ type: string; text?: { type: string; text: string } }>;
};

export type SlackUser = {
  id: string;
  name: string;
  real_name: string;
  profile: {
    avatar_hash?: string;
    status_text?: string;
    status_emoji?: string;
    image_24?: string;
    image_32?: string;
    image_48?: string;
    image_72?: string;
  };
  is_bot: boolean;
  is_admin: boolean;
  is_owner: boolean;
  is_primary_owner: boolean;
  is_restricted: boolean;
  is_ultra_restricted: boolean;
  deleted: boolean;
};

export class SlackClient {
  private botToken: string;

  constructor(config: SlackConfig) {
    this.botToken = config.botToken;
  }

  private async request<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = `${SLACK_API_BASE}/${endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    const data = await response.json() as T & { ok: boolean; error?: string };

    if (!('ok' in data) || !(data as any).ok) {
      throw new Error(`Slack API error: ${(data as any).error || 'Unknown error'}`);
    }

    return data;
  }

  /**
   * Test authentication
   */
  async test(): Promise<{ ok: boolean; user: string; team: string }> {
    return this.request('auth.test');
  }

  /**
   * List channels
   */
  async listChannels(excludeArchived = true, types = 'public_channel,private_channel'): Promise<SlackChannel[]> {
    const data = await this.request<{ channels: SlackChannel[] }>('conversations.list', {
      exclude_archived: excludeArchived,
      types,
      limit: 100,
    });
    return data.channels;
  }

  /**
   * Get channel info
   */
  async getChannelInfo(channelId: string): Promise<SlackChannel> {
    const data = await this.request<{ channel: SlackChannel }>('conversations.info', {
      channel: channelId,
    });
    return data.channel;
  }

  /**
   * Join a channel
   */
  async joinChannel(channelId: string): Promise<SlackChannel> {
    const data = await this.request<{ channel: SlackChannel }>('conversations.join', {
      channel: channelId,
    });
    return data.channel;
  }

  /**
   * Send a message to a channel
   */
  async sendMessage(channel: string, text: string, options?: {
    threadTs?: string;
    blocks?: Array<{ type: string; text?: { type: string; text: string } }>;
    attachments?: Array<{ color?: string; text: string; fields?: Array<{ title: string; value: string }> }>;
  }): Promise<{ ts: string; channel: string }> {
    const params: Record<string, unknown> = {
      channel,
      text,
    };

    if (options?.threadTs) {
      params.thread_ts = options.threadTs;
    }

    if (options?.blocks) {
      params.blocks = options.blocks;
    }

    if (options?.attachments) {
      params.attachments = options.attachments;
    }

    const data = await this.request<{ ts: string; channel: string }>('chat.postMessage', params);
    return data;
  }

  /**
   * Send a message to a user via DM
   */
  async sendDM(userId: string, text: string): Promise<{ ts: string; channel: string }> {
    // Open or resume DM
    const imData = await this.request<{ channel: { id: string } }>('conversations.open', {
      users: [userId],
    });

    return this.sendMessage(imData.channel.id, text);
  }

  /**
   * Get channel history
   */
  async getChannelHistory(channel: string, options?: {
    limit?: number;
    oldest?: string;
    latest?: string;
  }): Promise<SlackMessage[]> {
    const data = await this.request<{ messages: SlackMessage[] }>('conversations.history', {
      channel,
      limit: options?.limit || 50,
      oldest: options?.oldest,
      latest: options?.latest,
    });
    return data.messages;
  }

  /**
   * Get user info
   */
  async getUserInfo(userId: string): Promise<SlackUser> {
    const data = await this.request<{ user: SlackUser }>('users.info', {
      user: userId,
    });
    return data.user;
  }

  /**
   * List users
   */
  async listUsers(): Promise<SlackUser[]> {
    const data = await this.request<{ members: SlackUser[] }>('users.list');
    return data.members;
  }

  /**
   * Add reaction to a message
   */
  async addReaction(channel: string, ts: string, name: string): Promise<void> {
    await this.request('reactions.add', {
      channel,
      timestamp: ts,
      name,
    });
  }

  /**
   * Remove reaction from a message
   */
  async removeReaction(channel: string, ts: string, name: string): Promise<void> {
    await this.request('reactions.remove', {
      channel,
      timestamp: ts,
      name,
    });
  }
}

/**
 * Create Slack client from config
 */
export function createSlackClient(config: SlackConfig): SlackClient {
  return new SlackClient(config);
}

/**
 * Test Slack connection
 */
export async function testSlackConnection(botToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const client = new SlackClient({ botToken });
    const result = await client.test();
    return { success: true, user: result.user, team: result.team };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

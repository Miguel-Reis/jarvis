/**
 * WhatsApp Cloud API Adapter
 *
 * Implements two-way messaging via Meta's WhatsApp Business Cloud API.
 *
 * Setup:
 *   1. Create a Meta App at https://developers.facebook.com
 *   2. Add "WhatsApp" product, get a phone_number_id and access_token
 *   3. Register this server's /webhooks/whatsapp as the webhook URL
 *   4. Set a webhook_verify_token (any secret string you choose)
 *   5. Subscribe to the "messages" webhook field
 *
 * Config (config.yaml):
 *   channels:
 *     whatsapp:
 *       enabled: true
 *       phone_number_id: "12345678901234"   # from Meta dashboard
 *       access_token: "EAAxxxxxxxx"          # System user access token
 *       webhook_verify_token: "my-secret"    # Must match what you set in Meta dashboard
 *       allowed_users: ["+351912345678"]     # Optional phone number allowlist
 */

import type { ChannelAdapter, ChannelHandler, ChannelMessage } from './telegram.ts';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Module-level singleton so api-routes.ts can route webhook requests
let _activeAdapter: WhatsAppAdapter | null = null;

export function getWhatsAppAdapter(): WhatsAppAdapter | null {
  return _activeAdapter;
}

type WhatsAppConfig = {
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
  allowedUsers?: string[];
};

type WATextMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'interactive';
  text?: { body: string };
};

type WAContact = {
  profile: { name: string };
  wa_id: string;
};

type WAWebhookEntry = {
  changes: Array<{
    value: {
      messages?: WATextMessage[];
      contacts?: WAContact[];
      statuses?: Array<{ id: string; status: string }>;
    };
    field: string;
  }>;
};

type WAWebhookPayload = {
  object: string;
  entry: WAWebhookEntry[];
};

export class WhatsAppAdapter implements ChannelAdapter {
  name = 'whatsapp';
  private config: WhatsAppConfig;
  private handler: ChannelHandler | null = null;
  private connected = false;

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // Register as the active adapter so HTTP routes can reach us
    _activeAdapter = this;
    this.connected = true;
    console.log(`[WhatsApp] Connected — phone_number_id: ${this.config.phoneNumberId}`);
    console.log(`[WhatsApp] Webhook endpoint: POST /webhooks/whatsapp`);
  }

  async disconnect(): Promise<void> {
    if (_activeAdapter === this) _activeAdapter = null;
    this.connected = false;
    console.log('[WhatsApp] Disconnected');
  }

  onMessage(handler: ChannelHandler): void {
    this.handler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send a text message to a WhatsApp phone number.
   * @param to - Phone number in E.164 format (e.g. "15551234567" without +)
   */
  async sendMessage(to: string, text: string): Promise<void> {
    // Normalise: remove leading + if present
    const phone = to.startsWith('+') ? to.slice(1) : to;

    const url = `${GRAPH_API_BASE}/${this.config.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WhatsApp send failed (${response.status}): ${body.slice(0, 200)}`);
    }
  }

  /**
   * Handle Meta's webhook verification challenge.
   * Called on GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
   */
  handleVerify(req: Request): Response {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === this.config.webhookVerifyToken) {
      console.log('[WhatsApp] Webhook verified');
      return new Response(challenge ?? '', { status: 200 });
    }

    console.warn('[WhatsApp] Webhook verification failed — token mismatch');
    return new Response('Forbidden', { status: 403 });
  }

  /**
   * Handle incoming WhatsApp messages (POST /webhooks/whatsapp).
   * Parses the Meta webhook payload and routes text messages to the handler.
   */
  async handleIncoming(req: Request): Promise<Response> {
    let payload: WAWebhookPayload;
    try {
      payload = await req.json() as WAWebhookPayload;
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // WhatsApp always sends object: "whatsapp_business_account"
    if (payload.object !== 'whatsapp_business_account') {
      return new Response('OK', { status: 200 });
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const messages = change.value.messages ?? [];
        const contacts = change.value.contacts ?? [];

        for (const msg of messages) {
          if (msg.type !== 'text' || !msg.text?.body) continue;

          const text = msg.text.body.trim();
          if (!text) continue;

          // Resolve display name from contacts array
          const contact = contacts.find((c) => c.wa_id === msg.from);
          const displayName = contact?.profile.name ?? msg.from;

          // Allowlist check
          if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
            const normalized = msg.from.startsWith('+') ? msg.from.slice(1) : msg.from;
            const isAllowed = this.config.allowedUsers.some((u) => {
              const nu = u.startsWith('+') ? u.slice(1) : u;
              return nu === normalized;
            });
            if (!isAllowed) {
              console.warn(`[WhatsApp] Blocked message from unlisted number: ${msg.from}`);
              continue;
            }
          }

          if (!this.handler) {
            console.warn('[WhatsApp] No message handler set — dropping message');
            continue;
          }

          const channelMsg: ChannelMessage = {
            id: msg.id,
            channel: 'whatsapp',
            from: msg.from,
            text,
            timestamp: Number(msg.timestamp) * 1000,
            metadata: { displayName, wa_id: msg.from },
          };

          try {
            const response = await this.handler(channelMsg);
            if (response) {
              await this.sendMessage(msg.from, response);
            }
          } catch (err) {
            console.error(`[WhatsApp] Handler error for message ${msg.id}:`, err);
          }
        }
      }
    }

    // Meta expects a 200 OK quickly, even if processing is async
    return new Response('OK', { status: 200 });
  }
}

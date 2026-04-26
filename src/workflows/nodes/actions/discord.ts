import type { NodeDefinition } from '../registry.ts';

export const discordAction: NodeDefinition = {
  type: 'action.discord',
  label: 'Send Discord Message',
  description: 'Send a message to a Discord channel via a webhook or bot token.',
  category: 'action',
  icon: '🎮',
  color: '#3b82f6',
  configSchema: {
    channel_id: {
      type: 'string',
      label: 'Channel ID or Webhook URL',
      description: 'Discord channel ID (requires bot token) or full webhook URL.',
      required: true,
      placeholder: '1234567890123456789',
    },
    message: {
      type: 'template',
      label: 'Message',
      description: 'Message content. Supports template expressions and Discord markdown.',
      required: true,
      placeholder: '**Alert**: {{data.message}}',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const channelId = String(config.channel_id ?? '');
    const message = String(config.message ?? '');

    ctx.logger.info(`Sending Discord message to channel ${channelId}`);

    let success = false;
    let note = '';

    // If channelId looks like a webhook URL, use it directly
    if (channelId.startsWith('https://discord.com/api/webhooks/') || channelId.startsWith('https://discordapp.com/api/webhooks/')) {
      try {
        const resp = await fetch(channelId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message }),
          signal: ctx.abortSignal,
        });
        success = resp.ok;
        if (!resp.ok) {
          note = `Discord webhook returned ${resp.status}`;
          ctx.logger.warn(note);
        }
      } catch (err) {
        throw new Error(`Discord webhook send failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (ctx.toolRegistry.has('send_discord')) {
      try {
        await ctx.toolRegistry.execute('send_discord', { channel_id: channelId, content: message });
        success = true;
      } catch (err) {
        throw new Error(`Discord send failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      note = 'Discord integration not configured — message not sent';
      ctx.logger.warn(note);
    }

    return {
      data: {
        ...input.data,
        discord_sent: success,
        channel_id: channelId,
        message,
        note: note || undefined,
        sentAt: Date.now(),
      },
    };
  },
};

import type { NodeDefinition } from '../registry.ts';

export const telegramAction: NodeDefinition = {
  type: 'action.telegram',
  label: 'Send Telegram Message',
  description: 'Send a message to a Telegram chat via the Bot API.',
  category: 'action',
  icon: '✈️',
  color: '#3b82f6',
  configSchema: {
    chat_id: {
      type: 'string',
      label: 'Chat ID',
      description: 'Telegram chat ID or username to send the message to.',
      required: true,
      placeholder: '-1001234567890',
    },
    message: {
      type: 'template',
      label: 'Message',
      description: 'Message text. Supports template expressions and Markdown.',
      required: true,
      placeholder: 'Alert: {{data.message}}',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const chatId = String(config.chat_id ?? '');
    const message = String(config.message ?? '');

    ctx.logger.info(`Sending Telegram message to ${chatId}`);

    // Delegate to telegram tool if registered
    let success = false;
    let note = '';
    if (ctx.toolRegistry.has('send_telegram')) {
      try {
        await ctx.toolRegistry.execute('send_telegram', { chat_id: chatId, text: message });
        success = true;
      } catch (err) {
        throw new Error(`Telegram send failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      note = 'Telegram tool not registered — message not sent';
      ctx.logger.warn(note);
    }

    return {
      data: {
        ...input.data,
        telegram_sent: success,
        chat_id: chatId,
        message,
        note: note || undefined,
        sentAt: Date.now(),
      },
    };
  },
};

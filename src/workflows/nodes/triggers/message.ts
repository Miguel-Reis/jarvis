import type { NodeDefinition } from '../registry.ts';

export const messageTrigger: NodeDefinition = {
  type: 'trigger.message',
  label: 'Message Trigger',
  description: 'Fire this workflow when a user message matches a keyword or regex pattern.',
  category: 'trigger',
  icon: '💬',
  color: '#10b981',
  configSchema: {
    pattern: {
      type: 'string',
      label: 'Pattern',
      description: 'Keyword or regex to match against incoming messages (case-insensitive by default).',
      required: true,
      placeholder: 'report|summary|daily update',
    },
    use_regex: {
      type: 'boolean',
      label: 'Use Regex',
      description: 'Treat pattern as a regular expression. If off, it is treated as a plain text keyword.',
      required: false,
    },
    channel: {
      type: 'string',
      label: 'Channel Filter',
      description: 'Only match messages from this channel (e.g. "telegram", "discord", "websocket"). Leave blank to match all channels.',
      required: false,
      placeholder: 'telegram',
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info(`Message trigger fired — pattern: ${config.pattern}`);
    return {
      data: {
        triggerType: 'message',
        pattern: config.pattern,
        channel: input.data.channel ?? config.channel,
        message: input.data.text ?? input.data.message,
        receivedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

import type { NodeDefinition } from '../registry.ts';

export const clipboardTrigger: NodeDefinition = {
  type: 'trigger.clipboard',
  label: 'Clipboard Trigger',
  description: 'Fire when clipboard content changes, optionally filtering by regex pattern.',
  category: 'trigger',
  icon: '📋',
  color: '#8b5cf6',
  configSchema: {
    pattern: {
      type: 'string',
      label: 'Pattern Filter',
      description: 'Optional regex pattern. Only fire if clipboard text matches.',
      required: false,
      placeholder: 'https?://',
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info('Clipboard trigger fired');
    return {
      data: {
        triggerType: 'clipboard',
        pattern: config.pattern ?? null,
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

import type { NodeDefinition } from '../registry.ts';

export const manualTrigger: NodeDefinition = {
  type: 'trigger.manual',
  label: 'Manual Trigger',
  description: 'Trigger the workflow manually via the dashboard or API.',
  category: 'trigger',
  icon: '▶️',
  color: '#8b5cf6',
  configSchema: {},
  inputs: [],
  outputs: ['default'],
  execute: async (input, _config, ctx) => {
    ctx.logger.info('Manual trigger fired');
    return {
      data: {
        triggerType: 'manual',
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

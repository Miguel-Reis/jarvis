import type { NodeDefinition } from '../registry.ts';

export const cronTrigger: NodeDefinition = {
  type: 'trigger.cron',
  label: 'Cron Trigger',
  description: 'Fire a workflow on a cron schedule.',
  category: 'trigger',
  icon: '⏰',
  color: '#8b5cf6',
  configSchema: {
    expression: {
      type: 'string',
      label: 'Cron Expression',
      description: 'Standard cron expression, e.g. "0 9 * * 1-5"',
      required: true,
      placeholder: '0 9 * * *',
    },
    timezone: {
      type: 'string',
      label: 'Timezone',
      description: 'IANA timezone name, e.g. "America/New_York". Defaults to UTC.',
      required: false,
      placeholder: 'UTC',
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info(`Cron trigger fired — expression: ${config.expression}`);
    return {
      data: {
        triggerType: 'cron',
        expression: config.expression,
        timezone: config.timezone ?? 'UTC',
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

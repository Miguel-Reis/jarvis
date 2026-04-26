import type { NodeDefinition } from '../registry.ts';

export const processTrigger: NodeDefinition = {
  type: 'trigger.process',
  label: 'Process Trigger',
  description: 'Fire when a system process starts or stops.',
  category: 'trigger',
  icon: '⚙️',
  color: '#8b5cf6',
  configSchema: {
    process_name: {
      type: 'string',
      label: 'Process Name',
      description: 'Name or partial name of the process to watch.',
      required: true,
      placeholder: 'chrome',
    },
    event: {
      type: 'select',
      label: 'Event',
      description: 'Whether to fire when the process starts or stops.',
      required: true,
      default: 'started',
      options: [
        { label: 'Started', value: 'started' },
        { label: 'Stopped', value: 'stopped' },
      ],
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info(`Process trigger fired — process: ${config.process_name}, event: ${config.event}`);
    return {
      data: {
        triggerType: 'process',
        process_name: config.process_name,
        event: config.event,
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

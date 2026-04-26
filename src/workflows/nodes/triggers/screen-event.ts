import type { NodeDefinition } from '../registry.ts';

export const screenEventTrigger: NodeDefinition = {
  type: 'trigger.screen_event',
  label: 'Screen Event Trigger',
  description: 'Fire when the Continuous Awareness Engine detects a screen event.',
  category: 'trigger',
  icon: '🖥️',
  color: '#8b5cf6',
  configSchema: {
    event_type: {
      type: 'select',
      label: 'Event Type',
      description: 'The type of screen event to listen for.',
      required: true,
      default: 'error_detected',
      options: [
        { label: 'Error Detected', value: 'error_detected' },
        { label: 'Struggle Detected', value: 'struggle_detected' },
        { label: 'Context Changed', value: 'context_changed' },
      ],
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info(`Screen event trigger fired — type: ${config.event_type}`);
    return {
      data: {
        triggerType: 'screen_event',
        event_type: config.event_type,
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

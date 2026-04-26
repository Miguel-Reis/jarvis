import type { NodeDefinition } from '../registry.ts';

export const fileChangeTrigger: NodeDefinition = {
  type: 'trigger.file_change',
  label: 'File Change Trigger',
  description: 'Fire when a file or directory changes on disk.',
  category: 'trigger',
  icon: '📁',
  color: '#8b5cf6',
  configSchema: {
    watch_path: {
      type: 'string',
      label: 'Watch Path',
      description: 'Absolute or relative path to watch. Supports glob patterns.',
      required: true,
      placeholder: '/home/user/documents/**',
    },
    events: {
      type: 'select',
      label: 'Events',
      description: 'Which file system events to listen for.',
      required: true,
      default: 'modified',
      options: [
        { label: 'Created', value: 'created' },
        { label: 'Modified', value: 'modified' },
        { label: 'Deleted', value: 'deleted' },
      ],
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info(`File change trigger fired — path: ${config.watch_path}, event: ${config.events}`);
    return {
      data: {
        triggerType: 'file_change',
        watch_path: config.watch_path,
        event: config.events,
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

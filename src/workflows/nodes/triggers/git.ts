import type { NodeDefinition } from '../registry.ts';

export const gitTrigger: NodeDefinition = {
  type: 'trigger.git',
  label: 'Git Trigger',
  description: 'Fire when a git event occurs in a local repository.',
  category: 'trigger',
  icon: '🌿',
  color: '#8b5cf6',
  configSchema: {
    repo_path: {
      type: 'string',
      label: 'Repository Path',
      description: 'Absolute path to the local git repository.',
      required: true,
      placeholder: '/home/user/my-project',
    },
    events: {
      type: 'select',
      label: 'Git Event',
      description: 'Which git event to listen for.',
      required: true,
      default: 'commit',
      options: [
        { label: 'Push', value: 'push' },
        { label: 'Pull', value: 'pull' },
        { label: 'Commit', value: 'commit' },
        { label: 'Branch', value: 'branch' },
      ],
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info(`Git trigger fired — repo: ${config.repo_path}, event: ${config.events}`);
    return {
      data: {
        triggerType: 'git',
        repo_path: config.repo_path,
        event: config.events,
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

import type { NodeDefinition } from '../registry.ts';

export const goalUpdateTrigger: NodeDefinition = {
  type: 'trigger.goal_update',
  label: 'Goal Update Trigger',
  description: 'Fire this workflow when a goal changes status, score, or health.',
  category: 'trigger',
  icon: '🎯',
  color: '#f59e0b',
  configSchema: {
    goal_id: {
      type: 'string',
      label: 'Goal ID',
      description: 'Specific goal to watch. Leave blank to watch all goals.',
      required: false,
      placeholder: 'goal-uuid (optional)',
    },
    event_type: {
      type: 'string',
      label: 'Event Type',
      description: 'Which event fires this trigger.',
      required: false,
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, _config, ctx) => {
    ctx.logger.info(`Goal update trigger fired — event: ${input.data.event_type ?? 'unknown'}`);
    return {
      data: {
        triggerType: 'goal_update',
        goalId: input.data.goal_id,
        eventType: input.data.event_type,
        receivedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

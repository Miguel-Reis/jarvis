import type { NodeDefinition } from '../registry.ts';

export const calendarTrigger: NodeDefinition = {
  type: 'trigger.calendar',
  label: 'Calendar Trigger',
  description: 'Fire a set number of minutes before a calendar event starts.',
  category: 'trigger',
  icon: '📅',
  color: '#8b5cf6',
  configSchema: {
    minutes_before: {
      type: 'number',
      label: 'Minutes Before',
      description: 'How many minutes before the event to fire.',
      required: true,
      default: 15,
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const minutesBefore = typeof config.minutes_before === 'number' ? config.minutes_before : 15;
    ctx.logger.info(`Calendar trigger fired — ${minutesBefore} minutes before event`);
    return {
      data: {
        triggerType: 'calendar',
        minutes_before: minutesBefore,
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

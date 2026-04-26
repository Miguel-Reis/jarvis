import type { NodeDefinition } from '../registry.ts';

export const emailTrigger: NodeDefinition = {
  type: 'trigger.email',
  label: 'Email Trigger',
  description: 'Fire when a new email is received matching optional from/subject filters.',
  category: 'trigger',
  icon: '📧',
  color: '#8b5cf6',
  configSchema: {
    from_filter: {
      type: 'string',
      label: 'From Filter',
      description: 'Regex or plain-text pattern to match the sender address.',
      required: false,
      placeholder: 'alerts@example.com',
    },
    subject_filter: {
      type: 'string',
      label: 'Subject Filter',
      description: 'Regex or plain-text pattern to match the email subject.',
      required: false,
      placeholder: 'URGENT:',
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info('Email trigger fired');
    return {
      data: {
        triggerType: 'email',
        from_filter: config.from_filter ?? null,
        subject_filter: config.subject_filter ?? null,
        receivedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

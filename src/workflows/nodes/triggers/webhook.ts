import type { NodeDefinition } from '../registry.ts';

export const webhookTrigger: NodeDefinition = {
  type: 'trigger.webhook',
  label: 'Webhook Trigger',
  description: 'Receive an inbound HTTP request and fire the workflow.',
  category: 'trigger',
  icon: '🔗',
  color: '#8b5cf6',
  configSchema: {
    path: {
      type: 'string',
      label: 'Path',
      description: 'URL path this webhook listens on, e.g. "/webhooks/my-event"',
      required: true,
      placeholder: '/webhooks/my-event',
    },
    secret: {
      type: 'string',
      label: 'Secret',
      description: 'Optional HMAC-SHA256 secret used to verify incoming payloads.',
      required: false,
      placeholder: 'my-secret-token',
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info(`Webhook trigger fired — path: ${config.path}`);
    return {
      data: {
        triggerType: 'webhook',
        path: config.path,
        receivedAt: Date.now(),
        ...input.data,
      },
    };
  },
};

import type { NodeDefinition } from '../registry.ts';

export const errorHandlerNode: NodeDefinition = {
  type: 'error.error_handler',
  label: 'Error Handler',
  description: 'Catch errors from upstream nodes and continue with a custom message.',
  category: 'error',
  icon: '🛡️',
  color: '#ef4444',
  configSchema: {
    message: {
      type: 'template',
      label: 'Message',
      description: 'Custom error message to include in output. Supports template expressions.',
      required: false,
      placeholder: 'An error occurred: {{data.error}}',
    },
  },
  inputs: ['default', 'error'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const message = config.message ? String(config.message) : 'An error was handled by the error handler node.';
    ctx.logger.info(`Error handler triggered: ${message.slice(0, 120)}`);

    const errorData = input.data['_error'] ?? input.data['error'] ?? null;

    return {
      data: {
        ...input.data,
        error_handled: true,
        handler_message: message,
        original_error: errorData,
        handledAt: Date.now(),
      },
    };
  },
};

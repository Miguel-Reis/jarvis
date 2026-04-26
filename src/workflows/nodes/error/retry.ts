import type { NodeDefinition } from '../registry.ts';

export const retryNode: NodeDefinition = {
  type: 'error.retry',
  label: 'Retry',
  description: 'Automatically retry a failed upstream node with configurable backoff.',
  category: 'error',
  icon: '🔁',
  color: '#ef4444',
  configSchema: {
    max_retries: {
      type: 'number',
      label: 'Max Retries',
      description: 'Maximum number of retry attempts.',
      required: true,
      default: 3,
    },
    delay_ms: {
      type: 'number',
      label: 'Initial Delay (ms)',
      description: 'Delay before the first retry. Subsequent delays increase with backoff.',
      required: true,
      default: 1000,
    },
    backoff: {
      type: 'select',
      label: 'Backoff Strategy',
      description: 'How the delay grows between retry attempts.',
      required: true,
      default: 'exponential',
      options: [
        { label: 'Fixed', value: 'fixed' },
        { label: 'Exponential', value: 'exponential' },
      ],
    },
  },
  inputs: ['default'],
  outputs: ['default', 'failed'],
  execute: async (input, config, ctx) => {
    const maxRetries = typeof config.max_retries === 'number' ? config.max_retries : 3;
    const delayMs = typeof config.delay_ms === 'number' ? config.delay_ms : 1000;
    const backoff = String(config.backoff ?? 'exponential');

    // The retry logic is orchestrated by the workflow executor using the node's RetryPolicy.
    // This execute function is called on each attempt — it passes data through and records attempt info.
    const currentAttempt = typeof input.data['_retry_attempt'] === 'number'
      ? (input.data['_retry_attempt'] as number)
      : 0;

    ctx.logger.info(`Retry node: attempt ${currentAttempt + 1}/${maxRetries + 1}`);

    const hasError = Boolean(input.data['_error'] || input.data['error']);

    if (hasError && currentAttempt >= maxRetries) {
      ctx.logger.warn(`Retry exhausted after ${maxRetries} attempts`);
      return {
        data: {
          ...input.data,
          retry_exhausted: true,
          retry_attempts: currentAttempt,
          max_retries: maxRetries,
        },
        route: 'failed',
      };
    }

    const nextDelay = backoff === 'exponential'
      ? delayMs * Math.pow(2, currentAttempt)
      : delayMs;

    return {
      data: {
        ...input.data,
        _retry_attempt: currentAttempt + 1,
        retry_delay_ms: nextDelay,
        max_retries: maxRetries,
        backoff,
      },
      route: 'default',
    };
  },
};

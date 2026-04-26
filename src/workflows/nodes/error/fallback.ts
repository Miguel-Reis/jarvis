import type { NodeDefinition } from '../registry.ts';

export const fallbackNode: NodeDefinition = {
  type: 'error.fallback',
  label: 'Fallback',
  description: 'Provide a static fallback value when an upstream node fails.',
  category: 'error',
  icon: '🪂',
  color: '#ef4444',
  configSchema: {
    fallback_value: {
      type: 'json',
      label: 'Fallback Value',
      description: 'JSON value to merge into the data output when this node is reached via an error path.',
      required: true,
      default: { fallback: true },
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    ctx.logger.info('Fallback node triggered — injecting fallback value');

    let fallbackValue: unknown = config.fallback_value;
    if (typeof fallbackValue === 'string') {
      try {
        fallbackValue = JSON.parse(fallbackValue);
      } catch {
        // keep as string
      }
    }

    const fallbackData: Record<string, unknown> =
      fallbackValue !== null && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue)
        ? (fallbackValue as Record<string, unknown>)
        : { fallback_value: fallbackValue };

    return {
      data: {
        ...input.data,
        ...fallbackData,
        _fallback_used: true,
        fallbackAt: Date.now(),
      },
    };
  },
};

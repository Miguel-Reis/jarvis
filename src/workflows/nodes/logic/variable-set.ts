import type { NodeDefinition } from '../registry.ts';

export const variableSetNode: NodeDefinition = {
  type: 'logic.variable_set',
  label: 'Set Variable',
  description: 'Set a workflow variable (in-memory or persistent across executions).',
  category: 'logic',
  icon: '📝',
  color: '#f59e0b',
  configSchema: {
    key: {
      type: 'string',
      label: 'Key',
      description: 'Variable name to set.',
      required: true,
      placeholder: 'my_variable',
    },
    value: {
      type: 'template',
      label: 'Value',
      description: 'Value to assign. Supports template expressions.',
      required: true,
      placeholder: '{{data.result}}',
    },
    persistent: {
      type: 'boolean',
      label: 'Persistent',
      description: 'If true, the variable persists across workflow executions.',
      required: false,
      default: false,
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const key = String(config.key ?? '');
    if (!key) throw new Error('key is required');

    const value = config.value;
    const persistent = config.persistent === true;

    ctx.logger.info(`Setting variable "${key}" (persistent=${persistent})`);

    if (persistent) {
      ctx.variables.setPersistent(key, value);
    } else {
      ctx.variables.set(key, value);
    }

    return {
      data: {
        ...input.data,
        variable_key: key,
        variable_value: value,
        persistent,
      },
    };
  },
};

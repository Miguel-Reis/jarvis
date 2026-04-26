import type { NodeDefinition } from '../registry.ts';

export const variableGetNode: NodeDefinition = {
  type: 'logic.variable_get',
  label: 'Get Variable',
  description: 'Read a workflow variable and inject it into the data stream.',
  category: 'logic',
  icon: '📖',
  color: '#f59e0b',
  configSchema: {
    key: {
      type: 'string',
      label: 'Key',
      description: 'Variable name to read.',
      required: true,
      placeholder: 'my_variable',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const key = String(config.key ?? '');
    if (!key) throw new Error('key is required');

    const value = ctx.variables.get(key);
    ctx.logger.info(`Getting variable "${key}": ${JSON.stringify(value)?.slice(0, 80)}`);

    return {
      data: {
        ...input.data,
        [key]: value,
        variable_key: key,
        variable_value: value,
      },
    };
  },
};

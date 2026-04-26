import type { NodeDefinition } from '../registry.ts';

export const aggregateTransform: NodeDefinition = {
  type: 'transform.aggregate',
  label: 'Aggregate',
  description: 'Compute sum, average, count, min, or max over an array field.',
  category: 'transform',
  icon: '🔢',
  color: '#10b981',
  configSchema: {
    operation: {
      type: 'select',
      label: 'Operation',
      description: 'Aggregation operation to apply.',
      required: true,
      default: 'sum',
      options: [
        { label: 'Sum', value: 'sum' },
        { label: 'Average', value: 'avg' },
        { label: 'Count', value: 'count' },
        { label: 'Min', value: 'min' },
        { label: 'Max', value: 'max' },
      ],
    },
    field: {
      type: 'string',
      label: 'Field',
      description: 'Dot-path to the array field in data. For sum/avg/min/max, each element or sub-field is used as a number.',
      required: true,
      placeholder: 'items',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const operation = String(config.operation ?? 'sum');
    const field = String(config.field ?? '');

    if (!field) throw new Error('field is required');

    // Resolve dot-path to get the array
    const parts = field.split('.');
    let arr: unknown = input.data as unknown;
    for (const part of parts) {
      if (arr && typeof arr === 'object') arr = (arr as Record<string, unknown>)[part];
      else { arr = undefined; break; }
    }

    ctx.logger.info(`Aggregate: ${operation} on field "${field}"`);

    if (operation === 'count') {
      const count = Array.isArray(arr) ? arr.length : (arr !== undefined && arr !== null ? 1 : 0);
      return { data: { ...input.data, aggregate_result: count, aggregate_operation: 'count' } };
    }

    if (!Array.isArray(arr)) {
      throw new Error(`Field "${field}" must be an array for ${operation}`);
    }

    const numbers = arr.map(item => {
      if (typeof item === 'number') return item;
      if (typeof item === 'string') return parseFloat(item);
      if (item !== null && typeof item === 'object') {
        // If field path has sub-field like "items.value", the last segment after the array is handled here
        // For simple arrays of numbers this branch is fine
        const numVal = Object.values(item as Record<string, unknown>)[0];
        return typeof numVal === 'number' ? numVal : parseFloat(String(numVal));
      }
      return NaN;
    }).filter(n => !isNaN(n));

    let result: number;
    switch (operation) {
      case 'sum':
        result = numbers.reduce((a, b) => a + b, 0);
        break;
      case 'avg':
        result = numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
        break;
      case 'min':
        result = numbers.length > 0 ? Math.min(...numbers) : 0;
        break;
      case 'max':
        result = numbers.length > 0 ? Math.max(...numbers) : 0;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    return {
      data: {
        ...input.data,
        aggregate_result: result,
        aggregate_operation: operation,
        aggregate_count: numbers.length,
      },
    };
  },
};

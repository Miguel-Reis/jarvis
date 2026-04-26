import type { NodeDefinition } from '../registry.ts';
import { safeEvaluateExpression } from '../../safe-eval.ts';

export const mapFilterTransform: NodeDefinition = {
  type: 'transform.map_filter',
  label: 'Map / Filter',
  description: 'Map or filter an array using a JavaScript expression.',
  category: 'transform',
  icon: '🗂️',
  color: '#10b981',
  configSchema: {
    items_field: {
      type: 'string',
      label: 'Items Field',
      description: 'Dot-path to the array field in data to transform.',
      required: true,
      placeholder: 'items',
    },
    expression: {
      type: 'template',
      label: 'Expression',
      description: 'JavaScript expression applied to each element. `item` is the current element, `index` is its position. For map: return transformed value. For filter: return truthy/falsy.',
      required: true,
      placeholder: 'item.value > 10',
    },
    mode: {
      type: 'select',
      label: 'Mode',
      description: 'Whether to transform (map) or filter the array.',
      required: true,
      default: 'filter',
      options: [
        { label: 'Map', value: 'map' },
        { label: 'Filter', value: 'filter' },
      ],
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const itemsField = String(config.items_field ?? '');
    const expression = String(config.expression ?? '');
    const mode = String(config.mode ?? 'filter');

    if (!itemsField) throw new Error('items_field is required');
    if (!expression) throw new Error('expression is required');

    // Resolve dot-path
    const parts = itemsField.split('.');
    let arr: unknown = input.data as unknown;
    for (const part of parts) {
      if (arr && typeof arr === 'object') arr = (arr as Record<string, unknown>)[part];
      else { arr = undefined; break; }
    }

    if (!Array.isArray(arr)) {
      throw new Error(`Field "${itemsField}" must be an array, got ${typeof arr}`);
    }

    ctx.logger.info(`${mode} on field "${itemsField}" (${arr.length} items)`);

    let result: unknown[];
    if (mode === 'map') {
      result = arr.map((item, index) => {
        try { return safeEvaluateExpression(expression, { item, index, data: input.data }); }
        catch (e) { ctx.logger.warn(`map expression error at index ${index}: ${e}`); return item; }
      });
    } else {
      result = arr.filter((item, index) => {
        try { return !!safeEvaluateExpression(expression, { item, index, data: input.data }); }
        catch (e) { ctx.logger.warn(`filter expression error at index ${index}: ${e}`); return false; }
      });
    }

    return {
      data: {
        ...input.data,
        [itemsField.split('.').pop() ?? 'result']: result,
        transform_count: result.length,
        transform_mode: mode,
      },
    };
  },
};

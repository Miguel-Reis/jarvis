import type { NodeDefinition } from '../registry.ts';

export const jsonParseTransform: NodeDefinition = {
  type: 'transform.json_parse',
  label: 'JSON Parse',
  description: 'Parse a JSON string field and store the result under a new key.',
  category: 'transform',
  icon: '{ }',
  color: '#10b981',
  configSchema: {
    input_field: {
      type: 'string',
      label: 'Input Field',
      description: 'Dot-path to the field in data containing the JSON string.',
      required: true,
      placeholder: 'body',
    },
    output_field: {
      type: 'string',
      label: 'Output Field',
      description: 'Key to store the parsed result under in the output data.',
      required: true,
      placeholder: 'parsed',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const inputField = String(config.input_field ?? '');
    const outputField = String(config.output_field ?? 'parsed');

    if (!inputField) throw new Error('input_field is required');

    // Resolve dot-path
    const raw = inputField.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, input.data as unknown);

    ctx.logger.info(`JSON parse: field "${inputField}" → "${outputField}"`);

    let parsed: unknown;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Failed to parse JSON in field "${inputField}": ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (raw !== undefined && raw !== null) {
      // Already an object — pass through
      parsed = raw;
    } else {
      throw new Error(`Field "${inputField}" is undefined or null`);
    }

    return {
      data: {
        ...input.data,
        [outputField]: parsed,
      },
    };
  },
};

import type { NodeDefinition } from '../registry.ts';

export const csvParseTransform: NodeDefinition = {
  type: 'transform.csv_parse',
  label: 'CSV Parse',
  description: 'Parse a CSV string into an array of row objects.',
  category: 'transform',
  icon: '📊',
  color: '#10b981',
  configSchema: {
    input_field: {
      type: 'string',
      label: 'Input Field',
      description: 'Dot-path to the field in data containing the CSV string.',
      required: true,
      placeholder: 'csv_content',
    },
    delimiter: {
      type: 'string',
      label: 'Delimiter',
      description: 'Column delimiter character.',
      required: false,
      default: ',',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const inputField = String(config.input_field ?? '');
    const delimiter = String(config.delimiter ?? ',');

    if (!inputField) throw new Error('input_field is required');

    // Resolve dot-path
    const raw = inputField.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, input.data as unknown);

    if (typeof raw !== 'string') {
      throw new Error(`Field "${inputField}" must be a string, got ${typeof raw}`);
    }

    ctx.logger.info(`CSV parse: field "${inputField}", delimiter "${delimiter}"`);

    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      return { data: { ...input.data, csv_rows: [], csv_headers: [] } };
    }

    const headers = lines[0]!.split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i]!.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
      rows.push(row);
    }

    return {
      data: {
        ...input.data,
        csv_rows: rows,
        csv_headers: headers,
        csv_count: rows.length,
      },
    };
  },
};

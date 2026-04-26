import type { NodeDefinition } from '../registry.ts';

export const regexMatchTransform: NodeDefinition = {
  type: 'transform.regex_match',
  label: 'Regex Match',
  description: 'Apply a regular expression to a string field and capture matches.',
  category: 'transform',
  icon: '🔍',
  color: '#10b981',
  configSchema: {
    input_field: {
      type: 'string',
      label: 'Input Field',
      description: 'Dot-path to the field in data to run the regex against.',
      required: true,
      placeholder: 'body',
    },
    pattern: {
      type: 'string',
      label: 'Pattern',
      description: 'Regular expression pattern (without slashes).',
      required: true,
      placeholder: '\\d+',
    },
    flags: {
      type: 'string',
      label: 'Flags',
      description: 'Regex flags (e.g., "gi", "m"). Defaults to "g".',
      required: false,
      default: 'g',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const inputField = String(config.input_field ?? '');
    const pattern = String(config.pattern ?? '');
    const flags = String(config.flags ?? 'g');

    if (!inputField) throw new Error('input_field is required');
    if (!pattern) throw new Error('pattern is required');

    // Resolve dot-path
    const raw = inputField.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, input.data as unknown);

    if (typeof raw !== 'string') {
      throw new Error(`Field "${inputField}" must be a string, got ${typeof raw}`);
    }

    ctx.logger.info(`Regex match: /${pattern}/${flags} on field "${inputField}"`);

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (err) {
      throw new Error(`Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`);
    }

    const matches: string[] = [];
    const groups: Array<Record<string, string | undefined>> = [];

    if (flags.includes('g')) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(raw)) !== null) {
        matches.push(match[0]);
        if (match.groups) groups.push(match.groups);
      }
    } else {
      const match = regex.exec(raw);
      if (match) {
        matches.push(match[0]);
        if (match.groups) groups.push(match.groups);
      }
    }

    return {
      data: {
        ...input.data,
        regex_matches: matches,
        regex_groups: groups,
        regex_count: matches.length,
        regex_matched: matches.length > 0,
      },
    };
  },
};

import type { NodeDefinition } from '../registry.ts';

export const runToolAction: NodeDefinition = {
  type: 'action.run_tool',
  label: 'Run Tool',
  description: 'Execute any registered JARVIS tool by name.',
  category: 'action',
  icon: '🔧',
  color: '#3b82f6',
  configSchema: {
    tool_name: {
      type: 'string',
      label: 'Tool Name',
      description: 'Name of the registered tool to execute.',
      required: true,
      placeholder: 'web_search',
    },
    arguments: {
      type: 'json',
      label: 'Arguments',
      description: 'JSON object of arguments to pass to the tool.',
      required: false,
      default: {},
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const toolName = String(config.tool_name ?? '');
    if (!toolName) throw new Error('tool_name is required');

    // Resolve arguments — they may contain template values already resolved upstream
    let resolvedArgs: Record<string, unknown> = {};
    if (config.arguments && typeof config.arguments === 'object' && !Array.isArray(config.arguments)) {
      resolvedArgs = config.arguments as Record<string, unknown>;
    } else if (typeof config.arguments === 'string') {
      try {
        resolvedArgs = JSON.parse(config.arguments);
      } catch {
        throw new Error(`arguments must be a valid JSON object, got: ${config.arguments}`);
      }
    }

    ctx.logger.info(`Running tool: ${toolName}`);
    const result = await ctx.toolRegistry.execute(toolName, resolvedArgs);

    return {
      data: {
        ...input.data,
        tool_name: toolName,
        tool_result: result,
      },
    };
  },
};

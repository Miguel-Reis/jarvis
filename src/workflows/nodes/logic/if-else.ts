import type { NodeDefinition } from '../registry.ts';
import { safeEvaluateExpression } from '../../safe-eval.ts';

export const ifElseNode: NodeDefinition = {
  type: 'logic.if_else',
  label: 'If / Else',
  description: 'Branch the workflow based on a JavaScript boolean expression.',
  category: 'logic',
  icon: '🔀',
  color: '#f59e0b',
  configSchema: {
    condition: {
      type: 'template',
      label: 'Condition',
      description: 'A JavaScript expression that evaluates to true or false. Has access to `data` (input data object).',
      required: true,
      placeholder: 'data.status === "ok" && data.count > 0',
    },
  },
  inputs: ['default'],
  outputs: ['true', 'false'],
  execute: async (input, config, ctx) => {
    const condition = String(config.condition ?? 'false');
    ctx.logger.info(`Evaluating condition: ${condition.slice(0, 120)}`);

    let result = false;
    try {
      result = !!safeEvaluateExpression(condition, { data: input.data, variables: input.variables });
    } catch (err) {
      ctx.logger.warn(`Condition evaluation error: ${err instanceof Error ? err.message : String(err)}`);
      result = false;
    }

    ctx.logger.info(`Condition result: ${result}`);

    return {
      data: { ...input.data, condition_result: result },
      route: result ? 'true' : 'false',
    };
  },
};

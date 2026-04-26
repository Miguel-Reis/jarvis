import type { NodeDefinition } from '../registry.ts';
import { safeExecuteCode } from '../../safe-eval.ts';

export const codeExecutionAction: NodeDefinition = {
  type: 'action.code_execution',
  label: 'Code Execution',
  description: 'Execute a JavaScript or TypeScript snippet inline.',
  category: 'action',
  icon: '⚡',
  color: '#3b82f6',
  configSchema: {
    code: {
      type: 'code',
      label: 'Code',
      description: 'JavaScript/TypeScript code to execute. Has access to `input` (NodeInput data) and `ctx` (minimal context).',
      required: true,
      placeholder: '// Return a value from this function\nreturn { result: input.data.value * 2 };',
    },
    language: {
      type: 'select',
      label: 'Language',
      description: 'Code language. TypeScript is transpiled to JS before execution.',
      required: true,
      default: 'javascript',
      options: [
        { label: 'JavaScript', value: 'javascript' },
        { label: 'TypeScript', value: 'typescript' },
      ],
    },
    timeout_ms: {
      type: 'number',
      label: 'Timeout (ms)',
      description: 'Maximum execution time before the code is killed.',
      required: false,
      default: 10000,
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const code = String(config.code ?? '');
    if (!code) throw new Error('code is required');
    const language = String(config.language ?? 'javascript');
    const timeoutMs = typeof config.timeout_ms === 'number' ? config.timeout_ms : 10_000;

    ctx.logger.info(`Executing ${language} snippet (${code.length} chars)`);

    // Minimal safe context exposed to user code
    const safeCtx = {
      log: (msg: string) => ctx.logger.info(`[code] ${msg}`),
      warn: (msg: string) => ctx.logger.warn(`[code] ${msg}`),
      variables: input.variables,
      executionId: input.executionId,
    };

    let result: unknown;
    try {
      result = await safeExecuteCode(code, input, safeCtx, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.error(`Code execution failed: ${message}`);
      throw new Error(`Code execution failed: ${message}`);
    }

    return {
      data: {
        ...input.data,
        code_result: result,
        language,
      },
    };
  },
};

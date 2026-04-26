/**
 * Safe Expression Evaluator — sandboxed execution for workflow nodes.
 *
 * Validates expressions against a blocklist of dangerous patterns,
 * freezes scope objects, and enforces timeouts for code execution.
 */

/** Patterns that indicate dangerous code — block these in expressions */
const BLOCKED_PATTERNS = [
  /\brequire\s*\(/,
  /\bimport\s*[\(\{]/,
  /\bimport\b/,
  /\bprocess\b/,
  /\bBun\b/,
  /\bDeno\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bchild_process\b/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bsetImmediate\b/,
  /\bclearTimeout\b/,
  /\bclearInterval\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bnew\s+Worker\b/,
  /\bfs\b\.\b/,
  /\bexecSync\b/,
  /\bspawnSync\b/,
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
];

/**
 * Validate an expression or code string against the blocklist.
 * Throws if a dangerous pattern is detected.
 */
export function validateExpression(expr: string): void {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expr)) {
      throw new Error(
        `Blocked: expression contains forbidden pattern "${pattern.source}". ` +
        `Workflow expressions cannot access system APIs, imports, or process globals.`
      );
    }
  }
}

/**
 * Safely evaluate a simple JavaScript expression.
 * Used by if-else, switch, and map-filter nodes.
 *
 * The expression is validated against the blocklist, then executed
 * in a Function with frozen scope objects.
 */
export function safeEvaluateExpression(
  expression: string,
  scope: Record<string, unknown>,
): unknown {
  validateExpression(expression);

  // Freeze scope to prevent mutation
  const frozenScope: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scope)) {
    frozenScope[key] = value && typeof value === 'object' ? Object.freeze({ ...value as object }) : value;
  }

  const scopeKeys = Object.keys(frozenScope);
  const scopeValues = Object.values(frozenScope);

  // eslint-disable-next-line no-new-func
  const fn = new Function(
    ...scopeKeys,
    `"use strict"; return (${expression});`,
  );

  return fn(...scopeValues);
}

/**
 * Safely execute a code block with timeout.
 * Used by the code-execution node.
 *
 * Validates against blocklist, shadows dangerous globals,
 * freezes context, and enforces a timeout.
 */
export async function safeExecuteCode(
  code: string,
  input: { data: Record<string, unknown>; variables: Record<string, unknown>; executionId: string },
  safeCtx: Record<string, unknown>,
  timeoutMs: number = 10_000,
): Promise<unknown> {
  validateExpression(code);

  // Freeze context objects
  const frozenInput = Object.freeze({
    data: Object.freeze({ ...input.data }),
    variables: Object.freeze({ ...input.variables }),
    executionId: input.executionId,
  });
  const frozenCtx = Object.freeze({ ...safeCtx });

  // Shadow dangerous globals by declaring them as undefined in the function scope
  const wrappedCode = `
    "use strict";
    var process = undefined, Bun = undefined, Deno = undefined;
    var require = undefined, globalThis = undefined, global = undefined;
    var fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined;
    var __dirname = undefined, __filename = undefined;
    return (async function(input, ctx) {
      ${code}
    })(input, ctx);
  `;

  // eslint-disable-next-line no-new-func
  const fn = new Function('input', 'ctx', wrappedCode);

  // Execute with timeout
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fn(frozenInput, frozenCtx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Code execution timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Template Expression Engine
 *
 * Resolves {{...}} expressions in workflow node configs.
 * Supported patterns:
 *   {{variable.path}}                   — access execution/persistent variables
 *   {{$trigger.field}}                  — trigger data
 *   {{$node["nodeName"].data.field}}    — output from a previous node
 *   {{$env.VAR_NAME}}                   — environment variable
 */

export type TemplateContext = {
  variables: Record<string, unknown>;
  nodeOutputs: Map<string, Record<string, unknown>>;
  triggerData: Record<string, unknown>;
  env: Record<string, string>;
};

const EXPR_RE = /\{\{(.+?)\}\}/g;

/**
 * Resolve a single expression (the content between {{ and }})
 */
export function resolveExpression(expr: string, ctx: TemplateContext): unknown {
  const trimmed = expr.trim();

  // $node["nodeName"].data.field
  const nodeMatch = trimmed.match(/^\$node\["([^"]+)"\]\.(.+)$/);
  if (nodeMatch) {
    const [, nodeName, path] = nodeMatch;
    const nodeData = ctx.nodeOutputs.get(nodeName!);
    if (!nodeData) return undefined;
    return resolvePath(nodeData, path!);
  }

  // $trigger.field
  if (trimmed.startsWith('$trigger.')) {
    const path = trimmed.slice('$trigger.'.length);
    return resolvePath(ctx.triggerData, path);
  }

  // $env.VAR
  if (trimmed.startsWith('$env.')) {
    const key = trimmed.slice('$env.'.length);
    return ctx.env[key] ?? '';
  }

  // variable.path (default)
  return resolvePath(ctx.variables, trimmed);
}

/**
 * Resolve all {{...}} expressions in a string. If the entire string
 * is a single expression, return the raw value (not stringified).
 */
export function resolveTemplateString(template: string, ctx: TemplateContext): unknown {
  // If entire string is a single expression, return raw value
  const singleMatch = template.match(/^\{\{(.+?)\}\}$/);
  if (singleMatch) {
    return resolveExpression(singleMatch[1]!, ctx);
  }

  // Otherwise interpolate all expressions as strings
  return template.replace(EXPR_RE, (_match, expr) => {
    const val = resolveExpression(expr, ctx);
    if (val === undefined || val === null) return '';
    return typeof val === 'object' ? JSON.stringify(val) : String(val);
  });
}

/**
 * Recursively resolve all template strings in a config object.
 */
export function resolveAllTemplates(
  config: Record<string, unknown>,
  ctx: TemplateContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.includes('{{')) {
      result[key] = resolveTemplateString(value, ctx);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = resolveAllTemplates(value as Record<string, unknown>, ctx);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (typeof item === 'string' && item.includes('{{')) {
          return resolveTemplateString(item, ctx);
        }
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          return resolveAllTemplates(item as Record<string, unknown>, ctx);
        }
        return item;
      });
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Resolve a dot-separated path on an object.
 * Supports nested access: "foo.bar.baz" → obj.foo.bar.baz
 */
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

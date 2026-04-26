/**
 * Graph Executor — topological sort, parallel branches, retry, fallback, self-heal
 */

import type { WorkflowDefinition, WorkflowNode, WorkflowSettings, RetryPolicy } from './types.ts';
import type { NodeRegistry, NodeInput, NodeOutput, ExecutionContext } from './nodes/registry.ts';
import { resolveAllTemplates, type TemplateContext } from './template.ts';

/**
 * Topological sort of workflow nodes, grouped by execution level.
 * Nodes at the same level can be executed in parallel.
 * Returns string[][] where each inner array is a set of node IDs to execute concurrently.
 */
export function topologicalSort(definition: WorkflowDefinition): string[][] {
  const { nodes, edges } = definition;
  const nodeIds = new Set(nodes.map(n => n.id));

  // Build adjacency list and in-degree map
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  // Kahn's algorithm, grouping by level
  const levels: string[][] = [];
  let queue = [...nodeIds].filter(id => inDegree.get(id) === 0);

  while (queue.length > 0) {
    levels.push([...queue]);
    const nextQueue: string[] = [];

    for (const nodeId of queue) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          nextQueue.push(neighbor);
        }
      }
    }

    queue = nextQueue;
  }

  return levels;
}

/**
 * Get the outgoing edges from a node, optionally filtered by source handle.
 */
export function getOutgoingEdges(
  definition: WorkflowDefinition,
  nodeId: string,
  route?: string,
): string[] {
  return definition.edges
    .filter(e => {
      if (e.source !== nodeId) return false;
      if (route !== undefined && e.sourceHandle && e.sourceHandle !== route) return false;
      return true;
    })
    .map(e => e.target);
}

/**
 * Execute a single node with retry and fallback.
 */
export async function executeNode(
  node: WorkflowNode,
  input: NodeInput,
  nodeRegistry: NodeRegistry,
  ctx: ExecutionContext,
  templateCtx: TemplateContext,
  settings: WorkflowSettings,
): Promise<NodeOutput> {
  const nodeDef = nodeRegistry.get(node.type);
  if (!nodeDef) {
    throw new Error(`Unknown node type: ${node.type}`);
  }

  // Resolve template expressions in node config
  const resolvedConfig = resolveAllTemplates(node.config, templateCtx);

  const retryPolicy: RetryPolicy = node.retryPolicy ?? {
    maxRetries: settings.maxRetries,
    delayMs: settings.retryDelayMs,
    backoff: 'fixed',
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
    if (ctx.abortSignal.aborted) {
      throw new Error('Execution cancelled');
    }

    try {
      // Enforce node-level timeout from workflow settings
      const nodeTimeout = settings.timeoutMs ?? 300_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const output = await Promise.race([
        nodeDef.execute(input, resolvedConfig, ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Node '${node.label}' timed out after ${nodeTimeout}ms`)),
            nodeTimeout,
          );
        }),
      ]);
      clearTimeout(timer);
      return output;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      ctx.logger.warn(`Node ${node.label} attempt ${attempt + 1} failed: ${lastError.message}`);

      if (attempt < retryPolicy.maxRetries) {
        const delay = retryPolicy.backoff === 'exponential'
          ? retryPolicy.delayMs * Math.pow(2, attempt)
          : retryPolicy.delayMs;
        await sleep(delay, ctx.abortSignal);
      }
    }
  }

  // Self-heal: if onError is self_heal and we have an LLM manager, ask AI for fix
  if (settings.onError === 'self_heal' && ctx.llmManager && lastError) {
    try {
      ctx.logger.info(`Node ${node.label}: attempting self-heal...`);
      const healed = await selfHeal(node, lastError, resolvedConfig, input, ctx);
      if (healed) return healed;
    } catch (healErr) {
      ctx.logger.warn(`Self-heal failed for ${node.label}: ${healErr instanceof Error ? healErr.message : healErr}`);
    }
  }

  throw lastError ?? new Error(`Node ${node.label} failed after ${retryPolicy.maxRetries + 1} attempts`);
}

/**
 * Self-heal: ask the LLM to diagnose the failure and provide corrected config.
 * If the LLM provides a corrected config, retry the node once with the new config.
 */
async function selfHeal(
  node: WorkflowNode,
  error: Error,
  config: Record<string, unknown>,
  input: NodeInput,
  ctx: ExecutionContext,
): Promise<NodeOutput | null> {
  const llm = ctx.llmManager as any;
  if (!llm?.chat) return null;

  const diagnosticPrompt = [
    {
      role: 'system' as const,
      content: `You are a workflow debugger. A workflow node failed. Analyze the error and provide a corrected config that might fix it. Respond with ONLY a JSON object: { "fix": "explanation", "correctedConfig": { ... } }. If you cannot fix it, respond with { "fix": null }.`,
    },
    {
      role: 'user' as const,
      content: `Node: ${node.type} (${node.label})\nConfig: ${JSON.stringify(config)}\nInput data: ${JSON.stringify(input.data).slice(0, 1000)}\nError: ${error.message}\n\nWhat config change would fix this?`,
    },
  ];

  const response = await llm.chat(diagnosticPrompt, { temperature: 0.1, max_tokens: 1000 });

  try {
    const text = response.content;
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    if (!parsed.fix || !parsed.correctedConfig) return null;

    ctx.logger.info(`Self-heal applying fix: ${parsed.fix}`);

    // Re-execute with corrected config
    const nodeDef = ctx.nodeRegistry?.get(node.type);
    if (!nodeDef) return null;

    return await nodeDef.execute(input, parsed.correctedConfig, ctx);
  } catch (parseErr) {
    ctx.logger.warn(`Self-heal parse/execution failed: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
    return null;
  }
}

/**
 * Sleep with abort support.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Aborted')); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Aborted')); }, { once: true });
  });
}

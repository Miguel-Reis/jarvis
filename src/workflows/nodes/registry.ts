/**
 * Node Registry — mirrors ToolRegistry pattern
 */

import type { NodeCategory, NodeConfigField } from '../types.ts';
import type { ToolRegistry } from '../../actions/tools/registry.ts';

// ── Node I/O ──

export type NodeInput = {
  data: Record<string, unknown>;
  variables: Record<string, unknown>;
  executionId: string;
};

export type NodeOutput = {
  data: Record<string, unknown>;
  route?: string;   // For conditional nodes: which handle to follow
};

// ── Execution Context ──

export type StepLogger = {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
};

export type ExecutionContext = {
  executionId: string;
  workflowId: string;
  toolRegistry: ToolRegistry;
  llmManager: unknown;      // LLMManager — loosely typed to avoid circular deps
  variables: VariableScopeInterface;
  logger: StepLogger;
  abortSignal: AbortSignal;
  nodeRegistry?: NodeRegistry;  // For self-heal: re-execute with corrected config
  /** Broadcast a message to dashboard chat (used by send_message, notification nodes) */
  broadcast?: (type: string, data: Record<string, unknown>) => void;
};

export interface VariableScopeInterface {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  setPersistent(key: string, value: unknown): void;
  toObject(): Record<string, unknown>;
}

// ── Node Definition ──

export type NodeDefinition = {
  type: string;                                    // e.g., 'trigger.cron'
  label: string;
  description: string;
  category: NodeCategory;
  icon: string;
  color: string;
  configSchema: Record<string, NodeConfigField>;
  inputs: string[];
  outputs: string[];
  execute: (input: NodeInput, config: Record<string, unknown>, ctx: ExecutionContext) => Promise<NodeOutput>;
};

// ── Registry ──

export class NodeRegistry {
  private nodes: Map<string, NodeDefinition> = new Map();

  register(node: NodeDefinition): void {
    if (this.nodes.has(node.type)) {
      throw new Error(`Node type '${node.type}' is already registered`);
    }
    this.nodes.set(node.type, node);
  }

  get(type: string): NodeDefinition | undefined {
    return this.nodes.get(type);
  }

  list(category?: NodeCategory): NodeDefinition[] {
    const all = Array.from(this.nodes.values());
    if (!category) return all;
    return all.filter(n => n.category === category);
  }

  has(type: string): boolean {
    return this.nodes.has(type);
  }

  getCategories(): NodeCategory[] {
    const cats = new Set<NodeCategory>();
    for (const n of this.nodes.values()) cats.add(n.category);
    return Array.from(cats);
  }

  count(): number {
    return this.nodes.size;
  }
}

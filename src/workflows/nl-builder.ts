/**
 * NL Workflow Builder — Conversational workflow construction via LLM
 *
 * Parses natural language descriptions into WorkflowDefinition objects,
 * modifies existing workflows via NL instructions, and supports
 * conversational building with context.
 */

import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from './types.ts';
import type { NodeRegistry } from './nodes/registry.ts';
import * as vault from '../vault/workflows.ts';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export class NLWorkflowBuilder {
  private nodeRegistry: NodeRegistry;
  private llmManager: any; // LLMManager

  constructor(nodeRegistry: NodeRegistry, llmManager: unknown) {
    this.nodeRegistry = nodeRegistry;
    this.llmManager = llmManager;
  }

  /**
   * Parse a natural language description into a full WorkflowDefinition.
   */
  async parseDescription(text: string): Promise<WorkflowDefinition> {
    const catalog = this.buildCatalogPrompt();
    const prompt = [
      { role: 'system' as const, content: this.buildSystemPrompt(catalog) },
      { role: 'user' as const, content: `Create a workflow from this description:\n\n${text}\n\nRespond with ONLY valid JSON matching the WorkflowDefinition schema. No explanation.` },
    ];

    const response = await this.llmManager.chat(prompt, {
      temperature: 0.2,
      max_tokens: 4000,
    });

    return this.parseDefinitionResponse(response.content);
  }

  /**
   * Modify an existing workflow definition via NL instruction.
   */
  async modifyWorkflow(
    definition: WorkflowDefinition,
    instruction: string,
  ): Promise<{ definition: WorkflowDefinition; changes: string[] }> {
    const catalog = this.buildCatalogPrompt();
    const prompt = [
      { role: 'system' as const, content: this.buildSystemPrompt(catalog) },
      {
        role: 'user' as const,
        content: `Here is the current workflow definition:\n\`\`\`json\n${JSON.stringify(definition, null, 2)}\n\`\`\`\n\nModify it according to this instruction: ${instruction}\n\nRespond with JSON: { "definition": <updated WorkflowDefinition>, "changes": ["list of changes made"] }`,
      },
    ];

    const response = await this.llmManager.chat(prompt, {
      temperature: 0.2,
      max_tokens: 6000,
    });

    const parsed = JSON.parse(this.extractJson(response.content));
    return {
      definition: this.validateDefinition(parsed.definition),
      changes: parsed.changes ?? [],
    };
  }

  /**
   * Conversational workflow building — chat with history.
   */
  async chat(
    workflowId: string,
    message: string,
    history: ChatMessage[],
  ): Promise<{ reply: string; updated: boolean }> {
    const catalog = this.buildCatalogPrompt();
    const latestVersion = vault.getLatestVersion(workflowId);
    const currentDef = latestVersion?.definition;

    const messages = [
      {
        role: 'system' as const,
        content: this.buildSystemPrompt(catalog) +
          (currentDef
            ? `\n\nCurrent workflow definition:\n\`\`\`json\n${JSON.stringify(currentDef, null, 2)}\n\`\`\``
            : '\n\nNo workflow definition exists yet.') +
          `\n\nYou are helping the user build/modify their workflow via chat. If the user asks to add, remove, or modify nodes/edges, output the FULL updated definition in a JSON code block. If they're asking a question, just answer it. Always explain what you changed.`,
      },
      ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: message },
    ];

    const response = await this.llmManager.chat(messages, {
      temperature: 0.3,
      max_tokens: 4000,
    });

    const text = response.content;

    // Check if response contains a definition update
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const newDef = this.validateDefinition(JSON.parse(jsonMatch[1]));
        // Save as new version
        vault.createVersion(workflowId, newDef, 'NL chat update');
        return { reply: text.replace(/```json[\s\S]*?```/, '*(definition updated)*'), updated: true };
      } catch {
        // JSON parse failed — treat as conversational
      }
    }

    return { reply: text, updated: false };
  }

  // ── Private helpers ──

  private buildSystemPrompt(catalog: string): string {
    return `You are a workflow builder AI. You create and modify workflow definitions for an automation system.

Available node types:
${catalog}

A WorkflowDefinition has this structure:
{
  "nodes": [{ "id": string, "type": string, "label": string, "position": { "x": number, "y": number }, "config": {} }],
  "edges": [{ "id": string, "source": string, "target": string, "sourceHandle?": string, "label?": string }],
  "settings": { "maxRetries": 3, "retryDelayMs": 5000, "timeoutMs": 300000, "parallelism": "parallel"|"sequential", "onError": "stop"|"continue"|"self_heal" }
}

Rules:
- Every workflow must have at least one trigger node
- Node IDs should be descriptive (e.g., "trigger-cron-1", "action-email-1")
- Position nodes left-to-right, top-to-bottom, with ~200px spacing
- Connect nodes with edges from source to target
- Use "sourceHandle" for branching nodes (if-else: "true"/"false", switch: "case_0"/"case_1"/etc.)
- Config fields must match the node's configSchema`;
  }

  private buildCatalogPrompt(): string {
    const nodes = this.nodeRegistry.list();
    return nodes.map(n =>
      `- ${n.type} (${n.category}): ${n.description} | config: ${Object.keys(n.configSchema).join(', ') || 'none'}`
    ).join('\n');
  }

  private extractJson(text: string): string {
    // Try to extract from code block
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1]!.trim();
    // Try raw JSON
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return text.slice(start, end + 1);
    throw new Error('No JSON found in response');
  }

  private parseDefinitionResponse(text: string): WorkflowDefinition {
    const json = this.extractJson(text);
    const parsed = JSON.parse(json);
    return this.validateDefinition(parsed);
  }

  private validateDefinition(def: any): WorkflowDefinition {
    if (!def.nodes || !Array.isArray(def.nodes)) throw new Error('Missing nodes array');
    if (!def.edges || !Array.isArray(def.edges)) throw new Error('Missing edges array');

    const nodes: WorkflowNode[] = def.nodes.map((n: any, i: number) => ({
      id: n.id ?? `node-${i}`,
      type: n.type ?? 'action.send_message',
      label: n.label ?? n.type ?? `Node ${i}`,
      position: n.position ?? { x: 100 + i * 200, y: 200 },
      config: n.config ?? {},
    }));

    const edges: WorkflowEdge[] = (def.edges ?? []).map((e: any, i: number) => ({
      id: e.id ?? `edge-${i}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      label: e.label,
    }));

    return {
      nodes,
      edges,
      settings: {
        maxRetries: def.settings?.maxRetries ?? 3,
        retryDelayMs: def.settings?.retryDelayMs ?? 5000,
        timeoutMs: def.settings?.timeoutMs ?? 300000,
        parallelism: def.settings?.parallelism ?? 'parallel',
        onError: def.settings?.onError ?? 'stop',
      },
    };
  }
}

import type { RoleDefinition } from '../roles/types.ts';
import type { LLMMessage, LLMResponse, LLMStreamEvent, LLMToolCall, LLMTool, ContentBlock } from '../llm/provider.ts';
import { pruneMessages } from '../vault/conversations.ts';
import { LLMManager } from '../llm/manager.ts';
import { AgentInstance } from './agent.ts';
import { AgentHierarchy } from './hierarchy.ts';
import { ToolRegistry } from '../actions/tools/registry.ts';
import { toolDefToLLMTool } from '../actions/tools/builtin.ts';
import type { ActionCategory } from '../roles/authority.ts';
import type { AuthorityEngine } from '../authority/engine.ts';
import type { ApprovalManager, ApprovalRequest } from '../authority/approval.ts';
import type { AuditTrail } from '../authority/audit.ts';
import type { EmergencyController } from '../authority/emergency.ts';
import { ToolExecutor } from '../daemon/tool-executor.ts';
import { ToolRateLimiter } from '../daemon/tool-rate-limiter.ts';
const MAX_TOOL_RESULT_CHARS = 6000; // Cap individual tool results to control context size

const DESTRUCTIVE_TOOLS = ['delete_file', 'delete_directory', 'run_command', 'drop_collection', 'format_disk'];
const CONFIRM_PREFIX = '[CONFIRM]';

function toolIsDestructive(name: string): boolean {
  return DESTRUCTIVE_TOOLS.includes(name);
}

const STALL_WINDOW = 3; // Identical consecutive iteration signatures → stall

/**
 * Deduplicate tool calls by (name, args) key. If the same call appears
 * multiple times, execute once and replicate the result for all duplicates.
 */
function dedupeToolCalls(toolCalls: LLMToolCall[]): {
  unique: LLMToolCall[];
  groups: Map<string, number[]>;
} {
  const groups = new Map<string, number[]>();
  const unique: LLMToolCall[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const key = `${tc.name}::${JSON.stringify(tc.arguments)}`;
    if (!groups.has(key)) {
      groups.set(key, [i]);
      unique.push(tc);
    } else {
      groups.get(key)!.push(i);
    }
  }

  return { unique, groups };
}

/**
 * Replicate deduplicated results back to the original call array shape.
 */
function expandToolResults(results: string[], groups: Map<string, number[]>): string[] {
  // groups: key → [original_indices]
  // results[i] corresponds to groups.keys()[i]
  const expanded = new Array<string>(results.length);
  let ri = 0;
  for (const key of groups.keys()) {
    const indices = groups.get(key)!;
    for (const idx of indices) {
      expanded[idx] = results[ri];
    }
    ri++;
  }
  return expanded;
}

export class AgentOrchestrator {
  private hierarchy: AgentHierarchy;
  private llmManager: LLMManager | null;
  private toolRegistry: ToolRegistry | null;
  private toolExecutor: ToolExecutor | null = null;
  private rateLimiter: ToolRateLimiter = new ToolRateLimiter();

  // Authority engine components
  private authorityEngine: AuthorityEngine | null = null;
  private approvalManager: ApprovalManager | null = null;
  private auditTrail: AuditTrail | null = null;
  private emergencyController: EmergencyController | null = null;
  private temporaryGrants: Map<string, ActionCategory[]> = new Map();
  private onApprovalNeeded: ((request: ApprovalRequest) => void) | null = null;

  constructor() {
    this.hierarchy = new AgentHierarchy();
    this.llmManager = null;
    this.toolRegistry = null;
  }

  setLLMManager(llm: LLMManager): void {
    this.llmManager = llm;
  }

  getLLMManager(): LLMManager | null {
    return this.llmManager;
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
    this.toolExecutor = new ToolExecutor({
      toolRegistry: registry,
      emergencyController: this.emergencyController,
      authorityEngine: this.authorityEngine,
      auditTrail: this.auditTrail,
      approvalManager: this.approvalManager,
      getPrimary: () => this.getPrimary(),
      getTemporaryGrants: () => this.temporaryGrants,
      onApprovalNeeded: this.onApprovalNeeded ?? undefined,
      toolRateLimiter: this.rateLimiter,
    });
  }

  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  // --- Authority setters ---

  setAuthorityEngine(engine: AuthorityEngine): void {
    this.authorityEngine = engine;
    if (this.toolExecutor) {
      this.toolExecutor = new ToolExecutor({
        toolRegistry: this.toolRegistry!,
        emergencyController: this.emergencyController,
        authorityEngine: engine,
        auditTrail: this.auditTrail,
        approvalManager: this.approvalManager,
        getPrimary: () => this.getPrimary(),
        getTemporaryGrants: () => this.temporaryGrants,
        onApprovalNeeded: this.onApprovalNeeded ?? undefined,
        toolRateLimiter: this.rateLimiter,
      });
    }
  }

  setApprovalManager(manager: ApprovalManager): void {
    this.approvalManager = manager;
    if (this.toolExecutor) {
      this.toolExecutor = new ToolExecutor({
        toolRegistry: this.toolRegistry!,
        emergencyController: this.emergencyController,
        authorityEngine: this.authorityEngine,
        auditTrail: this.auditTrail,
        approvalManager: manager,
        getPrimary: () => this.getPrimary(),
        getTemporaryGrants: () => this.temporaryGrants,
        onApprovalNeeded: this.onApprovalNeeded ?? undefined,
        toolRateLimiter: this.rateLimiter,
      });
    }
  }

  setAuditTrail(trail: AuditTrail): void {
    this.auditTrail = trail;
    if (this.toolExecutor) {
      this.toolExecutor = new ToolExecutor({
        toolRegistry: this.toolRegistry!,
        emergencyController: this.emergencyController,
        authorityEngine: this.authorityEngine,
        auditTrail: trail,
        approvalManager: this.approvalManager,
        getPrimary: () => this.getPrimary(),
        getTemporaryGrants: () => this.temporaryGrants,
        onApprovalNeeded: this.onApprovalNeeded ?? undefined,
        toolRateLimiter: this.rateLimiter,
      });
    }
  }

  setEmergencyController(controller: EmergencyController): void {
    this.emergencyController = controller;
    if (this.toolExecutor) {
      this.toolExecutor = new ToolExecutor({
        toolRegistry: this.toolRegistry!,
        emergencyController: controller,
        authorityEngine: this.authorityEngine,
        auditTrail: this.auditTrail,
        approvalManager: this.approvalManager,
        getPrimary: () => this.getPrimary(),
        getTemporaryGrants: () => this.temporaryGrants,
        onApprovalNeeded: this.onApprovalNeeded ?? undefined,
        toolRateLimiter: this.rateLimiter,
      });
    }
  }

  setApprovalCallback(cb: (request: ApprovalRequest) => void): void {
    this.onApprovalNeeded = cb;
    if (this.toolExecutor) {
      this.toolExecutor = new ToolExecutor({
        toolRegistry: this.toolRegistry!,
        emergencyController: this.emergencyController,
        authorityEngine: this.authorityEngine,
        auditTrail: this.auditTrail,
        approvalManager: this.approvalManager,
        getPrimary: () => this.getPrimary(),
        getTemporaryGrants: () => this.temporaryGrants,
        onApprovalNeeded: cb,
        toolRateLimiter: this.rateLimiter,
      });
    }
  }

  /**
   * Grant a temporary permission to a specific agent (for parent escalation).
   */
  grantTemporary(agentId: string, action: ActionCategory): void {
    const existing = this.temporaryGrants.get(agentId) ?? [];
    if (!existing.includes(action)) {
      existing.push(action);
      this.temporaryGrants.set(agentId, existing);
    }
  }

  /**
   * Revoke a temporary permission from an agent.
   */
  revokeTemporary(agentId: string, action: ActionCategory): void {
    const existing = this.temporaryGrants.get(agentId);
    if (existing) {
      this.temporaryGrants.set(agentId, existing.filter(a => a !== action));
    }
  }

  /**
   * Clear all temporary grants for an agent (called when task completes).
   */
  clearTemporaryGrants(agentId: string): void {
    this.temporaryGrants.delete(agentId);
  }

  /**
   * Create the primary agent from a role.
   * No inline system prompt — the AgentService builds a rich dynamic prompt each turn.
   */
  createPrimary(role: RoleDefinition): AgentInstance {
    const existing = this.hierarchy.getPrimary();
    if (existing) {
      throw new Error('Primary agent already exists. Terminate it first.');
    }

    const agent = new AgentInstance(role);
    this.hierarchy.addAgent(agent);
    return agent;
  }

  /**
   * Spawn a sub-agent under a parent
   */
  spawnSubAgent(
    parentId: string,
    role: RoleDefinition,
    opts?: { memory_scope?: string[] }
  ): AgentInstance {
    const parent = this.hierarchy.getAgent(parentId);
    if (!parent) {
      throw new Error(`Parent agent not found: ${parentId}`);
    }

    if (!parent.agent.authority.can_spawn_children) {
      throw new Error('Parent agent does not have authority to spawn children');
    }

    // Create child agent with reduced authority
    const childAuthority = {
      max_authority_level: Math.min(
        role.authority_level,
        parent.agent.authority.max_authority_level - 1
      ),
      allowed_tools: role.tools.filter((tool) =>
        parent.agent.authority.allowed_tools.includes(tool)
      ),
      denied_tools: parent.agent.authority.denied_tools,
      max_token_budget: Math.floor(parent.agent.authority.max_token_budget / 2),
      can_spawn_children: role.sub_roles.length > 0,
    };

    const agent = new AgentInstance(role, {
      parent_id: parentId,
      authority: childAuthority,
      memory_scope: opts?.memory_scope ?? [],
    });

    this.hierarchy.addAgent(agent);

    // Add system message with role context for sub-agents
    agent.addMessage(
      'system',
      `You are ${role.name}, spawned by ${parent.agent.role.name}. ${role.description}\n\nResponsibilities:\n${role.responsibilities.map((r) => `- ${r}`).join('\n')}\n\nYou report to: ${parent.agent.role.name}\n\nCommunication style: ${role.communication_style.tone} tone, ${role.communication_style.verbosity} verbosity, ${role.communication_style.formality} formality.`
    );

    return agent;
  }

  /**
   * Terminate an agent and its children
   */
  terminateAgent(agentId: string): void {
    const agent = this.hierarchy.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Recursively terminate children first
    const children = this.hierarchy.getChildren(agentId);
    for (const child of children) {
      this.terminateAgent(child.id);
    }

    // Terminate this agent
    agent.terminate();
    this.hierarchy.removeAgent(agentId);
  }

  getPrimary(): AgentInstance | undefined {
    return this.hierarchy.getPrimary();
  }

  getAgent(agentId: string): AgentInstance | undefined {
    return this.hierarchy.getAgent(agentId);
  }

  getAllAgents(): AgentInstance[] {
    return this.hierarchy.getAllAgents();
  }

  getHierarchy(): AgentHierarchy {
    return this.hierarchy;
  }

  /**
   * Process a user message through the primary agent (non-streaming).
   * Includes the tool execution loop: LLM → tool_calls → execute → re-call → repeat.
   */
  async processMessage(systemPrompt: string, message: string): Promise<string> {
    const primary = this.getPrimary();
    if (!primary) {
      throw new Error('No primary agent exists. Create one first.');
    }

    // Add user message to persistent history
    primary.addMessage('user', message);

    // If no LLM manager, return placeholder
    if (!this.llmManager) {
      const response = `[No LLM configured] Received: ${message}`;
      primary.addMessage('assistant', response);
      return response;
    }

    // Build local messages array for this turn (system + history)
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...primary.getMessages(),
    ];

    const tools = this.getLLMTools();
    let finalText = '';
    const recentIterSigsSync: string[] = [];

    // Tool execution loop
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const llmResponse: LLMResponse = await this.llmManager.chat(messages, { tools });

      if (llmResponse.finish_reason === 'tool_use' && llmResponse.tool_calls.length > 0) {
        // Stall detection
        const iterSig = llmResponse.tool_calls.map(tc => `${tc.name}:${JSON.stringify(tc.arguments)}`).join('|');
        recentIterSigsSync.push(iterSig);
        if (recentIterSigsSync.length > STALL_WINDOW) recentIterSigsSync.shift();
        if (recentIterSigsSync.length === STALL_WINDOW && recentIterSigsSync.every(s => s === iterSig)) {
          finalText = `[Loop detected: the same tool call(s) repeated ${STALL_WINDOW} times without progress. Stopping to avoid an infinite loop.]`;
          break;
        }

        // Add assistant message with tool calls to local messages
        messages.push({
          role: 'assistant',
          content: llmResponse.content,
          tool_calls: llmResponse.tool_calls,
        });
                // Deduplicate tool calls: same (name, args) → execute once, replicate result
                const { unique: uniqueCalls, groups } = dedupeToolCalls(llmResponse.tool_calls);
                const deduplicated = uniqueCalls.length < llmResponse.tool_calls.length;
                if (deduplicated) {
                  console.log(`[Orchestrator] Deduplicated ${llmResponse.tool_calls.length} tool calls → ${uniqueCalls.length} unique`);
                }

                let verificationFailed = false;
                for (const tc of uniqueCalls) {
                  if (!this.toolExecutor) throw new Error('ToolExecutor not initialized');

                  // Confirm destructive actions before executing
                  if (toolIsDestructive(tc.name)) {
                    messages.push({
                      role: 'user',
                      content: `[SYSTEM] Before executing ${tc.name}(${JSON.stringify(tc.arguments)}), confirm: this is a destructive operation. Reply YES to proceed or NO to cancel.`,
                    });
                    const confirmResponse = await this.llmManager.chat(messages, { tools: this.getLLMTools() });
                    const confirmed = /\byes?\b/i.test(confirmResponse.content);
                    messages.pop(); // remove system prompt
                    if (!confirmed) {
                      const cancelMsg = `[CANCELLED] ${tc.name} was cancelled by the user.`;
                      const expanded = expandToolResults([cancelMsg], groups);
                      for (let i = 0; i < llmResponse.tool_calls.length; i++) {
                        if (expanded[i]) {
                          messages.push({ role: 'tool', content: expanded[i], tool_call_id: llmResponse.tool_calls[i].id });
                        }
                      }
                      continue;
                    }
                    messages.pop();
                    messages.push({ role: 'user', content: `YES` });
                  }

                  console.log(`[Activity] Running tool: ${tc.name}`);
                  const result = await this.toolExecutor.executeTool(tc);
                  const logStr = typeof result === 'string' ? result.slice(0, 100) : `[${result.length} content blocks]`;
                  console.log(`[Activity] Tool ${tc.name} completed → ${logStr}...`);

                  // Expand result back to all original duplicate indices
                  const expandedResult = expandToolResults([result], groups);

                  // Post-tool verification
                  if (this.toolExecutor.verifyToolEffect && typeof result === 'string' && !result.startsWith('[TOOL_ERROR]') && !result.startsWith('[AUTHORITY')) {
                    const verification = this.toolExecutor.verifyToolEffect(tc.name, tc.arguments, result);
                    if (verification) {
                      const expandedVerify = expandToolResults([verification], groups);
                      for (let i = 0; i < llmResponse.tool_calls.length; i++) {
                        if (expandedVerify[i]) {
                          messages.push({ role: 'tool', content: expandedVerify[i], tool_call_id: llmResponse.tool_calls[i].id });
                        }
                      }
                      console.warn(`[Orchestrator] Verification failed for ${tc.name}: ${verification}`);
                      verificationFailed = true;
                    }
                  }

                  // Push results to the correct original tool_call ids
                  for (let i = 0; i < llmResponse.tool_calls.length; i++) {
                    if (expandedResult[i]) {
                      messages.push({ role: 'tool', content: expandedResult[i], tool_call_id: llmResponse.tool_calls[i].id });
                      if (typeof expandedResult[i] === 'string') {
                        const docMarker = expandedResult[i].match(/<!-- jarvis:document id="[^"]+" title="[^"]+" format="[^"]+" size="[^"]+" -->/);
                        if (docMarker) {
                          finalText += '\n' + docMarker[0] + '\n';
                        }
                      }
                    }
                  }
                }
        }

        // If any tool failed verification, re-call LLM so it knows to correct
        if (verificationFailed) {
          messages.push({ role: 'user', content: 'IMPORTANT: A tool I executed failed verification — the filesystem shows the action did not actually complete. Revise my previous response and inform the user honestly about what went wrong.' });
          continue;
        }

        // Continue loop to re-call LLM with tool results
        continue;

      }

      // No tool calls — this is the final response
      finalText = llmResponse.content;

      // Warn on truncation
      if (llmResponse.finish_reason === 'length') {
        finalText += '\n\n[Response was truncated due to output token limits. If you asked for long content, ask to continue or use shorter chunks.]';
      }

      break;
    }

    // Add final response to persistent history
    primary.addMessage('assistant', finalText);

    // Lightweight follow-up: check if this was a multi-step task that might need closure
    const hasToolCalls = messages.some(m => m.role === 'tool' && typeof m.content === 'string' && !m.content.startsWith('[TOOL_ERROR]'));
    if (hasToolCalls) {
      finalText += '\n\n_Got it done. Let me know if you need anything else._';
    }

    // Safety prune: keep conversation bounded (fire-and-forget)
    const convId = primary.conversationId;
    if (convId) {
      pruneMessages(convId).catch((err) =>
        console.warn('[Orchestrator] prune error:', err instanceof Error ? err.message : err)
      );
    }

    return finalText;
  }

  /**
   * Stream a message through the primary agent with tool execution loop.
   * Yields text/tool_call events through all iterations.
   * Only emits 'done' when the final response is complete.
   */
  async *streamMessage(systemPrompt: string, message: string | ContentBlock[]): AsyncIterable<LLMStreamEvent> {
    const primary = this.getPrimary();
    if (!primary) {
      throw new Error('No primary agent exists. Create one first.');
    }

    // Add user message to persistent history
    primary.addMessage('user', message);

    // If no LLM manager, yield placeholder
    if (!this.llmManager) {
      const msgPreview = typeof message === 'string' ? message : '[image + text]';
      const response = `[No LLM configured] Received: ${msgPreview}`;
      primary.addMessage('assistant', response);
      yield { type: 'text', text: response };
      yield {
        type: 'done',
        response: {
          content: response,
          tool_calls: [],
          usage: { input_tokens: 0, output_tokens: 0 },
          model: 'none',
          finish_reason: 'stop',
        },
      };
      return;
    }

    // Build local messages array for this turn
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...primary.getMessages(),
    ];

    const tools = this.getLLMTools();
    const totalUsage = { input_tokens: 0, output_tokens: 0 };
    let finalText = '';
    let responseModel = 'unknown';
    const recentIterSigs: string[] = [];

    // Tool execution loop
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let accumulatedText = '';
      const toolCalls: LLMToolCall[] = [];
      let doneResponse: LLMResponse | null = null;

      // Stream from LLM
      for await (const event of this.llmManager.stream(messages, { tools })) {
        if (event.type === 'text') {
          accumulatedText += event.text;
          yield event; // Forward text chunks to client
        } else if (event.type === 'tool_call') {
          toolCalls.push(event.tool_call);
          yield event; // Forward tool_call events to client
        } else if (event.type === 'done') {
          doneResponse = event.response;
          totalUsage.input_tokens += event.response.usage.input_tokens;
          totalUsage.output_tokens += event.response.usage.output_tokens;
          responseModel = event.response.model;
          // Don't yield done yet — may need more iterations
        } else if (event.type === 'error') {
          yield event;
          return;
        }
      }

      // Ensure doneResponse is never null (stream may end without 'done' event)
      if (!doneResponse) {
        doneResponse = {
          content: accumulatedText,
          tool_calls: toolCalls,
          usage: { input_tokens: 0, output_tokens: 0 },
          model: responseModel,
          finish_reason: 'stop',
        };
      }

      // No tool calls — this is the final response
      if (toolCalls.length === 0) {
        finalText += accumulatedText;

        // Check if we stopped due to token limit (truncation)
        const wasLength = doneResponse?.finish_reason === 'length';
        if (wasLength && !finalText.includes('[SYSTEM WARNING')) {
          const truncWarning = '\n\n[Response was truncated due to output token limits. If you asked for long content, ask to continue or use shorter chunks.]';
          finalText += truncWarning;
          yield { type: 'text', text: truncWarning };
        }

        yield {
          type: 'done',
          response: {
            content: finalText,
            tool_calls: [],
            usage: totalUsage,
            model: responseModel,
            finish_reason: wasLength ? 'length' : 'stop',
          },
        };
        // Add final response to persistent history (only user-facing text)
        primary.addMessage('assistant', finalText);
        return;
      }

      // Tool calls present — execute them
      finalText += accumulatedText;

      // Stall detection: if last STALL_WINDOW iterations had identical tool signatures, abort
      const iterSig = toolCalls.map(tc => `${tc.name}:${JSON.stringify(tc.arguments)}`).join('|');
      recentIterSigs.push(iterSig);
      if (recentIterSigs.length > STALL_WINDOW) recentIterSigs.shift();
      if (recentIterSigs.length === STALL_WINDOW && recentIterSigs.every(s => s === iterSig)) {
        const stallMsg = `\n\n[Loop detected: the same tool call(s) repeated ${STALL_WINDOW} times without progress. Stopping to avoid an infinite loop. Please try a different approach or ask the user for clarification.]`;
        yield { type: 'text', text: stallMsg };
        yield {
          type: 'done',
          response: {
            content: finalText + stallMsg,
            tool_calls: [],
            usage: totalUsage,
            model: responseModel,
            finish_reason: 'stop',
          },
        };
        primary.addMessage('assistant', finalText + stallMsg);
        return;
      }

      // Add assistant message with tool calls to local messages
      messages.push({
        role: 'assistant',
        content: accumulatedText,
        tool_calls: toolCalls,
      });
      // Deduplicate tool calls: same (name, args) → execute once, replicate result
      const { unique: uniqueStreamCalls, groups: streamGroups } = dedupeToolCalls(toolCalls);
      if (uniqueStreamCalls.length < toolCalls.length) {
        console.log(`[Orchestrator] Deduplicated ${toolCalls.length} tool calls → ${uniqueStreamCalls.length} unique`);
      }

      let streamVerificationFailed = false;
      for (const tc of uniqueStreamCalls) {
        if (!this.toolExecutor) throw new Error('ToolExecutor not initialized');

        // Confirm destructive actions before executing
        if (toolIsDestructive(tc.name)) {
          messages.push({
            role: 'user',
            content: `[SYSTEM] Before executing ${tc.name}(${JSON.stringify(tc.arguments)}), confirm: this is a destructive operation. Reply YES to proceed or NO to cancel.`,
          });
          const confirmResponse = await this.llmManager.chat(messages, { tools: this.getLLMTools() });
          const confirmed = /\byes?\b/i.test(confirmResponse.content);
          messages.pop();
          if (!confirmed) {
            const cancelMsg = `[CANCELLED] ${tc.name} was cancelled by the user.`;
            const expanded = expandToolResults([cancelMsg], streamGroups);
            for (let i = 0; i < toolCalls.length; i++) {
              if (expanded[i]) {
                messages.push({ role: 'tool', content: expanded[i], tool_call_id: toolCalls[i].id });
              }
            }
            continue;
          }
          messages.pop();
          messages.push({ role: 'user', content: `YES` });
        }

        console.log(`[Activity] Running tool: ${tc.name}`);
        const result = await this.toolExecutor.executeTool(tc);
        console.log(`[Activity] Tool ${tc.name} completed → ${typeof result === 'string' ? result.slice(0, 100) : `[${result.length} content blocks]`}...`);

        // Expand result back to all original duplicate indices
        const expandedResult = expandToolResults([result], streamGroups);

        // Post-tool verification
        if (this.toolExecutor.verifyToolEffect && typeof result === 'string' && !result.startsWith('[TOOL_ERROR]') && !result.startsWith('[AUTHORITY')) {
          const verification = this.toolExecutor.verifyToolEffect(tc.name, tc.arguments, result);
          if (verification) {
            const expandedVerify = expandToolResults([verification], streamGroups);
            for (let i = 0; i < toolCalls.length; i++) {
              if (expandedVerify[i]) {
                messages.push({ role: 'tool', content: expandedVerify[i], tool_call_id: toolCalls[i].id });
              }
            }
            console.warn(`[Orchestrator] Verification failed for ${tc.name}: ${verification}`);
            streamVerificationFailed = true;
          }
        }

        // Push tool results and inject document markers into the stream
        for (let i = 0; i < toolCalls.length; i++) {
          if (expandedResult[i]) {
            messages.push({ role: 'tool', content: expandedResult[i], tool_call_id: toolCalls[i].id });
            if (typeof expandedResult[i] === 'string') {
              const docMarker = expandedResult[i].match(/<!-- jarvis:document id="[^"]+" title="[^"]+" format="[^"]+" size="[^"]+" -->/);
              if (docMarker) {
                yield { type: 'text' as const, text: '\n' + docMarker[0] + '\n' };
              }
            }
          }
        }
      }

      // If any tool failed verification, re-call LLM so it corrects the response
      if (streamVerificationFailed) {
        messages.push({ role: 'user', content: 'IMPORTANT: A tool I executed failed verification — the filesystem shows the action did not actually complete. Revise my previous response and inform the user honestly about what went wrong.' });
        continue;
      }

      // Continue loop — will stream next LLM response
    }

    // Max iterations reached
    yield { type: 'text', text: '\n[Max tool iterations reached]' };
    yield {
      type: 'done',
      response: {
        content: finalText + '\n[Max tool iterations reached]',
        tool_calls: [],
        usage: totalUsage,
        model: responseModel,
        finish_reason: 'stop',
      },
    };
    primary.addMessage('assistant', finalText);
  }

  /**
   * Heartbeat: let the primary agent check for proactive actions.
   */
  async heartbeat(systemPrompt: string): Promise<string | null> {
    const primary = this.getPrimary();
    if (!primary || !this.llmManager) {
      return null;
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...primary.getMessages(),
    ];

    const llmResponse: LLMResponse = await this.llmManager.chat(messages);

    if (llmResponse.content && llmResponse.content.trim().length > 0) {
      primary.addMessage('assistant', llmResponse.content);
      return llmResponse.content;
    }

    return null;
  }

  // --- Private helpers ---

  /**
   * Get LLM-formatted tools from the ToolRegistry.
   */
  private getLLMTools(): LLMTool[] | undefined {
    if (!this.toolRegistry || this.toolRegistry.count() === 0) {
      return undefined;
    }

    return this.toolRegistry.list().map(toolDefToLLMTool);
  }


}

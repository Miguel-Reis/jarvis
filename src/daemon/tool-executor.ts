/**
 * Tool Executor — handles tool execution, result formatting, and error handling.
 *
 * Extracted from AgentOrchestrator to separate concerns and improve testability.
 */

import type { LLMToolCall, ContentBlock } from '../llm/provider.ts';
import { guardImageSize } from '../llm/provider.ts';
import type { ToolRegistry } from '../actions/tools/registry.ts';
import { isToolResult } from '../actions/tools/registry.ts';
import type { ActionCategory } from '../roles/authority.ts';
import type { AuthorityEngine } from '../authority/engine.ts';
import type { AuditTrail } from '../authority/audit.ts';
import type { ApprovalManager, ApprovalRequest } from '../authority/approval.ts';
import type { EmergencyController } from '../authority/emergency.ts';
import { getActionForTool } from '../authority/tool-action-map.ts';
import type { AgentInstance } from '../agents/agent.ts';

const MAX_TOOL_RESULT_CHARS = 6000;

export interface ToolExecutorDeps {
  toolRegistry: ToolRegistry;
  emergencyController: EmergencyController | null;
  authorityEngine: AuthorityEngine | null;
  auditTrail: AuditTrail | null;
  approvalManager: ApprovalManager | null;
  getPrimary: () => AgentInstance | undefined;
  getTemporaryGrants: () => Map<string, ActionCategory[]>;
  onApprovalNeeded?: (request: ApprovalRequest) => void;
}

export class ToolExecutor {
  private deps: ToolExecutorDeps;

  constructor(deps: ToolExecutorDeps) {
    this.deps = deps;
  }

  /**
   * Execute a single tool call.
   * Returns a string for text-only results, or ContentBlock[] for multi-modal results.
   */
  async executeTool(toolCall: LLMToolCall): Promise<string | ContentBlock[]> {
    const { toolRegistry, emergencyController, authorityEngine, auditTrail, approvalManager, getPrimary, getTemporaryGrants, onApprovalNeeded } = this.deps;

    if (!toolRegistry) {
      return `Error: No tool registry configured`;
    }

    // --- Authority Gate ---

    // 1. Emergency check
    if (emergencyController && !emergencyController.canExecute()) {
      const state = emergencyController.getState();
      return `[SYSTEM ${state.toUpperCase()}] All tool execution is currently suspended. The user has ${state} the system.`;
    }

    // 2. Authority check
    const primary = getPrimary();
    if (authorityEngine && primary) {
      const tool = toolRegistry.get(toolCall.name);
      const actionCategory = getActionForTool(toolCall.name, tool?.category ?? 'unknown');

      const decision = authorityEngine.checkAuthority({
        agentId: primary.id,
        agentAuthorityLevel: primary.agent.authority.max_authority_level,
        agentRoleId: primary.agent.role.id,
        toolName: toolCall.name,
        toolCategory: tool?.category ?? 'unknown',
        actionCategory,
        temporaryGrants: getTemporaryGrants(),
      });

      // Determine decision type for audit
      const decisionType = decision.allowed
        ? (decision.requiresApproval ? 'approval_required' as const : 'allowed' as const)
        : 'denied' as const;

      // 3. Log to audit trail
      auditTrail?.log({
        agent_id: primary.id,
        agent_name: primary.agent.role.name,
        tool_name: toolCall.name,
        action_category: actionCategory,
        authority_decision: decisionType,
        approval_id: null,
        executed: decision.allowed && !decision.requiresApproval,
        execution_time_ms: null,
      });

      // 4. Denied
      if (!decision.allowed) {
        return `[AUTHORITY DENIED] Cannot execute ${toolCall.name}: ${decision.reason}. Your authority level is insufficient for ${actionCategory} actions.`;
      }

      // 5. Requires approval
      if (decision.requiresApproval && approvalManager) {
        const urgency = this.determineUrgency(actionCategory);
        const request = approvalManager.createRequest({
          agentId: primary.id,
          agentName: primary.agent.role.name,
          toolName: toolCall.name,
          toolArguments: toolCall.arguments,
          actionCategory,
          urgency,
          reason: decision.reason,
          context: `Agent attempted: ${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 200)})`,
        });

        // Emit approval request event
        onApprovalNeeded?.(request);

        return `[AWAITING_APPROVAL] Request #${request.id.slice(0, 8)} submitted. ` +
               `Action: ${toolCall.name} (${actionCategory}). ` +
               `Reason: ${decision.reason}. ` +
               `The user will be notified and can approve or deny this action.`;
      }
    }

    // --- Normal execution ---
    try {
      const startTime = Date.now();
      const raw = await toolRegistry.execute(toolCall.name, toolCall.arguments);
      const executionTimeMs = Date.now() - startTime;

      // Multi-modal result (e.g. screenshot with image data)
      if (isToolResult(raw)) {
        return raw.content.map(guardImageSize);
      }

      // Plain text result
      let result = typeof raw === 'string' ? raw : JSON.stringify(raw);

      // Cap tool result size to control context growth
      if (result.length > MAX_TOOL_RESULT_CHARS) {
        result = result.slice(0, MAX_TOOL_RESULT_CHARS) + `\n... (truncated, was ${result.length} chars)`;
      }

      // Surface tool-level errors clearly so the LLM doesn't treat them as success.
      if (/^(Error|Failed|Error executing)\b/i.test(result)) {
        return `[TOOL_ERROR] ${toolCall.name} reported a failure:\n${result}\n\nDo NOT assume the action succeeded. Tell the user what went wrong and ask how to proceed.`;
      }

      return result;
    } catch (err) {
      return `[TOOL_ERROR] ${toolCall.name} threw an exception:\n${err instanceof Error ? err.message : String(err)}\n\nDo NOT assume the action succeeded. Tell the user what went wrong and ask how to proceed.`;
    }
  }

  /**
   * Format a tool result for logging.
   */
  formatToolResult(result: string | ContentBlock[]): string {
    if (Array.isArray(result)) {
      return `[${result.length} content blocks]`;
    }
    return result.slice(0, 100);
  }

  /**
   * Format an error for the LLM/tool result context.
   */
  formatError(toolName: string, error: unknown): string {
    return `[TOOL_ERROR] ${toolName} threw an exception:\n${error instanceof Error ? error.message : String(error)}\n\nDo NOT assume the action succeeded. Tell the user what went wrong and ask how to proceed.`;
  }

  /**
   * Determine urgency for an approval request based on action category.
   */
  private determineUrgency(actionCategory: ActionCategory): 'urgent' | 'normal' {
    if (actionCategory === 'make_payment') return 'urgent';
    return 'normal';
  }

  /**
   * Verify that a tool action actually succeeded by checking the filesystem.
   * Returns an error message string if verification fails, null if everything is fine.
   * Returns null for tools where verification isn't applicable.
   */
  verifyToolEffect(toolName: string, args: Record<string, unknown>, result: unknown): string | null {
    if (toolName === 'write_file') {
      const filePath = args.path as string;
      if (!filePath) return null;
      try {
        const { existsSync } = require('fs');
        if (!existsSync(filePath)) {
          return `[VERIFICATION FAILED] I claimed the file was written successfully, but it does not exist at "${filePath}". The write operation may have failed silently.`;
        }
      } catch {
        return null;
      }
    }
    if (toolName === 'create_directory' || toolName === 'mkdir') {
      const dirPath = args.path as string;
      if (!dirPath) return null;
      try {
        const { existsSync } = require('fs');
        if (!existsSync(dirPath)) {
          return `[VERIFICATION FAILED] I claimed the directory was created, but it does not exist at "${dirPath}".`;
        }
      } catch {
        return null;
      }
    }
    return null;
  }
}


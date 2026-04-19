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
import { detectOS, type OS } from '../actions/platform.ts';

const MAX_TOOL_RESULT_CHARS = 6000;

/** Maximum tool-call loop iterations before aborting */
const MAX_EXECUTE_ATTEMPTS = 3;

/** Base delay for exponential backoff on transient errors (ms) */
const RETRY_BASE_MS = 500;

/** Maximum delay between retries (ms) */
const RETRY_MAX_MS = 8_000;

/** Pattern that identifies transient/retryable errors */
const TRANSIENT_PATTERN = /ECONNREFUSED|ETIMEDOUT|EBUSY|ENOLCK|EAGAIN|ENFILE|EMFILE|429|503|502|504/i;

function isTransient(msg: string): boolean {
  return TRANSIENT_PATTERN.test(msg);
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

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

    // --- Normal execution with transient-error retry ---
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_EXECUTE_ATTEMPTS; attempt++) {
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
        // Retry transient errors (lock, network, rate-limit)
        if (/^(Error|Failed|Error executing)\b/i.test(result)) {
          if (isTransient(result) && attempt < MAX_EXECUTE_ATTEMPTS) {
            const delay = Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), RETRY_MAX_MS);
            console.warn(`[ToolExecutor] Transient error in ${toolCall.name} (attempt ${attempt}), retrying in ${delay}ms...`);
            await sleep(delay);
            continue;
          }
          return `[TOOL_ERROR] ${toolCall.name} reported a failure:\n${result}\n\nDo NOT assume the action succeeded. Tell the user what went wrong and ask how to proceed.`;
        }

        return result;

      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        // Attempt auto-recovery before surfacing the error
        const [recovered, recoveredResult] = await this.tryAutoRecover(toolCall.name, toolCall.arguments, lastError);
        if (recovered) {
          return recoveredResult;
        }

        // Retry on transient errors
        if (isTransient(lastError) && attempt < MAX_EXECUTE_ATTEMPTS) {
          const delay = Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), RETRY_MAX_MS);
          console.warn(`[ToolExecutor] ${toolCall.name} threw transient error "${lastError}" (attempt ${attempt}), retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }

        return `[TOOL_ERROR] ${toolCall.name} threw an exception:
${lastError}

Do NOT assume the action succeeded. Tell the user what went wrong and ask how to proceed.`;
      }
    }
    return `[TOOL_ERROR] ${toolCall.name} failed after ${MAX_EXECUTE_ATTEMPTS} attempts: ${lastError}`;

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
  private detectOS(): OS {
    return detectOS();
  }

  /**
   * Verify that a tool action actually succeeded by checking the filesystem.
   * Returns an error message string if verification fails, null if everything is fine.
   * Covers: write_file, create_directory, delete_file, run_command.
   * Knows platform-specific paths and commands per OS.
   */
  verifyToolEffect(toolName: string, args: Record<string, unknown>, result: unknown): string | null {
    const os = this.detectOS();
    const strResult = typeof result === 'string' ? result : JSON.stringify(result);

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

    if (toolName === 'delete_file') {
      const filePath = args.path as string;
      if (!filePath) return null;
      try {
        const { existsSync } = require('fs');
        if (existsSync(filePath)) {
          return `[VERIFICATION FAILED] I claimed the file was deleted, but it still exists at "${filePath}". The deletion may have failed silently.`;
        }
      } catch {
        return null;
      }
    }

    if (toolName === 'run_command') {
      const command = (args.command as string || '').toLowerCase().trim();
      const exitCodeMatch = strResult.match(/\[exit code: (-?\d+)\]/);
      const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : null;

      // Non-zero exit code = real failure
      if (exitCode !== null && exitCode !== 0) {
        // Some commands legitimately return non-zero (e.g. grep with no matches)
        const okCodes: Record<string, number[]> = {
          grep: [1],    // grep 1 = no match found
          find: [1],    // find 1 = no matches
          diff: [1],    // diff 1 = files differ
          ls:   [2],    // ls 2 = permission error (real error)
        };
        const baseCmd = command.split(/\s+/)[0].replace(/^(git|sudo|doas)\s+/, '');
        const okExitCodes = Object.entries(okCodes).flatMap(([cmd, codes]) =>
          baseCmd.includes(cmd) ? codes : []
        );
        if (!okExitCodes.includes(exitCode)) {
          return `[VERIFICATION FAILED] Command "${command}" returned exit code ${exitCode}. I should have reported this as a failure to the user instead of treating it as success.`;
        }
      }

      // Detect common lie patterns — LLM claims success but command output says otherwise
      const claimedSuccess = !exitCode || exitCode === 0;
      if (claimedSuccess) {
        const liePatterns: Array<[RegExp, string]> = [
          [/created (file|directory|folder)/i, 'file/directory was supposedly created'],
          [/updated (file|config)/i, 'file was supposedly updated'],
          [/deleted? (file|directory)/i, 'file/directory was supposedly deleted'],
          [/installed (package|dependency)/i, 'package was supposedly installed'],
          [/no such file/i, 'command referenced a path that does not exist'],
          [/permission denied/i, 'permission denied — operation did not succeed'],
          [/command not found/i, 'command was not found — executable may not be installed'],
          [/cannot/i, 'command reported a cannot-do condition'],
        ];
        for (const [pattern, label] of liePatterns) {
          if (pattern.test(strResult)) {
            return `[VERIFICATION FAILED] I claimed success for "${command}", but the output contains "${label}". The operation may not have actually succeeded. Output was: ${strResult.slice(0, 200)}`;
          }
        }
      }
    }

    return null;
  }

  /**
   * Attempt to auto-correct a failed tool by trying an alternate approach.
   * Returns [success: boolean, result: string] tuple.
   */
  private tryAutoRecover(toolName: string, args: Record<string, unknown>, errorResult: string): Promise<[boolean, string]> {
    // write_file with ENOENT → create parent dirs and retry
    if (toolName === 'write_file' && /ENOENT|no such file or directory/i.test(errorResult)) {
      const filePath = args.path as string;
      if (filePath) {
        try {
          const { dirname } = require('path');
          const dir = dirname(filePath);
          const { mkdirSync, existsSync } = require('fs');
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
            // Re-attempt the write
            const { writeFileSync } = require('fs');
            writeFileSync(filePath, args.content as string, 'utf-8');
            return [true, `File written successfully: ${filePath} (auto-created parent directory)`];
          }
        } catch {
          // recovery failed, keep original error
        }
      }
    }
    return [false, errorResult];
  }
}


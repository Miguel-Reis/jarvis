/**
 * Background Agent Service — Independent Monitoring Brain
 *
 * Runs heartbeats, event reactions, and commitment executions on a
 * SEPARATE agent with its own browser instance (CDP port 9223).
 * User chat on the main AgentService is never blocked.
 *
 * Shares: LLMManager (same API keys), SQLite vault (same DB)
 * Separate: BrowserController, AgentOrchestrator, ToolRegistry, conversation history
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Service, ServiceStatus } from './services.ts';
import type { IAgentService } from './agent-service-interface.ts';
import type { JarvisConfig } from '../config/types.ts';
import type { RoleDefinition } from '../roles/types.ts';
import type { LLMManager } from '../llm/manager.ts';
import type { ResearchQueue } from './research-queue.ts';

import { AgentOrchestrator } from '../agents/orchestrator.ts';
import { loadRole } from '../roles/loader.ts';
import { ToolRegistry } from '../actions/tools/registry.ts';
import { NON_BROWSER_TOOLS, createBrowserTools } from '../actions/tools/builtin.ts';
import { BrowserController } from '../actions/browser/session.ts';
import { DESKTOP_TOOLS } from '../actions/tools/desktop.ts';
import { commitmentsTool } from '../actions/tools/commitments.ts';
import { researchQueueTool } from '../actions/tools/research.ts';
import { webSearchTool } from '../actions/tools/search.ts';
import { buildSystemPrompt, type PromptContext } from '../roles/prompt-builder.ts';
import { getDueCommitments, getUpcoming } from '../vault/commitments.ts';
import { getRecentObservations } from '../vault/observations.ts';
import { findContent } from '../vault/content-pipeline.ts';
import { getRecentConversation, getMessages } from '../vault/conversations.ts';
import { getActiveGoalsSummary } from '../vault/retrieval.ts';
import { getArchitecturalConstraints } from '../roles/prompt-builder.ts';
import { getActiveDirectivesFromVault } from '../vault/goals.ts';
import { getPreferencesForPrompt } from '../vault/user-preferences.ts';
import { getOrCreateCurrentProjectContext, getProjectContextForPrompt } from '../vault/project-contexts.ts';

const BG_CDP_PORT = 9223;
const BG_PROFILE_DIR = join(homedir(), '.jarvis', 'browser', 'bg-profile');

export class BackgroundAgentService implements Service, IAgentService {
  name = 'background-agent';
  private _status: ServiceStatus = 'stopped';
  private config: JarvisConfig;
  private llmManager: LLMManager;
  private orchestrator: AgentOrchestrator;
  private bgBrowser: BrowserController;
  private role: RoleDefinition | null = null;
  private researchQueue: ResearchQueue | null = null;
  private busy = false;

  constructor(config: JarvisConfig, llmManager: LLMManager) {
    this.config = config;
    this.llmManager = llmManager;
    this.orchestrator = new AgentOrchestrator();
    this.bgBrowser = new BrowserController(BG_CDP_PORT, BG_PROFILE_DIR);
  }

  setResearchQueue(queue: ResearchQueue): void {
    this.researchQueue = queue;
  }

  async start(): Promise<void> {
    this._status = 'starting';

    try {
      // 1. Wire shared LLM manager
      this.orchestrator.setLLMManager(this.llmManager);

      // 2. Load the same role as the main agent
      this.role = this.loadActiveRole();

      // 3. Build tool registry with background browser
      const toolRegistry = new ToolRegistry();

      for (const tool of NON_BROWSER_TOOLS) {
        toolRegistry.register(tool);
      }

      const bgBrowserTools = createBrowserTools(this.bgBrowser);
      for (const tool of bgBrowserTools) {
        toolRegistry.register(tool);
      }

      // Desktop tools (routed via sidecar RPC)
      for (const tool of DESKTOP_TOOLS) {
        toolRegistry.register(tool);
      }

      toolRegistry.register(commitmentsTool);
      toolRegistry.register(researchQueueTool);
      toolRegistry.register(webSearchTool);

      this.orchestrator.setToolRegistry(toolRegistry);

      // 4. Create primary agent for background operations
      this.orchestrator.createPrimary(this.role);

      this._status = 'running';
      console.log(`[BackgroundAgent] Started with role: ${this.role.name}, browser on port ${BG_CDP_PORT}`);
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async stop(): Promise<void> {
    this._status = 'stopping';
    const primary = this.orchestrator.getPrimary();
    if (primary) {
      this.orchestrator.terminateAgent(primary.id);
    }

    if (this.bgBrowser.connected) {
      await this.bgBrowser.disconnect();
    }

    this._status = 'stopped';
    console.log('[BackgroundAgent] Stopped');
  }

  status(): ServiceStatus {
    return this._status;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * Handle periodic heartbeat with full tool access.
   * Returns null if busy (non-blocking for the caller).
   */
  async handleHeartbeat(coalescedEvents?: string): Promise<string | null> {
    if (this.busy) {
      console.log('[BackgroundAgent] Skipping heartbeat — already busy');
      return null;
    }

    this.busy = true;
    try {
      const systemPrompt = this.buildHeartbeatPrompt(coalescedEvents);
      const parts: string[] = ['[HEARTBEAT] Periodic check-in. Review your responsibilities and take action.'];
      if (coalescedEvents) {
        parts.push('', coalescedEvents);
      }

      const response = await this.orchestrator.processMessage(systemPrompt, parts.join('\n'));
      if (response && response.trim().length > 0) {
        return response;
      }
      return null;
    } catch (err) {
      console.error('[BackgroundAgent] Heartbeat error:', err);
      return null;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Handle a reactive event message (from EventReactor / CommitmentExecutor).
   */
  async handleMessage(text: string, channel: string = 'system'): Promise<string> {
    if (!this.role) {
      throw new Error('Background agent not initialized — call start() first');
    }

    // Wait if busy — event reactor already has its own queue, so this is a safety net
    const waitStart = Date.now();
    const maxWaitMs = 60_000;
    const waitIntervalMs = 1000;
    let iterations = 0;
    const maxIterations = maxWaitMs / waitIntervalMs;

    while (this.busy && Date.now() - waitStart < maxWaitMs && iterations < maxIterations) {
      iterations++;
      await new Promise(r => setTimeout(r, waitIntervalMs));
    }

    if (this.busy) {
      console.warn('[BackgroundAgent] Timeout waiting for busy agent, queueing anyway');
    }

    this.busy = true;
    try {
      const systemPrompt = this.buildSystemPrompt(channel);
      return await this.orchestrator.processMessage(systemPrompt, text);
    } catch (err) {
      console.error('[BackgroundAgent] Message error:', err);
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.busy = false;
    }
  }

  // --- Private methods ---

  private buildSystemPrompt(channel: string): string {
    if (!this.role) return '';
    const context = this.buildPromptContext();
    return buildSystemPrompt(this.role, context);
  }

  /**
   * Get the last N messages from the most recent chat conversation.
   * Returns formatted chat transcript and staleness info.
   */
  private getRecentChatContext(messageCount: number = 20): {
    transcript: string | null;
    lastUserMessageAt: number | null;
    lastAssistantMessageAt: number | null;
    minutesSinceLastUserMessage: number | null;
  } {
    try {
      const recent = getRecentConversation('websocket');
      if (!recent) return { transcript: null, lastUserMessageAt: null, lastAssistantMessageAt: null, minutesSinceLastUserMessage: null };

      const messages = getMessages(recent.conversation.id, { limit: messageCount });
      if (messages.length === 0) return { transcript: null, lastUserMessageAt: null, lastAssistantMessageAt: null, minutesSinceLastUserMessage: null };

      // Find timestamps for staleness detection
      const now = Date.now();
      let lastUserAt: number | null = null;
      let lastAssistantAt: number | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]!;
        if (!lastUserAt && msg.role === 'user') lastUserAt = msg.created_at;
        if (!lastAssistantAt && msg.role === 'assistant') lastAssistantAt = msg.created_at;
        if (lastUserAt && lastAssistantAt) break;
      }

      // Format transcript
      const lines = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          const time = new Date(m.created_at).toLocaleTimeString();
          const role = m.role === 'user' ? 'USER' : 'JARVIS';
          // Truncate long messages to keep context manageable
          const content = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
          return `[${time}] ${role}: ${content}`;
        });

      return {
        transcript: lines.join('\n'),
        lastUserMessageAt: lastUserAt,
        lastAssistantMessageAt: lastAssistantAt,
        minutesSinceLastUserMessage: lastUserAt ? Math.round((now - lastUserAt) / 60_000) : null,
      };
    } catch (err) {
      console.error('[BackgroundAgent] Error loading chat context:', err);
      return { transcript: null, lastUserMessageAt: null, lastAssistantMessageAt: null, minutesSinceLastUserMessage: null };
    }
  }

  private buildHeartbeatPrompt(coalescedEvents?: string): string {
    if (!this.role) return '';

    const context = this.buildPromptContext();
    const rolePrompt = buildSystemPrompt(this.role, context);

    const parts = [rolePrompt, '', '# Heartbeat Check', this.role.heartbeat_instructions];

    // --- RECENT CHAT CONTEXT ---
    const chat = this.getRecentChatContext(20);
    if (chat.transcript) {
      parts.push('', '# RECENT CHAT (last 20 messages)');
      parts.push('Review this conversation for unfulfilled promises, unanswered questions, or implicit commitments.');
      parts.push('');
      parts.push(chat.transcript);

      // Staleness warning
      if (chat.minutesSinceLastUserMessage !== null && chat.minutesSinceLastUserMessage >= 120) {
        parts.push('');
        parts.push(`⚠ CONVERSATION STALE: Last user message was ${chat.minutesSinceLastUserMessage} minutes ago.`);
        parts.push('Consider a gentle proactive check-in if appropriate during active hours.');
      }

      // Detect if JARVIS was last to speak (may have promised something)
      if (chat.lastAssistantMessageAt && chat.lastUserMessageAt && chat.lastAssistantMessageAt > chat.lastUserMessageAt) {
        parts.push('');
        parts.push('NOTE: JARVIS was the last to speak. Check if that last message contained any promises, "I\'ll do X" statements, or tasks that may not have been completed.');
      }
    }

    // --- ACTIVE GOALS & DIRECTIVES ---
    try {
      // Get structured directives for goal-driven execution
      const directives = getActiveDirectivesFromVault();

      if (directives && directives.goal) {
        parts.push('', '# 🎯 CURRENT DIRECTIVE (Highest Priority Goal)');
        parts.push(`**Goal**: ${directives.goal.title} (${directives.goal.level})`);
        parts.push(`**Score**: ${directives.goal.score.toFixed(1)}/1.0 | **Health**: ${directives.goal.health}`);
        parts.push(`**Status**: ${directives.goal.status}`);

        if (directives.current_task) {
          parts.push('');
          parts.push('**CURRENT TASK** (execute this now):');
          parts.push(`- ${directives.current_task.description}`);
          parts.push(`  - Status: ${directives.current_task.status}`);
          parts.push(`  - Completion criteria: ${directives.current_task.completion_criteria}`);
          parts.push(`  - Attempts: ${directives.current_task.attempts}`);
        }

        if (directives.next_tasks && directives.next_tasks.length > 0) {
          parts.push('');
          parts.push('**NEXT TASKS** (queue after current):');
          for (const task of directives.next_tasks.slice(0, 5)) {
            parts.push(`- ${task.description} [${task.status}]`);
          }
        }

        if (directives.needs_decomposition) {
          parts.push('');
          parts.push('⚠️ **NEEDS DECOMPOSITION**: This goal has no sub-tasks. Break it down into actionable steps before executing.');
        }

        parts.push('');
        parts.push('Cross-reference with recent chat. If goals were discussed but not updated, flag it.');
      }

      // Also show full goals summary for context
      const goalsSummary = getActiveGoalsSummary();
      if (goalsSummary) {
        parts.push('', '# ALL ACTIVE GOALS');
        parts.push(goalsSummary);
      }
    } catch (err) {
      console.error('[BackgroundAgent] Error loading goal directives:', err);
      // Fallback to simple summary
      try {
        const goalsSummary = getActiveGoalsSummary();
        if (goalsSummary) {
          parts.push('', '# ACTIVE GOALS');
          parts.push(goalsSummary);
        }
      } catch {
        // Ignore
      }
    }

    if (coalescedEvents) {
      parts.push('', '# Recent System Events', coalescedEvents);
    }

    parts.push('', '# COMMITMENT EXECUTION');
    parts.push('If any commitments are overdue or due soon, EXECUTE them now using your tools.');
    parts.push('Do not just mention them — actually perform the work. Use browse, terminal, file operations as needed.');

    if (this.researchQueue && this.researchQueue.queuedCount() > 0) {
      const next = this.researchQueue.getNext();
      if (next) {
        parts.push('', '# BACKGROUND RESEARCH');
        parts.push(`You have a research topic queued: "${next.topic}"`);
        parts.push(`Reason: ${next.reason}`);
        parts.push(`Research ID: ${next.id}`);
        parts.push('If nothing urgent needs your attention, research this topic now.');
        parts.push('Use your browser and tools to gather information, then use the research_queue tool with action "complete" to save your findings.');
      }
    } else {
      parts.push('', '# IDLE MODE');
      parts.push('No research topics queued. If nothing urgent, you may:');
      parts.push('- Check news or trends relevant to the user');
      parts.push('- Review and organize pending tasks');
      parts.push('- Or simply report "All clear" if nothing needs attention');
    }

    parts.push('', '# Important', 'You have full tool access during this heartbeat. If you need to take action (browse the web, run commands, check files), DO IT. Be proactive and aggressive about helping.');

    return parts.join('\n');
  }

  private buildPromptContext(): PromptContext {
    const osPlatform = process.platform;
    const osName = osPlatform === 'win32' ? 'Windows' : osPlatform === 'darwin' ? 'macOS' : 'Linux';
    const context: PromptContext = {
      currentTime: new Date().toISOString(),
      systemEnvironment: {
        os: osName,
        shell: osPlatform === 'win32' ? (process.env.COMSPEC ?? 'powershell.exe') : (process.env.SHELL ?? '/bin/bash'),
        arch: process.arch,
      },
    };

    // Get due commitments
    try {
      const due = getDueCommitments();
      const upcoming = getUpcoming(5);
      const allCommitments = [...due, ...upcoming];

      if (allCommitments.length > 0) {
        context.activeCommitments = allCommitments.map((c) => {
          const dueStr = c.when_due
            ? ` (due: ${new Date(c.when_due).toLocaleString()})`
            : '';
          return `[${c.priority}] ${c.what}${dueStr} — ${c.status}`;
        });
      }
    } catch (err) {
      console.error('[BackgroundAgent] Error loading commitments:', err);
    }

    // Get active content pipeline items
    try {
      const activeContent = findContent({}).filter(
        (c) => c.stage !== 'published'
      ).slice(0, 10);
      if (activeContent.length > 0) {
        context.contentPipeline = activeContent.map((c) => {
          const tags = c.tags.length > 0 ? ` [${c.tags.join(', ')}]` : '';
          return `"${c.title}" (${c.content_type}) — ${c.stage}${tags}`;
        });
      }
    } catch (err) {
      console.error('[BackgroundAgent] Error loading content pipeline:', err);
    }

    // Get recent observations
    try {
      const observations = getRecentObservations(undefined, 10);
      if (observations.length > 0) {
        context.recentObservations = observations.map((o) => {
          const time = new Date(o.created_at).toLocaleTimeString();
          return `[${time}] ${o.type}: ${JSON.stringify(o.data).slice(0, 200)}`;
        });
      }
    } catch (err) {
      console.error('[BackgroundAgent] Error loading observations:', err);
    }

    // Get architectural constraints
    try {
      const constraints = getArchitecturalConstraints();
      if (constraints) {
        context.architecturalConstraints = constraints;
      }
    } catch (err) {
      console.error('[BackgroundAgent] Error loading architectural constraints:', err);
    }

    // Get user preferences (learned patterns)
    try {
      const preferences = getPreferencesForPrompt();
      if (preferences) {
        context.userPreferences = preferences;
      }
    } catch (err) {
      console.error('[BackgroundAgent] Error loading user preferences:', err);
    }

    // Get project context (multi-project switching)
    try {
      const projectCtx = getOrCreateCurrentProjectContext();
      if (projectCtx) {
        context.currentProject = {
          name: projectCtx.name,
          path: projectCtx.rootPath,
          description: projectCtx.description,
        };
        context.architecturalConstraints = getProjectContextForPrompt(projectCtx);
      }
    } catch (err) {
      console.error('[BackgroundAgent] Error loading project context:', err);
    }

    return context;
  }

  private loadActiveRole(): RoleDefinition {
    const roleName = this.config.active_role;

    // Package-root-relative paths for global install compatibility
    const pkgRoot = join(import.meta.dir, '../..');
    const paths = [
      join(pkgRoot, `roles/${roleName}.yaml`),
      join(pkgRoot, `roles/${roleName}.yml`),
      join(pkgRoot, `config/roles/${roleName}.yaml`),
      join(pkgRoot, `config/roles/${roleName}.yml`),
      // Also try CWD-relative for local dev
      `roles/${roleName}.yaml`,
      `roles/${roleName}.yml`,
    ];

    for (const rolePath of paths) {
      try {
        const role = loadRole(rolePath);
        console.log(`[BackgroundAgent] Loaded role '${role.name}' from ${rolePath}`);
        return role;
      } catch {
        // Try next path
      }
    }

    throw new Error(
      `[BackgroundAgent] Could not load role '${roleName}'. Searched: ${paths.join(', ')}`
    );
  }
}

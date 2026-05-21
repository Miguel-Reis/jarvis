/**
 * WebSocket Service — The Mouth
 *
 * Wraps WebSocketServer and StreamRelay. Routes incoming messages
 * to the AgentService and relays streamed responses back to clients.
 */

import type { ServerWebSocket } from 'bun';
import type { Service, ServiceStatus } from './types.ts';
import type { AgentService } from './agent-service.ts';
import type { CommitmentExecutor } from './commitment-executor.ts';
import type { ChannelService } from './channel-service.ts';
import type { Commitment } from '../vault/commitments.ts';
import type { ContentItem } from '../vault/content-pipeline.ts';
import type { STTProvider, TTSProvider } from '../comms/voice.ts';
import type { ContentBlock } from '../llm/provider.ts';
import { setDefaultCwd } from '../actions/tools/builtin.ts';
import type { ApprovalRequest } from '../authority/approval.ts';
import type { EmergencyState } from '../authority/emergency.ts';
import { createCommitment, updateCommitmentStatus, updateCommitmentAssignee } from '../vault/commitments.ts';
import { saveNotification } from '../vault/notifications.ts';
import { WebSocketServer, type WSMessage } from '../comms/websocket.ts';
import { StreamRelay } from '../comms/streaming.ts';
import { getOrCreateConversation, addMessage } from '../vault/conversations.ts';
import { saveMessage as saveThreadMessage, updateThreadTitle, getThread } from '../vault/threads.ts';
import { maybeCreateUserProfileFollowupPrompt, recordUserProfileTurn } from '../user/profile-followup.ts';
import { eventBus, DaemonEvents } from '../events/bus.ts';

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

type VoiceSession = {
  requestId: string;
  chunks: Buffer[];
  startedAt: number;
  maxBytes: number;  // 5MB limit to prevent DoS
  timeoutMs: number; // 30s timeout
};

/**
 * Wake-word detection hook for browser-based clients.
 * This is called when a client connects and requests wake-word activation.
 */
export class WebSocketService implements Service {
  name = 'websocket';
  private _status: ServiceStatus = 'stopped';
  private port: number;
  private agentService: AgentService;
  private wsServer: WebSocketServer;
  private streamRelay: StreamRelay;
  /** Tracks the commitment ID for the currently processing chat message */
  private activeTaskId: string | null = null;
  private commitmentExecutor: CommitmentExecutor | null = null;
  private channelService: ChannelService | null = null;
  private ttsProvider: TTSProvider | null = null;
  private sttProvider: STTProvider | null = null;
  private voiceSessions = new Map<ServerWebSocket<unknown>, VoiceSession>();
  private siteBuilderService: import('../sites/service.ts').SiteBuilderService | null = null;
  private triggerManager: import('../workflows/triggers/manager.ts').TriggerManager | null = null;
  /** Per-client rate limit: max 10 chat messages per 10-second window */
  private rateLimitMap = new Map<ServerWebSocket<unknown>, { count: number; windowStart: number }>();

  /** Periodic ping interval to keep connections alive and detect dead clients */
  private pingTimer: Timer | null = null;
  private static PING_INTERVAL_MS = 25_000; // 25 seconds

  constructor(port: number, agentService: AgentService) {
    this.port = port;
    this.agentService = agentService;
    this.wsServer = new WebSocketServer(port);
    this.streamRelay = new StreamRelay(this.wsServer);

    // Wire delegation callback via event bus: when PA delegates to a specialist,
    // update the active task's assigned_to on the task board
    eventBus.on(DaemonEvents.AGENT_DELEGATION, (specialistName, _task) => {
      if (!this.activeTaskId) return;
      try {
        const updated = updateCommitmentAssignee(this.activeTaskId, specialistName);
        if (updated) this.broadcastTaskUpdate(updated, 'updated');
      } catch (err) {
        console.error('[WSService] Failed to update task assignee:', err);
      }
    });

    // Legacy callback for backward compatibility
    this.agentService.setDelegationCallback((specialistName) => {
      eventBus.emit(DaemonEvents.AGENT_DELEGATION, specialistName, '');
    });
  }

  /**
   * Set the site builder service for project-scoped chat.
   */
  setSiteBuilderService(svc: import('../sites/service.ts').SiteBuilderService): void {
    this.siteBuilderService = svc;
  }

  /**
   * Set the trigger manager so incoming chat messages can fire `trigger.message` workflows.
   */
  setTriggerManager(tm: import('../workflows/triggers/manager.ts').TriggerManager): void {
    this.triggerManager = tm;
  }

  /**
   * Set the commitment executor for handling cancel commands.
   */
  setCommitmentExecutor(executor: CommitmentExecutor): void {
    this.commitmentExecutor = executor;
  }

  /**
   * Set the channel service for cross-channel broadcasts.
   */
  setChannelService(channelService: ChannelService): void {
    this.channelService = channelService;
  }

  /**
   * Set the TTS provider for voice responses.
   */
  setTTSProvider(provider: TTSProvider): void {
    this.ttsProvider = provider;
    console.log('[WSService] TTS provider set');
  }

  /**
   * Set the STT provider for voice input transcription.
   */
  setSTTProvider(provider: STTProvider): void {
    this.sttProvider = provider;
    console.log('[WSService] STT provider set');
  }

  /**
   * Set the voice loop service for low-latency voice interaction.
   */
  setVoiceLoopService(service: import('../services/voice-loop-service.ts').VoiceLoopService): void {
    // Wire STT/TTS providers to voice loop
    if (this.sttProvider) {
      service.setSTTProvider(this.sttProvider);
    }
    if (this.ttsProvider) {
      service.setTTSProvider(this.ttsProvider);
    }
    console.log('[WSService] Voice Loop Service wired');
  }

  /**
   * Get the underlying WebSocket server for direct broadcasting.
   */
  getServer(): WebSocketServer {
    return this.wsServer;
  }

  /**
   * Get the number of connected WebSocket clients.
   */
  getClientCount(): number {
    return this.wsServer.getClientCount();
  }

  /**
   * Register API route handlers on the underlying WebSocket server.
   * Must be called before start().
   */
  setApiRoutes(routes: Record<string, Record<string, (req: Request) => Response | Promise<Response>>>): void {
    this.wsServer.setApiRoutes(routes);
  }

  /**
   * Set directory for serving pre-built dashboard files.
   * Must be called before start().
   */
  setStaticDir(dir: string): void {
    this.wsServer.setStaticDir(dir);
  }

  setPublicDir(dir: string): void {
    this.wsServer.setPublicDir(dir);
  }

  setAuthToken(token: string): void {
    this.wsServer.setAuthToken(token);
  }

  async start(): Promise<void> {
    this._status = 'starting';

    try {
      // Set up message handler
      this.wsServer.setHandler({
        onMessage: (msg, ws) => this.routeMessage(msg, ws),
        onBinaryMessage: (data, ws) => this.handleVoiceAudio(data, ws),
        onConnect: (_ws) => {
          console.log('[WSService] Client connected');
        },
        onDisconnect: (ws) => {
          // Clean up any pending voice session for this client
          this.voiceSessions.delete(ws);
          this.rateLimitMap.delete(ws);
          console.log('[WSService] Client disconnected');
        },
      });

      // Start the server
      this.wsServer.start();

      // Start proactive ping timer to keep connections alive
      this.pingTimer = setInterval(() => {
        this.pingAllClients();
      }, WebSocketService.PING_INTERVAL_MS);

      this._status = 'running';
      console.log(`[WSService] Started on port ${this.port}`);
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async stop(): Promise<void> {
    this._status = 'stopping';
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.wsServer.stop();
    this._status = 'stopped';
    console.log('[WSService] Stopped');
  }

  status(): ServiceStatus {
    return this._status;
  }


  /**
   * Send a ping to all connected clients and track which respond.
   * Clients that don't respond within CLIENT_TIMEOUT_MS are terminated.
   */
  private pingAllClients(): void {
    if (!this.wsServer) return;
    const clients = (this.wsServer as any).clients;
    if (clients.size === 0) return;

    console.log(`[WSService] Ping to ${clients.size} client(s)`);
    for (const ws of clients) {
      try {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch (err) {
        console.warn('[WSService] Failed to ping client:', err);
      }
    }
  }

  /**
   * Broadcast a proactive heartbeat message to all connected clients
   * and external channels.
   */
  broadcastHeartbeat(text: string): void {
    const escapedText = escapeHtml(text);
    const message: WSMessage = {
      type: 'chat',
      payload: {
        text: escapedText,
        source: 'heartbeat',
      },
      priority: 'normal',
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);

    // Also push to external channels
    if (this.channelService) {
      this.channelService.broadcastToAll(escapedText).catch(err =>
        console.error('[WSService] Channel heartbeat broadcast error:', err)
      );
    }
  }

  /**
   * Broadcast a notification with priority level.
   * Used by EventReactor for immediate event reactions.
   * Urgent notifications are also pushed to all external channels.
   */
  broadcastNotification(text: string, priority: 'urgent' | 'normal' | 'low'): void {
    const escapedText = escapeHtml(text);
    const message: WSMessage = {
      type: 'chat',
      payload: {
        text: escapedText,
        source: 'proactive',
      },
      priority,
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);

    // Persist to notification history (raw text for storage)
    const firstLine = text.split('\n')[0]?.slice(0, 100) ?? '';
    const rest = text.length > firstLine.length ? text.slice(firstLine.length + 1).slice(0, 500) : '';
    try {
      saveNotification(firstLine, rest, {
        type: priority === 'urgent' ? 'warning' : 'info',
        source: 'proactive',
        priority,
      });
    } catch { /* non-fatal */ }

    // Push urgent notifications to external channels (Telegram, Discord)
    if (priority === 'urgent' && this.channelService) {
      this.channelService.broadcastToAll(`[URGENT] ${escapedText}`).catch(err =>
        console.error('[WSService] Channel broadcast error:', err)
      );
    }
  }

  /**
   * Broadcast task (commitment) changes to all connected clients.
   * Used for real-time task board updates.
   */
  broadcastTaskUpdate(task: Commitment, action: 'created' | 'updated' | 'deleted'): void {
    const message: WSMessage = {
      type: 'notification',
      payload: {
        source: 'task_update',
        action,
        task,
      },
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);
  }

  private broadcastAssistantMessage(text: string, requestId?: string): void {
    const message: WSMessage = {
      type: 'notification',
      payload: {
        source: 'assistant_message',
        text: escapeHtml(text),
      },
      id: requestId,
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);
  }

  /**
   * Broadcast content pipeline changes to all connected clients.
   * Used for real-time content pipeline updates.
   */
  broadcastContentUpdate(item: ContentItem, action: 'created' | 'updated' | 'deleted'): void {
    const message: WSMessage = {
      type: 'notification',
      payload: {
        source: 'content_update',
        action,
        item,
      },
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);
  }

  /**
   * Broadcast sub-agent progress events to all connected clients.
   * Used by the delegation system for real-time visibility.
   * Only broadcasts 'done' events to avoid chat spam.
   */
  broadcastSubAgentProgress(event: {
    type: 'text' | 'tool_call' | 'done';
    agentName: string;
    agentId: string;
    data: unknown;
  }): void {
    // Emit to event bus for decoupled listeners (internal tracking)
    eventBus.emit(DaemonEvents.AGENT_PROGRESS, event);

    // Only broadcast 'done' events to chat to avoid spam
    // 'text' and 'tool_call' events are too verbose for chat
    if (event.type !== 'done') {
      return;
    }

    const message: WSMessage = {
      type: 'stream',
      payload: {
        ...event,
        source: 'sub-agent',
      },
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);
  }

  /**
   * Broadcast an approval request to all connected dashboard clients.
   * Always pushed via WS; urgent requests are also sent to external channels.
   */
  broadcastApprovalRequest(request: ApprovalRequest): void {
    const shortId = request.id.slice(0, 8);
    const message: WSMessage = {
      type: 'notification',
      payload: {
        source: 'approval_request',
        request,
        shortId,
      },
      priority: request.urgency === 'urgent' ? 'urgent' : 'normal',
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);

    // Persist approval request to notification history
    try {
      saveNotification(
        `Approval needed: ${request.tool_name}`,
        `${request.agent_name} · ${request.action_category}${request.reason ? ` — ${request.reason}` : ''}`,
        { type: 'approval', source: 'authority', priority: request.urgency === 'urgent' ? 'urgent' : 'normal' }
      );
    } catch { /* non-fatal */ }

    // Push urgent approvals to external channels
    if (request.urgency === 'urgent' && this.channelService) {
      const text = `[APPROVAL NEEDED] ${request.agent_name} wants to run ${request.tool_name} (${request.action_category}).\nReason: ${request.reason}\nReply: approve ${shortId} / deny ${shortId}`;
      this.channelService.broadcastToAll(text).catch(err =>
        console.error('[WSService] Approval channel broadcast error:', err)
      );
    }
  }

  /**
   * Broadcast emergency state changes to all connected clients.
   */
  broadcastEmergencyState(state: EmergencyState): void {
    const message: WSMessage = {
      type: 'notification',
      payload: {
        source: 'emergency_state',
        state,
      },
      priority: 'urgent',
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);

    // Persist emergency state change
    try {
      saveNotification(
        `System emergency: ${state}`,
        `Emergency controller changed state to "${state}"`,
        { type: 'emergency', source: 'authority', priority: 'urgent' }
      );
    } catch { /* non-fatal */ }
  }

  /**
   * Broadcast an approval resolution (approved/denied/executed) to all clients.
   */
  /**
   * Broadcast an awareness event to all connected clients.
   */
  /**
   * Broadcast a sidecar event to all connected clients.
   */
  broadcastSidecarEvent(sidecarId: string, event: { type: string; data: Record<string, unknown>; timestamp: number }): void {
    const message: WSMessage = {
      type: 'notification',
      payload: {
        source: 'sidecar_event',
        sidecarId,
        event,
      },
      timestamp: event.timestamp,
    };
    this.wsServer.broadcast(message);
  }

  broadcastAwarenessEvent(event: { type: string; data: Record<string, unknown>; timestamp: number }): void {
    const message: WSMessage = {
      type: 'notification',
      payload: {
        source: 'awareness_event',
        event,
      },
      timestamp: event.timestamp,
    };
    this.wsServer.broadcast(message);
  }

  /**
   * Synthesize TTS for a proactive message and broadcast audio to all clients.
   * Used for awareness suggestions and other unsolicited voice notifications.
   */
  /**
   * Synthesize TTS for a proactive message and broadcast audio to all clients.
   * Used for awareness suggestions and other unsolicited voice notifications.
   */
  async broadcastProactiveVoice(text: string): Promise<void> {
    if (!this.ttsProvider || !text) {
      console.log(`[WSService] Proactive TTS skipped: ${!this.ttsProvider ? 'no TTS provider' : 'empty text'}`);
      return;
    }

    if (this.wsServer.getClientCount() === 0) {
      console.log('[WSService] Proactive TTS skipped: no connected clients');
      return;
    }

    try {
      const requestId = `proactive-${Date.now()}`;

      // Signal TTS start to all clients
      const startMsg: WSMessage = {
        type: 'tts_start',
        payload: { requestId },
        timestamp: Date.now(),
      };
      this.wsServer.broadcast(startMsg);

      let chunkCount = 0;
      for await (const chunk of this.ttsProvider.synthesizeStream(text)) {
        // Send binary audio to all connected clients
        for (const ws of this.wsServer.getClients()) {
          try {
            ws.sendBinary(chunk);
          } catch { /* client may have disconnected */ }
        }
        chunkCount++;
      }

      // Signal TTS end
      const endMsg: WSMessage = {
        type: 'tts_end',
        payload: { requestId },
        timestamp: Date.now(),
      };
      this.wsServer.broadcast(endMsg);
      console.log(`[WSService] Proactive TTS complete: "${text.slice(0, 60)}..." (${chunkCount} chunks)`);
    } catch (err) {
      console.error('[WSService] Proactive TTS error:', err instanceof Error ? err.message : err);
      // Still send tts_end so client doesn't get stuck
      try {
        this.wsServer.broadcast({ type: 'tts_end', payload: {}, timestamp: Date.now() });
      } catch { /* ignore */ }
    }
  }

  /**
   * Broadcast a workflow execution event to all connected clients.
   */
  broadcastWorkflowEvent(event: { type: string; workflowId: string; executionId?: string; nodeId?: string; data: Record<string, unknown>; timestamp: number }): void {
    const message: WSMessage = {
      type: 'workflow_event',
      payload: event,
      timestamp: event.timestamp,
    };
    this.wsServer.broadcast(message);
  }

  /**
   * Broadcast a goal event to all connected clients.
   */
  broadcastGoalEvent(event: { type: string; goalId?: string; data: Record<string, unknown>; timestamp: number }): void {
    const message: WSMessage = {
      type: 'goal_event',
      payload: event,
      timestamp: event.timestamp,
    };
    this.wsServer.broadcast(message);

    // Fire goal_update workflow triggers (non-blocking)
    if (event.goalId && this.triggerManager) {
      try { this.triggerManager.checkGoalEvent(event.goalId, event.type, event.data); } catch { /* non-critical */ }
    }
  }

  /**
   * Broadcast a coordination event to all connected clients.
   * Used for War Room real-time agent coordination visibility.
   */
  broadcastCoordinationEvent(event: { type: string; agentId?: string; data: Record<string, unknown>; timestamp: number }): void {
    const message: WSMessage = {
      type: 'coordination_event',
      payload: event,
      timestamp: event.timestamp,
    };
    this.wsServer.broadcast(message);
  }

  broadcastSiteEvent(event: { type: string; projectId: string; data: Record<string, unknown>; timestamp: number }): void {
    const message: WSMessage = {
      type: 'site_event',
      payload: event,
      timestamp: event.timestamp,
    };
    this.wsServer.broadcast(message);
  }

  /**
   * Format a FileEntry tree into a compact text listing.
   */
  private formatFileTree(entry: { name: string; path: string; type: 'file' | 'directory'; children?: { name: string; type: 'file' | 'directory' }[] }): string {
    const lines: string[] = [];
    if (entry.children) {
      for (const child of entry.children) {
        lines.push(child.type === 'directory' ? `${child.name}/` : child.name);
      }
    }
    return lines.join('\n') + '\n';
  }

  broadcastApprovalUpdate(request: ApprovalRequest): void {
    const message: WSMessage = {
      type: 'notification',
      payload: {
        source: 'approval_update',
        request,
      },
      timestamp: Date.now(),
    };
    this.wsServer.broadcast(message);
  }

  /**
   * Route incoming WebSocket messages to the appropriate handler.
   */
  private async routeMessage(msg: WSMessage, ws: ServerWebSocket<unknown>): Promise<WSMessage | void> {
    switch (msg.type) {
      case 'chat':
        return this.handleChat(msg, ws);

      case 'command':
        return this.handleCommand(msg);

      case 'status':
        return this.handleStatus();

      case 'voice_start': {
        const { requestId } = msg.payload as { requestId: string };
        this.voiceSessions.set(ws, {
          requestId,
          chunks: [],
          startedAt: Date.now(),
          maxBytes: 5 * 1024 * 1024,  // 5MB limit
          timeoutMs: 30_000,  // 30s timeout
        });
        return undefined;
      }

      case 'voice_end': {
        const session = this.voiceSessions.get(ws);
        if (!session) return undefined;
        this.voiceSessions.delete(ws);
        // Fire-and-forget: transcribe → process → TTS response
        this.handleVoiceSession(session, ws).catch(err =>
          console.error('[WSService] Voice session error:', err)
        );
        return undefined;
      }

      default:
        return {
          type: 'error',
          payload: { message: `Unknown message type: ${msg.type}` },
          timestamp: Date.now(),
        };
    }
  }

  /**
   * Handle chat messages — stream response via StreamRelay.
   * Auto-creates a task for non-trivial messages so the task board tracks agent work.
   * Supports optional thread_id for persistent threaded chat sessions.
   */
  private async handleChat(msg: WSMessage, ws?: ServerWebSocket<unknown>): Promise<WSMessage | void> {
    // Rate limit: max 10 chat messages per 10-second window per client
    if (ws) {
      const now = Date.now();
      const rl = this.rateLimitMap.get(ws) ?? { count: 0, windowStart: now };
      if (now - rl.windowStart > 10_000) {
        rl.count = 0;
        rl.windowStart = now;
      }
      rl.count++;
      this.rateLimitMap.set(ws, rl);
      if (rl.count > 10) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Rate limit exceeded. Please wait a moment.' }, timestamp: now }));
        return;
      }
    }

    const payload = msg.payload as { text?: string; content?: ContentBlock[]; channel?: string; projectId?: string; thread_id?: string };
    const projectId = payload?.projectId ?? null;
    const incomingThreadId = payload?.thread_id ?? null;

    // Support both plain text and multimodal content (text + images)
    let text = payload?.text ?? '';
    let contentBlocks: ContentBlock[] | undefined;

    if (Array.isArray(payload?.content) && payload.content.length > 0) {
      contentBlocks = payload.content;
      // Extract text parts for vault storage and task labels
      text = payload.content
        .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();
    }

    if (!text && !contentBlocks) {
      return {
        type: 'error',
        payload: { message: 'Missing text in chat payload' },
        id: msg.id,
        timestamp: Date.now(),
      };
    }

    const channel = payload.channel ?? 'websocket';
    const requestId = msg.id ?? crypto.randomUUID();

    // Build site builder system prompt context (injected into system prompt, not user message)
    let siteContext: string | undefined;
    if (projectId && this.siteBuilderService) {
      // Project-scoped chat (from the Site Builder page)
      const project = await this.siteBuilderService.getProjectWithStatus(projectId);
      if (project) {
        let fileTreeText = '';
        try {
          const tree = this.siteBuilderService.projectManager.getFileTree(projectId, 1);
          fileTreeText = this.formatFileTree(tree);
        } catch { /* ignore */ }

        siteContext = `# Site Builder Context

You are working on project "${project.name}" (${project.framework}).
- Path: ${project.path}
- Branch: ${project.gitBranch ?? 'main'}
- Dev server: ${project.status}
${project.githubUrl ? `- GitHub: ${project.githubUrl}` : ''}
${fileTreeText ? `\n## Project Structure\n\`\`\`\n${fileTreeText}\`\`\`` : ''}

## Rules
- Use site_read_file, site_write_file, site_list_files, site_run_command, site_git_commit, site_github_push tools with project_id="${projectId}".
- Do NOT use regular read_file, write_file, or run_command — always use the site_* variants.
- Do NOT start dev servers via site_run_command. The dev server is managed by the dashboard (make dev runs automatically).
- Changes are auto-committed after this conversation turn completes.
- For the "bun-react" framework: the server uses Bun.serve() with HTML imports (import from "./index.html"). Run with "bun --hot index.ts", NOT vite or webpack.`;
      }
    } else if (this.siteBuilderService) {
      // General chat (main dashboard) — give the LLM awareness of site builder projects
      try {
        const projects = await this.siteBuilderService.listProjectsWithStatus();
        if (projects.length > 0) {
          const projectList = projects.map(p =>
            `  - "${p.name}" (id: ${p.id}, framework: ${p.framework}, branch: ${p.gitBranch ?? 'main'}${p.githubUrl ? `, github: ${p.githubUrl}` : ''})`
          ).join('\n');

          siteContext = `# Site Builder

You have access to the Site Builder feature with ${projects.length} project(s):
${projectList}

You can work on any of these projects using site builder tools (site_read_file, site_write_file, site_list_files, site_run_command, site_git_commit, site_github_push) by passing the project's id as project_id.
When the user asks you to build, edit, or work on a website/app, use these tools to make changes directly in the project files.
If the user wants to create a new project, tell them to use the Site Builder page (Sites tab in the sidebar) to create one first.`;
        }
      } catch { /* ignore — site builder may not be fully started */ }
    }

    // Fire message-based workflow triggers (non-blocking)
    if (text && this.triggerManager) {
      try { this.triggerManager.checkMessage(text, channel); } catch { /* non-critical */ }
    }

    // Auto-create a task for non-trivial messages
    const taskText = text || (contentBlocks ? '[image message]' : '');
    const isTrivial = taskText.trim().length < 10 && !contentBlocks;
    let taskCommitment: Commitment | null = null;

    if (!isTrivial) {
      try {
        const taskLabel = taskText.length > 80 ? taskText.slice(0, 77) + '...' : taskText;
        taskCommitment = createCommitment(taskLabel, {
          assigned_to: 'jarvis',
          created_from: 'user',
        });
        updateCommitmentStatus(taskCommitment.id, 'active');
        taskCommitment.status = 'active';
        this.activeTaskId = taskCommitment.id;
        this.broadcastTaskUpdate(taskCommitment, 'created');
      } catch (err) {
        console.error('[WSService] Failed to auto-create task:', err);
      }
    }

    // Persist user message — use explicit thread when provided, else fall back to legacy per-channel conversation
    try {
      let conversationId: string;

      if (incomingThreadId) {
        // Validate the thread exists
        const thread = getThread(incomingThreadId);
        if (!thread) {
          return {
            type: 'error',
            payload: { message: `Thread not found: ${incomingThreadId}` },
            id: requestId,
            timestamp: Date.now(),
          };
        }
        conversationId = incomingThreadId;
        // Auto-title thread from first user message if untitled
        if (!thread.title) {
          const autoTitle = text.length > 80 ? text.slice(0, 77) + '…' : text;
          updateThreadTitle(incomingThreadId, autoTitle);
        }
        saveThreadMessage(conversationId, 'user', text);
      } else {
        // Legacy: get-or-create the rolling conversation for the channel
        const conversation = getOrCreateConversation(channel);
        conversationId = conversation.id;
        addMessage(conversationId, { role: 'user', content: text });
      }

      recordUserProfileTurn(text);

      // Set default cwd for general tools (run_command, read_file, etc.)
      // so they operate in the project directory during site builder conversations
      if (projectId && this.siteBuilderService) {
        const projectPath = this.siteBuilderService.projectManager.getProjectPath(projectId);
        setDefaultCwd(projectPath);
      }

      const { stream, onComplete } = await this.agentService.streamMessage(text, channel, siteContext, contentBlocks);

      // Set up streaming TTS: speak sentences as they arrive
      const ttsActive = !!(this.ttsProvider && ws);
      let ttsSentenceQueue: string[] = [];
      let ttsSpeaking = false;
      let ttsStartSent = false;
      let ttsStreamFullyDone = false; // set AFTER relayStream returns, not per-turn 'done'
      let ttsSentenceCount = 0;
      let ttsChunkCount = 0;

      const speakNextSentence = async () => {
        if (ttsSpeaking || !ttsActive || !ws) return;
        const sentence = ttsSentenceQueue.shift();
        if (!sentence) {
          // Queue empty — send tts_end only if stream is fully done
          if (ttsStreamFullyDone && ttsStartSent) {
            console.log(`[WSService] TTS complete: ${ttsSentenceCount} sentences, ${ttsChunkCount} audio chunks`);
            this.wsServer.sendToClient(ws, {
              type: 'tts_end',
              payload: { requestId },
              id: requestId,
              timestamp: Date.now(),
            });
            ttsStartSent = false; // prevent duplicate tts_end
          }
          return;
        }

        // Send tts_start exactly once before the first audio chunk
        if (!ttsStartSent) {
          ttsStartSent = true;
          this.wsServer.sendToClient(ws, {
            type: 'tts_start',
            payload: { requestId },
            id: requestId,
            timestamp: Date.now(),
          });
        }

        ttsSpeaking = true;
        ttsSentenceCount++;
        try {
          if (this.ttsProvider) {
            for await (const chunk of this.ttsProvider.synthesizeStream(sentence)) {
              ttsChunkCount++;
              this.wsServer.sendBinary(ws, chunk);
            }
          }
        } catch (err) {
          console.error('[WSService] TTS sentence error:', err);
        }
        ttsSpeaking = false;
        speakNextSentence();
      };

      // Relay stream to all WebSocket clients, collect full text.
      // onSentence fires for each complete sentence during streaming.
      // NOTE: onTextDone fires per LLM turn (tool loop), NOT once at the end.
      // We ignore onTextDone and use the relayStream return to mark stream completion.
      const fullText = await this.streamRelay.relayStream(stream, requestId, ttsActive ? {
        onSentence: (sentence) => {
          ttsSentenceQueue.push(sentence);
          speakNextSentence();
        },
      } : undefined);

      // Stream is now fully done (all tool loop turns complete)
      ttsStreamFullyDone = true;
      if (ttsActive) {
        if (!ttsSpeaking && ttsSentenceQueue.length === 0 && ttsStartSent) {
          // Everything already played, send tts_end now
          this.wsServer.sendToClient(ws!, {
            type: 'tts_end',
            payload: { requestId },
            id: requestId,
            timestamp: Date.now(),
          });
          ttsStartSent = false;
        }
        // Otherwise speakNextSentence will send tts_end when queue drains
      }

      // Persist assistant response using the same thread-aware path
      if (incomingThreadId) {
        saveThreadMessage(conversationId, 'assistant', fullText);
      } else {
        addMessage(conversationId, { role: 'assistant', content: fullText });
      }

      const followupPrompt = maybeCreateUserProfileFollowupPrompt();
      if (followupPrompt) {
        this.broadcastAssistantMessage(followupPrompt);
        if (incomingThreadId) {
          saveThreadMessage(conversationId, 'assistant', followupPrompt);
        } else {
          addMessage(conversationId, { role: 'assistant', content: followupPrompt });
        }
      }

      // Mark task as completed
      if (taskCommitment) {
        try {
          const resultSummary = fullText.length > 200 ? fullText.slice(0, 197) + '...' : fullText;
          const updated = updateCommitmentStatus(taskCommitment.id, 'completed', resultSummary);
          if (updated) this.broadcastTaskUpdate(updated, 'updated');
        } catch (err) {
          console.error('[WSService] Failed to complete task:', err);
        } finally {
          this.activeTaskId = null;
        }
      }

      // Clear site builder default cwd now that the turn is done
      setDefaultCwd(null);

      // Fire-and-forget: run post-processing (extraction, personality)
      onComplete(fullText).catch((err) =>
        console.error('[WSService] onComplete error:', err)
      );

      // Auto-commit site builder changes after chat turn
      if (projectId && this.siteBuilderService) {
        try {
          const projectPath = this.siteBuilderService.projectManager.getProjectPath(projectId);
          if (projectPath) {
            const commitMsg = text.length > 60 ? text.slice(0, 57) + '...' : text;
            const commit = await this.siteBuilderService.gitManager.autoCommit(projectPath, commitMsg);
            if (commit) {
              this.broadcastSiteEvent({
                type: 'git_commit',
                projectId,
                data: { commit },
                timestamp: Date.now(),
              });
            }
          }
        } catch (err) {
          console.error('[WSService] Site builder auto-commit error:', err);
        }
      }

      // Don't return a direct response — StreamRelay already broadcast everything
      return undefined;
    } catch (error) {
      console.error('[WSService] Chat error:', error);

      // Mark task as failed
      if (taskCommitment) {
        try {
          const reason = error instanceof Error ? error.message : 'Processing failed';
          const updated = updateCommitmentStatus(taskCommitment.id, 'failed', reason);
          if (updated) this.broadcastTaskUpdate(updated, 'updated');
        } catch (err) {
          console.error('[WSService] Failed to fail task:', err);
        } finally {
          this.activeTaskId = null;
        }
      }

      return {
        type: 'error',
        payload: {
          message: error instanceof Error ? error.message : 'Chat processing failed',
        },
        id: requestId,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Handle binary audio data from voice recording.
   * Accumulates chunks into the active voice session for this client.
   * Enforces size limit and timeout to prevent DoS attacks.
   */
  private async handleVoiceAudio(data: Buffer, ws: ServerWebSocket<unknown>): Promise<void> {
    const session = this.voiceSessions.get(ws);
    if (!session) {
      console.warn('[WSService] Binary audio received with no active voice session');
      return;
    }

    // Check timeout
    const elapsed = Date.now() - session.startedAt;
    if (elapsed > session.timeoutMs) {
      this.voiceSessions.delete(ws);
      this.wsServer.sendToClient(ws, {
        type: 'error',
        payload: { message: 'Voice session timeout. Please try again.' },
        timestamp: Date.now(),
      });
      return;
    }

    // Check size limit
    const totalSize = session.chunks.reduce((sum, b) => sum + b.length, 0) + data.length;
    if (totalSize > session.maxBytes) {
      this.voiceSessions.delete(ws);
      this.wsServer.sendToClient(ws, {
        type: 'error',
        payload: { message: 'Voice audio too large. Please send shorter messages.' },
        timestamp: Date.now(),
      });
      console.warn('[WSService] Voice buffer overflow - rejected chunk');
      return;
    }

    session.chunks.push(data);
  }

  /**
   * Process a completed voice session: STT → chat → TTS response.
   * Validates session timeout before processing.
   */
  private async handleVoiceSession(session: VoiceSession, ws: ServerWebSocket<unknown>): Promise<void> {
    if (!this.sttProvider) {
      this.wsServer.sendToClient(ws, {
        type: 'error',
        payload: { message: 'STT not configured. Enable it in Settings > Channels.' },
        timestamp: Date.now(),
      });
      return;
    }

    // Validate timeout before processing
    const elapsed = Date.now() - session.startedAt;
    if (elapsed > session.timeoutMs) {
      this.wsServer.sendToClient(ws, {
        type: 'error',
        payload: { message: 'Voice session expired. Please try again.' },
        timestamp: Date.now(),
      });
      return;
    }

    const audioBuffer = Buffer.concat(session.chunks);
    if (audioBuffer.length === 0) return;

    try {
      const transcript = await this.sttProvider.transcribe(audioBuffer);
      if (!transcript.trim()) return;

      console.log('[WSService] Voice transcript:', transcript);

      // Echo transcript back so the UI shows it as a user message
      this.wsServer.sendToClient(ws, {
        type: 'chat',
        payload: { text: transcript, source: 'voice_transcript' },
        id: session.requestId,
        timestamp: Date.now(),
      });

      // Reuse existing chat flow
      await this.handleChat({
        type: 'chat',
        payload: { text: transcript },
        id: session.requestId,
        timestamp: Date.now(),
      }, ws);
    } catch (err) {
      console.error('[WSService] STT error:', err);
      const message = err instanceof Error ? err.message : 'Voice transcription failed';
      this.wsServer.sendToClient(ws, {
        type: 'error',
        payload: { message },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle system commands.
   */
  private async handleCommand(msg: WSMessage): Promise<WSMessage> {
    const payload = msg.payload as { command?: string };
    const command = payload?.command;

    switch (command) {
      case 'health':
        return {
          type: 'status',
          payload: {
            status: 'ok',
            service: this.name,
            clients: this.wsServer.getClientCount(),
          },
          id: msg.id,
          timestamp: Date.now(),
        };

      case 'ping':
        return {
          type: 'status',
          payload: { pong: true },
          id: msg.id,
          timestamp: Date.now(),
        };

      case 'cancel_execution': {
        const commitmentId = (msg.payload as { commitmentId?: string })?.commitmentId;
        if (this.commitmentExecutor && commitmentId) {
          const cancelled = this.commitmentExecutor.cancelExecution(commitmentId);
          return {
            type: 'status',
            payload: { cancelled, commitmentId },
            id: msg.id,
            timestamp: Date.now(),
          };
        }
        return {
          type: 'error',
          payload: { message: 'No executor available or missing commitmentId' },
          id: msg.id,
          timestamp: Date.now(),
        };
      }

      default:
        return {
          type: 'error',
          payload: { message: `Unknown command: ${command}` },
          id: msg.id,
          timestamp: Date.now(),
        };
    }
  }

  /**
   * Handle status requests.
   */
  private handleStatus(): WSMessage {
    return {
      type: 'status',
      payload: {
        service: this.name,
        status: this._status,
        clients: this.wsServer.getClientCount(),
        port: this.port,
      },
      timestamp: Date.now(),
    };
  }
}

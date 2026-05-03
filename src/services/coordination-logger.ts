/**
 * Coordination Logger
 *
 * Logs inter-agent communications and task coordination events.
 * Provides real-time visibility into multi-agent workflows.
 */

import { getDb, generateId } from '../vault/schema.ts';

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'blocked' | 'completed';

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  currentTask?: string;
  parentAgent?: string;
  createdAt: number;
  lastActiveAt: number;
  tasksCompleted: number;
  tasksFailed: number;
}

export type CoordinationEventType =
  | 'agent_spawned'
  | 'task_assigned'
  | 'task_completed'
  | 'task_failed'
  | 'message_sent'
  | 'message_received'
  | 'escalation'
  | 'coordination_request'
  | 'resource_acquired'
  | 'resource_released'
  | 'blocked'
  | 'unblocked';

export interface CoordinationEvent {
  id: string;
  type: CoordinationEventType;
  fromAgent?: string;
  toAgent?: string;
  taskId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export class CoordinationLogger {
  private agentStates: Map<string, AgentState> = new Map();
  private eventListeners: Set<(event: CoordinationEvent) => void> = new Set();

  /**
   * Register an agent
   */
  registerAgent(agent: AgentState): void {
    this.agentStates.set(agent.id, agent);
    this.logEvent({
      id: generateId(),
      type: 'agent_spawned',
      toAgent: agent.id,
      data: { name: agent.name },
      timestamp: Date.now(),
    });
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    this.agentStates.delete(agentId);
  }

  /**
   * Get all active agents
   */
  getActiveAgents(): AgentState[] {
    return Array.from(this.agentStates.values());
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, status: AgentStatus, currentTask?: string): void {
    const agent = this.agentStates.get(agentId);
    if (!agent) return;

    agent.status = status;
    agent.lastActiveAt = Date.now();
    if (currentTask) agent.currentTask = currentTask;

    this.logEvent({
      id: generateId(),
      type: status === 'blocked' ? 'blocked' : 'message_sent',
      fromAgent: agentId,
      data: { status, currentTask },
      timestamp: Date.now(),
    });
  }

  /**
   * Log task assignment
   */
  logTaskAssignment(taskId: string, agentId: string, taskDescription: string): void {
    this.logEvent({
      id: generateId(),
      type: 'task_assigned',
      toAgent: agentId,
      taskId,
      data: { description: taskDescription },
      timestamp: Date.now(),
    });
  }

  /**
   * Log task completion
   */
  logTaskCompletion(taskId: string, agentId: string, success: boolean, result?: string): void {
    const agent = this.agentStates.get(agentId);
    if (agent) {
      if (success) agent.tasksCompleted++;
      else agent.tasksFailed++;
    }

    this.logEvent({
      id: generateId(),
      type: success ? 'task_completed' : 'task_failed',
      fromAgent: agentId,
      taskId,
      data: { result, success },
      timestamp: Date.now(),
    });
  }

  /**
   * Log inter-agent message
   */
  logMessage(fromAgent: string, toAgent: string, message: string, requiresResponse = false): void {
    this.logEvent({
      id: generateId(),
      type: requiresResponse ? 'coordination_request' : 'message_sent',
      fromAgent,
      toAgent,
      data: { message, requiresResponse },
      timestamp: Date.now(),
    });
  }

  /**
   * Log escalation
   */
  logEscalation(fromAgent: string, toAgent: string, reason: string): void {
    this.logEvent({
      id: generateId(),
      type: 'escalation',
      fromAgent,
      toAgent,
      data: { reason },
      timestamp: Date.now(),
    });
  }

  /**
   * Log event to database and notify listeners
   */
  private logEvent(event: CoordinationEvent): void {
    // Persist to database
    try {
      const db = getDb();
      const stmt = db.prepare(`
        INSERT INTO agent_messages (id, from_agent, to_agent, type, content, priority, requires_response, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        event.id,
        event.fromAgent ?? 'system',
        event.toAgent ?? 'system',
        this.mapEventType(event.type),
        JSON.stringify(event.data),
        this.mapEventPriority(event.type),
        event.type === 'coordination_request' ? 1 : 0,
        event.timestamp
      );
    } catch (err) {
      console.error('[CoordinationLogger] Failed to persist event:', err instanceof Error ? err.message : err);
    }

    // Notify listeners
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private mapEventType(type: CoordinationEventType): string {
    switch (type) {
      case 'agent_spawned': return 'task';
      case 'task_assigned': return 'task';
      case 'task_completed': return 'report';
      case 'task_failed': return 'escalation';
      case 'message_sent':
      case 'message_received':
      case 'coordination_request': return 'question';
      case 'escalation': return 'escalation';
      default: return 'task';
    }
  }

  private mapEventPriority(type: CoordinationEventType): string {
    switch (type) {
      case 'escalation':
      case 'task_failed': return 'urgent';
      case 'blocked': return 'high';
      case 'task_assigned':
      case 'coordination_request': return 'normal';
      default: return 'low';
    }
  }

  /**
   * Register event listener for real-time updates
   */
  onEvent(listener: (event: CoordinationEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Get recent events from database
   */
  getRecentEvents(limit = 100): CoordinationEvent[] {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        SELECT * FROM agent_messages
        ORDER BY created_at DESC
        LIMIT ?
      `);
      const rows = stmt.all(limit) as any[];

      return rows.map(row => ({
        id: row.id,
        type: this.mapDatabaseTypeToEventType(row.type),
        fromAgent: row.from_agent === 'system' ? undefined : row.from_agent,
        toAgent: row.to_agent === 'system' ? undefined : row.to_agent,
        taskId: undefined,
        data: JSON.parse(row.content || '{}'),
        timestamp: row.created_at,
      }));
    } catch (err) {
      console.error('[CoordinationLogger] Failed to get events:', err);
      return [];
    }
  }

  private mapDatabaseTypeToEventType(type: string): CoordinationEventType {
    switch (type) {
      case 'task': return 'task_assigned';
      case 'report': return 'task_completed';
      case 'question': return 'message_sent';
      case 'escalation': return 'escalation';
      default: return 'message_sent';
    }
  }
}

// Singleton
let instance: CoordinationLogger | null = null;

export function getCoordinationLogger(): CoordinationLogger {
  if (!instance) {
    instance = new CoordinationLogger();
  }
  return instance;
}

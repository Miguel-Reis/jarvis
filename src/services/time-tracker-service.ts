/**
 * Time Tracker Service
 *
 * Tracks time spent on tasks, goals, and projects.
 * Automatically logs time entries when agent starts/completes work.
 */

import { getDb, generateId } from '../vault/schema.ts';

export interface TimeEntry {
  id: string;
  taskId?: string;
  goalId?: string;
  projectId?: string;
  agentId: string;
  activityType: 'work' | 'research' | 'review' | 'coordination' | 'idle';
  description?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ActiveSession {
  agentId: string;
  taskId?: string;
  goalId?: string;
  projectId?: string;
  activityType: TimeEntry['activityType'];
  startedAt: number;
  description?: string;
}

export class TimeTrackerService {
  private activeSessions: Map<string, ActiveSession> = new Map();

  /**
   * Start tracking time for an agent/task
   */
  startSession(
    agentId: string,
    options?: {
      taskId?: string;
      goalId?: string;
      projectId?: string;
      activityType?: TimeEntry['activityType'];
      description?: string;
    }
  ): void {
    // End existing session for this agent if any
    this.endSession(agentId);

    const session: ActiveSession = {
      agentId,
      taskId: options?.taskId,
      goalId: options?.goalId,
      projectId: options?.projectId,
      activityType: options?.activityType ?? 'work',
      startedAt: Date.now(),
      description: options?.description,
    };

    this.activeSessions.set(agentId, session);
    console.log(`[TimeTracker] Session started for ${agentId}: ${options?.activityType ?? 'work'}`);
  }

  /**
   * End tracking session and persist entry
   */
  endSession(agentId: string): TimeEntry | null {
    const session = this.activeSessions.get(agentId);
    if (!session) return null;

    const durationMs = Date.now() - session.startedAt;
    const entry: TimeEntry = {
      id: generateId(),
      taskId: session.taskId,
      goalId: session.goalId,
      projectId: session.projectId,
      agentId: session.agentId,
      activityType: session.activityType,
      description: session.description,
      startedAt: session.startedAt,
      endedAt: Date.now(),
      durationMs,
    };

    // Persist to database
    try {
      const db = getDb();
      const stmt = db.prepare(`
        INSERT INTO time_entries (id, task_id, goal_id, project_id, agent_id, activity_type, description, started_at, ended_at, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        entry.id,
        entry.taskId ?? null,
        entry.goalId ?? null,
        entry.projectId ?? null,
        entry.agentId,
        entry.activityType,
        entry.description ?? null,
        entry.startedAt,
        entry.endedAt ?? Date.now(),
        entry.durationMs ?? 0,
        Date.now()
      );
    } catch (err) {
      console.error('[TimeTracker] Failed to persist entry:', err instanceof Error ? err.message : err);
    }

    this.activeSessions.delete(agentId);
    console.log(`[TimeTracker] Session ended for ${agentId}: ${(durationMs / 1000).toFixed(1)}s`);

    return entry;
  }

  /**
   * Get active session for agent
   */
  getActiveSession(agentId: string): ActiveSession | null {
    return this.activeSessions.get(agentId) ?? null;
  }

  /**
   * Get time entries for a goal
   */
  getEntriesForGoal(goalId: string, limit = 100): TimeEntry[] {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        SELECT * FROM time_entries
        WHERE goal_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      stmt.run(goalId, limit);
      return stmt.all() as unknown as TimeEntry[];
    } catch (err) {
      console.error('[TimeTracker] Failed to get entries for goal:', err);
      return [];
    }
  }

  /**
   * Get time entries for a project
   */
  getEntriesForProject(projectId: string, limit = 100): TimeEntry[] {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        SELECT * FROM time_entries
        WHERE project_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `);
      stmt.run(projectId, limit);
      return stmt.all() as unknown as TimeEntry[];
    } catch (err) {
      console.error('[TimeTracker] Failed to get entries for project:', err);
      return [];
    }
  }

  /**
   * Get time entries for a date range
   */
  getEntriesForRange(startMs: number, endMs: number, agentId?: string): TimeEntry[] {
    try {
      const db = getDb();
      let sql = `
        SELECT * FROM time_entries
        WHERE started_at >= ? AND started_at <= ?
      `;
      const params: (number | string)[] = [startMs, endMs];

      if (agentId) {
        sql += ` AND agent_id = ?`;
        params.push(agentId);
      }

      sql += ` ORDER BY started_at DESC`;

      const stmt = db.prepare(sql);
      return stmt.all(...params) as unknown as TimeEntry[];
    } catch (err) {
      console.error('[TimeTracker] Failed to get entries for range:', err);
      return [];
    }
  }

  /**
   * Get total time spent on a goal
   */
  getTotalTimeForGoal(goalId: string): number {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        SELECT COALESCE(SUM(duration_ms), 0) as total_ms
        FROM time_entries
        WHERE goal_id = ?
      `);
      const result = stmt.get(goalId) as { total_ms: number };
      return result.total_ms;
    } catch (err) {
      console.error('[TimeTracker] Failed to get total time for goal:', err);
      return 0;
    }
  }

  /**
   * Get total time spent today
   */
  getTotalTimeToday(agentId?: string): number {
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.getEntriesForRange(startOfDay.getTime(), now, agentId)
      .reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0);
  }
}

// Singleton instance
let instance: TimeTrackerService | null = null;

export function getTimeTracker(): TimeTrackerService {
  if (!instance) {
    instance = new TimeTrackerService();
  }
  return instance;
}

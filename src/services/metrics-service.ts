/**
 * Metrics Service
 *
 * Aggregates productivity metrics from time entries and task history.
 * Provides data for dashboard visualizations.
 */

import { getDb } from '../vault/schema.ts';
import { getTimeTracker } from './time-tracker.ts';

export interface DailyMetrics {
  date: string;
  tasksCompleted: number;
  tasksFailed: number;
  timeActiveMs: number;
  timeIdleMs: number;
  interruptions: number;
  velocityScore: number;
  focusScore: number;
}

export interface WeeklyMetrics {
  weekStart: string;
  weekEnd: string;
  totalTasksCompleted: number;
  totalHours: number;
  avgDailyVelocity: number;
  trendDirection: 'up' | 'down' | 'stable';
}

export interface ProjectMetrics {
  projectId: string;
  projectName?: string;
  totalHours: number;
  tasksCompleted: number;
  progressRate: number;
  estimatedCompletion?: number;
}

export class MetricsService {
  /**
   * Calculate daily metrics for a specific date
   */
  calculateDailyMetrics(date: string, agentId: string | undefined): DailyMetrics {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const db = getDb();

      // Get task stats (agentId filter handled in caller for simplicity)
      const taskStmt = agentId
        ? db.prepare(`
            SELECT
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM task_history
            WHERE created_at >= ? AND created_at <= ? AND agent_id = ?
          `)
        : db.prepare(`
            SELECT
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM task_history
            WHERE created_at >= ? AND created_at <= ?
          `);

      const taskResult = agentId
        ? (taskStmt.get(startOfDay.getTime(), endOfDay.getTime(), agentId) as { completed: number; failed: number })
        : (taskStmt.get(startOfDay.getTime(), endOfDay.getTime()) as { completed: number; failed: number });

      // Get time entries
      const timeStmt = agentId
        ? db.prepare(`
            SELECT
              SUM(CASE WHEN activity_type != 'idle' THEN duration_ms ELSE 0 END) as active,
              SUM(CASE WHEN activity_type = 'idle' THEN duration_ms ELSE 0 END) as idle
            FROM time_entries
            WHERE started_at >= ? AND started_at <= ? AND agent_id = ?
          `)
        : db.prepare(`
            SELECT
              SUM(CASE WHEN activity_type != 'idle' THEN duration_ms ELSE 0 END) as active,
              SUM(CASE WHEN activity_type = 'idle' THEN duration_ms ELSE 0 END) as idle
            FROM time_entries
            WHERE started_at >= ? AND started_at <= ?
          `);

      const timeResult = agentId
        ? (timeStmt.get(startOfDay.getTime(), endOfDay.getTime(), agentId) as { active: number; idle: number })
        : (timeStmt.get(startOfDay.getTime(), endOfDay.getTime()) as { active: number; idle: number });

      // Calculate scores
      const totalTime = (timeResult.active ?? 0) + (timeResult.idle ?? 0);
      const focusScore = totalTime > 0 ? (timeResult.active ?? 0) / totalTime : 0;

      // Velocity: tasks per active hour
      const activeHours = (timeResult.active ?? 0) / (1000 * 60 * 60);
      const velocityScore = activeHours > 0 ? (taskResult.completed ?? 0) / activeHours : 0;

      return {
        date,
        tasksCompleted: taskResult.completed ?? 0,
        tasksFailed: taskResult.failed ?? 0,
        timeActiveMs: timeResult.active ?? 0,
        timeIdleMs: timeResult.idle ?? 0,
        interruptions: 0, // Would need interrupt tracking
        velocityScore: Math.round(velocityScore * 100) / 100,
        focusScore: Math.round(focusScore * 100) / 100,
      };
    } catch (err) {
      console.error('[Metrics] Failed to calculate daily metrics:', err);
      return {
        date,
        tasksCompleted: 0,
        tasksFailed: 0,
        timeActiveMs: 0,
        timeIdleMs: 0,
        interruptions: 0,
        velocityScore: 0,
        focusScore: 0,
      };
    }
  }

  /**
   * Get metrics for the last N days
   */
  getDailyMetricsForRange(days: number, agentId: string | undefined): DailyMetrics[] {
    const metrics: DailyMetrics[] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0] as string;
      metrics.push(this.calculateDailyMetrics(dateStr, agentId ?? undefined));
    }

    return metrics;
  }

  /**
   * Calculate weekly metrics
   */
  calculateWeeklyMetrics(agentId: string | undefined): WeeklyMetrics[] {
    const weeks: WeeklyMetrics[] = [];
    const now = new Date();

    // Get last 4 weeks
    for (let weekOffset = 3; weekOffset >= 0; weekOffset--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - (weekOffset * 7));
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);

      const weekStartStr = weekStart.toISOString().split('T')[0] as string;
      const weekEndStr = weekEnd.toISOString().split('T')[0] as string;
      const weekMetrics = this.getWeeklyTotal(weekStartStr, weekEndStr, agentId ?? undefined);
      weeks.push(weekMetrics);
    }

    // Calculate trend
    if (weeks.length >= 2) {
      const recentAvg = (weeks[0]!.totalTasksCompleted + (weeks[1]?.totalTasksCompleted ?? 0)) / 2;
      const olderAvg = ((weeks[2]?.totalTasksCompleted ?? 0) + (weeks[3]?.totalTasksCompleted ?? 0)) / 2;

      for (const week of weeks) {
        week.trendDirection = recentAvg > olderAvg * 1.1 ? 'up' : recentAvg < olderAvg * 0.9 ? 'down' : 'stable';
      }
    }

    return weeks;
  }

  private getWeeklyTotal(weekStart: string, weekEnd: string, agentId: string | undefined): WeeklyMetrics {
    const startMs = new Date(weekStart).getTime();
    const endMs = new Date(weekEnd).setHours(23, 59, 59, 999);

    try {
      const db = getDb();

      const stmt = agentId
        ? db.prepare(`
            SELECT
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
              SUM(duration_ms) as total_ms
            FROM task_history
            WHERE created_at >= ? AND created_at <= ? AND agent_id = ?
          `)
        : db.prepare(`
            SELECT
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
              SUM(duration_ms) as total_ms
            FROM task_history
            WHERE created_at >= ? AND created_at <= ?
          `);

      const result = agentId
        ? (stmt.get(startMs, endMs, agentId) as { completed: number; total_ms: number })
        : (stmt.get(startMs, endMs) as { completed: number; total_ms: number });

      const totalHours = (result.total_ms ?? 0) / (1000 * 60 * 60);
      const daysActive = 7;
      const avgDailyVelocity = daysActive > 0 ? (result.completed ?? 0) / daysActive : 0;

      return {
        weekStart,
        weekEnd,
        totalTasksCompleted: result.completed ?? 0,
        totalHours: Math.round(totalHours * 10) / 10,
        avgDailyVelocity: Math.round(avgDailyVelocity * 100) / 100,
        trendDirection: 'stable' as const,
      };
    } catch (err) {
      console.error('[Metrics] Failed to get weekly total:', err);
      return {
        weekStart,
        weekEnd,
        totalTasksCompleted: 0,
        totalHours: 0,
        avgDailyVelocity: 0,
        trendDirection: 'stable' as const,
      };
    }
  }

  /**
   * Get project-level metrics
   */
  getProjectMetrics(projectId: string): ProjectMetrics {
    try {
      const db = getDb();

      // Get time spent
      const timeStmt = db.prepare(`
        SELECT COALESCE(SUM(duration_ms), 0) as total_ms
        FROM time_entries
        WHERE project_id = ?
      `);
      const timeResult = timeStmt.get(projectId) as { total_ms: number };

      // Get tasks
      const taskStmt = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM task_history
        WHERE project_id = ?
      `);
      const taskResult = taskStmt.get(projectId) as { total: number; completed: number };

      const totalHours = (timeResult.total_ms ?? 0) / (1000 * 60 * 60);
      const progressRate = taskResult.total > 0 ? (taskResult.completed ?? 0) / taskResult.total : 0;

      return {
        projectId,
        totalHours: Math.round(totalHours * 10) / 10,
        tasksCompleted: taskResult.completed ?? 0,
        progressRate: Math.round(progressRate * 100) / 100,
      };
    } catch (err) {
      console.error('[Metrics] Failed to get project metrics:', err);
      return {
        projectId,
        totalHours: 0,
        tasksCompleted: 0,
        progressRate: 0,
      };
    }
  }

  /**
   * Get heatmap data (GitHub-style contributions)
   */
  getHeatmapData(months: number = 6): { date: string; count: number; level: number }[] {
    const heatmap: { date: string; count: number; level: number }[] = [];
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (months * 30));

    try {
      const db = getDb();
      const stmt = db.prepare(`
        SELECT
          DATE(created_at / 1000, 'unixepoch') as date,
          COUNT(*) as count
        FROM task_history
        WHERE status = 'completed' AND created_at >= ?
        GROUP BY DATE(created_at / 1000, 'unixepoch')
        ORDER BY date
      `);

      const rows = stmt.all(startDate.getTime()) as { date: string; count: number }[];
      const map = new Map(rows.map(r => [r.date, r.count]));

      // Fill all days
      for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0]!;
        const count = map.get(dateStr) ?? 0;
        // Level 0-4 based on count
        const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 10 ? 3 : 4;

        heatmap.push({ date: dateStr, count, level });
      }

      return heatmap;
    } catch (err) {
      console.error('[Metrics] Failed to get heatmap data:', err);
      return [];
    }
  }

  /**
   * Record task completion for metrics
   */
  recordTaskCompletion(
    taskId: string,
    goalId: string | undefined,
    projectId: string | undefined,
    durationMs: number | undefined
  ): void {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        UPDATE task_history
        SET status = 'completed', completed_at = ?
        WHERE id = ?
      `);
      stmt.run(Date.now(), taskId);

      if (goalId && durationMs) {
        const goalStmt = db.prepare(`
          UPDATE goals
          SET actual_hours = COALESCE(actual_hours, 0) + ?
          WHERE id = ?
        `);
        goalStmt.run(durationMs / (1000 * 60 * 60), goalId);
      }
    } catch (err) {
      console.error('[Metrics] Failed to record task completion:', err);
    }
  }
}

// Singleton
let instance: MetricsService | null = null;

export function getMetricsService(): MetricsService {
  if (!instance) {
    instance = new MetricsService();
  }
  return instance;
}

/**
 * Prediction Engine
 *
 * Calculates ETAs and completion predictions based on historical velocity.
 * Uses simple linear projection for goal completion estimates.
 */

import { getDb } from '../vault/schema.ts';

export interface GoalPrediction {
  goalId: string;
  title: string;
  currentProgress: number;
  estimatedCompletionDate?: number;
  confidence: number;
  daysRemaining?: number;
  onTrack: boolean;
  velocityPerDay: number;
  recommendedAction: string;
}

export interface ProjectPrediction {
  projectId: string;
  projectName?: string;
  completionPercentage: number;
  estimatedCompletionDate?: number;
  velocityTrend: 'accelerating' | 'steady' | 'decelerating';
  riskLevel: 'low' | 'medium' | 'high';
}

export class PredictionEngine {
  /**
   * Calculate prediction for a specific goal
   */
  calculateGoalPrediction(goalId: string): GoalPrediction | null {
    try {
      const db = getDb();

      // Get goal details
      const goalStmt = db.prepare(`
        SELECT id, title, status, score, deadline, estimated_hours, actual_hours, created_at
        FROM goals
        WHERE id = ?
      `);
      const goal = goalStmt.get(goalId) as {
        id: string;
        title: string;
        status: string;
        score: number;
        deadline: number | null;
        estimated_hours: number | null;
        actual_hours: number | null;
        created_at: number;
      };

      if (!goal) return null;

      // Already completed
      if (goal.status === 'completed') {
        return {
          goalId,
          title: goal.title,
          currentProgress: 100,
          confidence: 1.0,
          onTrack: true,
          velocityPerDay: 0,
          recommendedAction: 'Goal completed',
        };
      }

      // Calculate current progress (score is 0-1)
      const currentProgress = Math.round((goal.score ?? 0) * 100);

      // Get historical velocity
      const velocityData = this.getGoalVelocity(goalId, goal.created_at);

      // Calculate days since start
      const daysSinceStart = Math.max(1, (Date.now() - goal.created_at) / (1000 * 60 * 60 * 24));
      const velocityPerDay = currentProgress / daysSinceStart;

      // Estimate completion
      const remainingProgress = 100 - currentProgress;
      const daysToComplete = velocityPerDay > 0 ? remainingProgress / velocityPerDay : Infinity;

      let estimatedCompletionDate: number | undefined;
      let daysRemaining: number | undefined;
      let onTrack = true;

      if (daysToComplete !== Infinity) {
        estimatedCompletionDate = Date.now() + (daysToComplete * 1000 * 60 * 60 * 24);
        daysRemaining = Math.round(daysToComplete);

        // Check if on track for deadline
        if (goal.deadline) {
          const daysUntilDeadline = (goal.deadline - Date.now()) / (1000 * 60 * 60 * 24);
          onTrack = daysRemaining <= daysUntilDeadline;
        }
      }

      // Calculate confidence based on data points and consistency
      const confidence = this.calculateConfidence(velocityData);

      // Generate recommendation
      const recommendedAction = this.generateRecommendation(
        currentProgress,
        velocityPerDay,
        onTrack,
        goal.deadline
      );

      return {
        goalId,
        title: goal.title,
        currentProgress,
        estimatedCompletionDate,
        confidence,
        daysRemaining,
        onTrack,
        velocityPerDay: Math.round(velocityPerDay * 100) / 100,
        recommendedAction,
      };
    } catch (err) {
      console.error('[Prediction] Failed to calculate goal prediction:', err);
      return null;
    }
  }

  /**
   * Get velocity data points for a goal
   */
  private getGoalVelocity(goalId: string, sinceMs: number): number[] {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        SELECT score_before, score_after, created_at
        FROM goal_progress
        WHERE goal_id = ? AND created_at >= ?
        ORDER BY created_at
      `);

      const rows = stmt.all(goalId, sinceMs) as { score_before: number; score_after: number; created_at: number }[];
      return rows.map(r => r.score_after - r.score_before);
    } catch (err) {
      console.error('[Prediction] Failed to get velocity data:', err);
      return [];
    }
  }

  /**
   * Calculate confidence score based on data consistency
   */
  private calculateConfidence(dataPoints: number[]): number {
    if (dataPoints.length === 0) return 0.3; // Low confidence, no data
    if (dataPoints.length < 3) return 0.5; // Medium-low confidence

    // Calculate standard deviation
    const mean = dataPoints.reduce((a, b) => a + b, 0) / dataPoints.length;
    const variance = dataPoints.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / dataPoints.length;
    const stdDev = Math.sqrt(variance);

    // Coefficient of variation (lower = more consistent)
    const cv = mean !== 0 ? stdDev / Math.abs(mean) : 1;

    // Confidence based on data points and consistency
    const dataConfidence = Math.min(1, dataPoints.length / 10); // Max at 10 data points
    const consistencyConfidence = Math.max(0, 1 - cv);

    return Math.round((dataConfidence * 0.6 + consistencyConfidence * 0.4) * 100) / 100;
  }

  /**
   * Generate actionable recommendation
   */
  private generateRecommendation(
    progress: number,
    velocity: number,
    onTrack: boolean,
    deadline?: number | null
  ): string {
    if (progress >= 90) {
      return 'Almost there! Focus on completing the remaining details.';
    }

    if (!onTrack && deadline) {
      const daysUntil = Math.round((deadline - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysUntil < 3) {
        return `URGENT: Deadline in ${daysUntil} days. Consider escalating or reducing scope.`;
      }
      return `Behind schedule. Increase velocity by ${Math.round((1 - velocity / ((100 - progress) / daysUntil)) * 100)}% to meet deadline.`;
    }

    if (velocity < 1) {
      return 'Progress is slow. Consider breaking down remaining work into smaller tasks.';
    }

    if (progress < 30 && velocity > 5) {
      return 'Great momentum! Maintain this pace to finish ahead of schedule.';
    }

    return 'On track. Continue current pace and monitor for blockers.';
  }

  /**
   * Calculate project-level predictions
   */
  calculateProjectPrediction(projectId: string): ProjectPrediction | null {
    try {
      const db = getDb();

      // Get project info
      const projectStmt = db.prepare(`
        SELECT id, name FROM projects WHERE id = ?
      `);
      const project = projectStmt.get(projectId) as { id: string; name: string } | undefined;

      if (!project) return null;

      // Get all goals for this project
      const goalsStmt = db.prepare(`
        SELECT id, score, status, deadline
        FROM goals
        WHERE project_id = ? AND status != 'killed'
      `);
      const goals = goalsStmt.all(projectId) as { id: string; score: number; status: string; deadline: number | null }[];

      if (goals.length === 0) {
        return {
          projectId,
          projectName: project.name,
          completionPercentage: 0,
          velocityTrend: 'steady',
          riskLevel: 'low',
        };
      }

      // Calculate average completion
      const activeGoals = goals.filter(g => g.status !== 'completed');
      const completedGoals = goals.filter(g => g.status === 'completed');

      const completedScore = completedGoals.reduce((sum, _) => sum + 1, 0);
      const activeScore = activeGoals.reduce((sum, g) => sum + (g.score ?? 0), 0);
      const completionPercentage = Math.round(((completedScore + activeScore) / goals.length) * 100);

      // Analyze velocity trend from recent vs older progress
      const trend = this.analyzeProjectVelocity(projectId);

      // Assess risk
      const riskLevel = this.assessProjectRisk(goals, trend);

      // Estimate completion
      let estimatedCompletionDate: number | undefined;
      if (completionPercentage < 100 && activeGoals.length > 0) {
        const avgVelocity = activeGoals.reduce((sum, g) => {
          const pred = this.calculateGoalPrediction(g.id);
          return sum + (pred?.velocityPerDay ?? 0);
        }, 0) / activeGoals.length;

        if (avgVelocity > 0) {
          const remainingWork = activeGoals.reduce((sum, g) => sum + (1 - (g.score ?? 0)), 0) * 100;
          const daysToComplete = remainingWork / avgVelocity;
          estimatedCompletionDate = Date.now() + (daysToComplete * 1000 * 60 * 60 * 24);
        }
      }

      return {
        projectId,
        projectName: project.name,
        completionPercentage,
        estimatedCompletionDate,
        velocityTrend: trend,
        riskLevel,
      };
    } catch (err) {
      console.error('[Prediction] Failed to calculate project prediction:', err);
      return null;
    }
  }

  /**
   * Analyze project velocity trend
   */
  private analyzeProjectVelocity(projectId: string): 'accelerating' | 'steady' | 'decelerating' {
    try {
      const db = getDb();
      const now = Date.now();
      const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);

      // Recent completions
      const recentStmt = db.prepare(`
        SELECT COUNT(*) as count FROM goals
        WHERE project_id = ? AND status = 'completed' AND completed_at >= ?
      `);
      const recent = recentStmt.get(projectId, twoWeeksAgo) as { count: number };

      // Older completions
      const olderStmt = db.prepare(`
        SELECT COUNT(*) as count FROM goals
        WHERE project_id = ? AND status = 'completed' AND completed_at < ? AND completed_at >= ?
      `);
      const older = olderStmt.get(projectId, twoWeeksAgo, twoWeeksAgo - (14 * 24 * 60 * 60 * 1000)) as { count: number };

      if (recent.count > older.count * 1.2) return 'accelerating';
      if (recent.count < older.count * 0.8) return 'decelerating';
      return 'steady';
    } catch (err) {
      console.error('[Prediction] Failed to analyze velocity:', err);
      return 'steady';
    }
  }

  /**
   * Assess project risk level
   */
  private assessProjectRisk(
    goals: { score: number; status: string; deadline: number | null }[],
    trend: 'accelerating' | 'steady' | 'decelerating'
  ): 'low' | 'medium' | 'high' {
    const activeGoals = goals.filter(g => g.status !== 'completed');
    if (activeGoals.length === 0) return 'low';

    // Check for at-risk goals
    const atRiskCount = activeGoals.filter(g => {
      if (!g.deadline) return false;
      const daysUntil = (g.deadline - Date.now()) / (1000 * 60 * 60 * 24);
      const progressRemaining = 1 - (g.score ?? 0);
      // At risk if less than 50% progress with deadline within a week
      return progressRemaining > 0.5 && daysUntil < 7;
    }).length;

    const riskRatio = atRiskCount / activeGoals.length;

    if (riskRatio > 0.5 || trend === 'decelerating') return 'high';
    if (riskRatio > 0.2) return 'medium';
    return 'low';
  }

  /**
   * Get all active goal predictions
   */
  getAllActivePredictions(projectId?: string): GoalPrediction[] {
    try {
      const db = getDb();

      let sql = `
        SELECT id FROM goals
        WHERE status IN ('active', 'draft', 'at_risk', 'behind', 'critical')
      `;
      const params: string[] = [];

      if (projectId) {
        sql += ` AND project_id = ?`;
        params.push(projectId);
      }

      const stmt = db.prepare(sql);
      const goals = stmt.all(...params) as { id: string }[];

      const predictions: GoalPrediction[] = [];
      for (const goal of goals) {
        const pred = this.calculateGoalPrediction(goal.id);
        if (pred) predictions.push(pred);
      }

      return predictions;
    } catch (err) {
      console.error('[Prediction] Failed to get all predictions:', err);
      return [];
    }
  }
}

// Singleton
let instance: PredictionEngine | null = null;

export function getPredictionEngine(): PredictionEngine {
  if (!instance) {
    instance = new PredictionEngine();
  }
  return instance;
}

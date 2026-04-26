/**
 * Goal Completion Extractor
 *
 * Extracts a completed/failed/killed goal into the vault as a concept entity
 * with performance facts. This builds historical data used for future
 * estimation (goal estimator).
 */

import { createEntity, findEntities } from './entities.ts';
import { createFact } from './facts.ts';
import { withTransaction } from './schema.ts';

export type GoalCompletionInput = {
  id: string;
  title: string;
  level: string;
  score: number;
  status: string;
  estimated_hours: number | null;
  actual_hours: number;
  created_at: number;
  completed_at: number | null;
  tags: string[];
};

/**
 * Extract a completed goal as a vault entity with performance facts.
 * Called when a goal reaches a terminal state (completed/failed/killed).
 */
export function extractGoalCompletion(goal: GoalCompletionInput): void {
  try {
    withTransaction(() => {
      // Create or find entity for this goal
      const existing = findEntities({ name: goal.title, type: 'concept' });
      let entityId: string;

      if (existing.length > 0) {
        entityId = existing[0]!.id;
      } else {
        const entity = createEntity('concept', goal.title, {
          goal_id: goal.id,
          goal_level: goal.level,
        }, 'goal_completion');
        entityId = entity.id;
      }

      // Store performance facts
      createFact(entityId, 'goal_final_score', goal.score.toFixed(2), { confidence: 1.0, source: 'goal_completion' });
      createFact(entityId, 'goal_outcome', goal.status, { confidence: 1.0, source: 'goal_completion' });
      createFact(entityId, 'goal_level', goal.level, { confidence: 1.0, source: 'goal_completion' });

      if (goal.estimated_hours !== null) {
        createFact(entityId, 'estimated_hours', goal.estimated_hours.toString(), { confidence: 1.0, source: 'goal_completion' });
      }
      if (goal.actual_hours > 0) {
        createFact(entityId, 'actual_hours', goal.actual_hours.toFixed(1), { confidence: 1.0, source: 'goal_completion' });
      }
      if (goal.completed_at) {
        const durationDays = Math.ceil((goal.completed_at - goal.created_at) / 86400000);
        createFact(entityId, 'days_to_complete', durationDays.toString(), { confidence: 1.0, source: 'goal_completion' });
      }
      if (goal.estimated_hours !== null && goal.actual_hours > 0) {
        const accuracy = (goal.estimated_hours / goal.actual_hours).toFixed(2);
        createFact(entityId, 'estimation_accuracy', accuracy, { confidence: 1.0, source: 'goal_completion' });
      }
      if (goal.tags.length > 0) {
        createFact(entityId, 'goal_tags', goal.tags.join(', '), { confidence: 1.0, source: 'goal_completion' });
      }
    });
  } catch (err) {
    console.error('[goal-extractor] Failed to extract goal completion:', err);
  }
}

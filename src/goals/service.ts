/**
 * GoalService — Core service for M16 Autonomous Goal Pursuit
 * GoalService — Core service for goal CRUD and execution state management.
 * GoalService — Super Jarvis integration: Directives API for the Autonomous Loop.
 */

import type { Service, ServiceStatus } from '../daemon/services.ts';
import type { GoalEvent } from './events.ts';
import type { GoalConfig } from '../config/types.ts';
import type { Goal, GoalLevel, GoalStatus, GoalHealth } from './types.ts';
import type { DailyRhythm } from './rhythm.ts';
import * as vault from '../vault/goals.ts';

export interface SubTask {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  completion_criteria: string;
  attempts: number;
}

export interface GoalDirective {
  goal: Goal;
  current_task: SubTask | null;
  next_tasks: SubTask[];
  needs_decomposition: boolean;
}

export class GoalService implements Service {
  name = 'goals';
  private _status: ServiceStatus = 'stopped';
  private config: GoalConfig;
  private eventCallback: ((event: GoalEvent) => void) | null = null;
  private chatCallback: ((text: string) => void) | null = null;
  private rhythm: DailyRhythm | null = null;

  // Timers
  private rhythmTimer: Timer | null = null;        // daily rhythm check (60s)
  private accountabilityTimer: Timer | null = null; // accountability check (5min)
  private healthTimer: Timer | null = null;         // health recalc (15min)

  constructor(config: GoalConfig) {
    this.config = config;
  }

  /**
   * Set callback for broadcasting goal events via WebSocket.
   */
  setEventCallback(cb: (event: GoalEvent) => void): void {
    this.eventCallback = cb;
  }

  /**
   * Set callback for sending proactive messages to the user's chat.
   */
  setChatCallback(cb: (text: string) => void): void {
    this.chatCallback = cb;
  }

  /**
   * Set the DailyRhythm instance for morning/evening planning.
   */
  setRhythm(rhythm: DailyRhythm): void {
    this.rhythm = rhythm;
  }

  private emit(event: GoalEvent): void {
    if (this.eventCallback) {
      this.eventCallback(event);
    }
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this._status = 'stopped';
      console.log('[GoalService] Disabled by config');
      return;
    }

    this._status = 'starting';

    // Daily rhythm check — runs every 60s to detect morning/evening windows
    this.rhythmTimer = setInterval(() => {
      this.checkDailyRhythm().catch(err =>
        console.error('[GoalService] Rhythm check error:', err)
      );
    }, 60_000);

    // Accountability check — runs every 5min for escalation monitoring
    this.accountabilityTimer = setInterval(() => {
      this.checkAccountability().catch(err =>
        console.error('[GoalService] Accountability check error:', err)
      );
    }, 5 * 60_000);

    // Health recalculation — runs every 15min
    this.healthTimer = setInterval(() => {
      this.recalculateAllHealth().catch(err =>
        console.error('[GoalService] Health recalc error:', err)
      );
    }, 15 * 60_000);

    this._status = 'running';
    console.log('[GoalService] Started (rhythm=60s, accountability=5min, health=15min)');
  }

  async stop(): Promise<void> {
    this._status = 'stopping';

    if (this.rhythmTimer) { clearInterval(this.rhythmTimer); this.rhythmTimer = null; }
    if (this.accountabilityTimer) { clearInterval(this.accountabilityTimer); this.accountabilityTimer = null; }
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }

    this._status = 'stopped';
    console.log('[GoalService] Stopped');
  }

  status(): ServiceStatus {
    return this._status;
  }

  // ── Goal CRUD with events ─────────────────────────────────────────

  createGoal(title: string, level: GoalLevel, opts?: Parameters<typeof vault.createGoal>[2]): Goal {
    const goal = vault.createGoal(title, level, opts);
    this.emit({
      type: 'goal_created',
      goalId: goal.id,
      data: { title, level, parent_id: goal.parent_id },
      timestamp: Date.now(),
    });
    return goal;
  }

  getGoal(id: string): Goal | null {
    return vault.getGoal(id);
  }

  updateGoal(id: string, updates: Parameters<typeof vault.updateGoal>[1]): Goal | null {
    const goal = vault.updateGoal(id, updates);
    if (goal) {
      this.emit({
        type: 'goal_updated',
        goalId: id,
        data: { updates },
        timestamp: Date.now(),
      });
    }
    return goal;
  }

  scoreGoal(id: string, score: number, reason: string, source = 'user'): Goal | null {
    const goal = vault.updateGoalScore(id, score, reason, source);
    if (goal) {
      this.emit({
        type: 'goal_scored',
        goalId: id,
        data: { score: goal.score, reason, source },
        timestamp: Date.now(),
      });
    }
    return goal;
  }

  updateStatus(id: string, status: GoalStatus): Goal | null {
    const goal = vault.updateGoalStatus(id, status);
    if (!goal) return null;

    const eventType = status === 'completed' ? 'goal_completed'
      : status === 'failed' ? 'goal_failed'
      : status === 'killed' ? 'goal_killed'
      : 'goal_status_changed';

    this.emit({
      type: eventType,
      goalId: id,
      data: { status },
      timestamp: Date.now(),
    });

    // Extract goal completion data for vault knowledge
    if (status === 'completed' || status === 'failed' || status === 'killed') {
      try {
        const { extractGoalCompletion } = require('../vault/extractor.ts');
        extractGoalCompletion(goal);
      } catch {
        // Extractor may not be available — ignore
      }
    }

    return goal;
  }

  updateHealth(id: string, health: GoalHealth): Goal | null {
    const goal = vault.updateGoalHealth(id, health);
    if (goal) {
      this.emit({
        type: 'goal_health_changed',
        goalId: id,
        data: { health },
        timestamp: Date.now(),
      });
    }
    return goal;
  }

  deleteGoal(id: string): boolean {
    const result = vault.deleteGoal(id);
    if (result) {
      this.emit({
        type: 'goal_deleted',
        goalId: id,
        data: {},
        timestamp: Date.now(),
      });
    }
    return result;
  }

  // ── Daily Rhythm ──────────────────────────────────────────────────

  /**
   * Check if we're in a morning or evening window and trigger check-ins.
   * Calls DailyRhythm to generate the plan/review and sends the message to chat.
   */
  private async checkDailyRhythm(): Promise<void> {
    const now = new Date();
    const hour = now.getHours();

    const morningWindow = this.config.morning_window ?? { start: 7, end: 9 };
    const eveningWindow = this.config.evening_window ?? { start: 20, end: 22 };

    // Check morning window
    if (hour >= morningWindow.start && hour < morningWindow.end) {
      const existing = vault.getTodayCheckIn('morning_plan');
      if (!existing) {
        console.log('[GoalService] Morning plan window — running morning plan');
        if (this.rhythm) {
          try {
            const result = await this.rhythm.runMorningPlan();
            if (this.chatCallback) {
              const parts: string[] = [];
              parts.push(`**Morning Plan**\n`);
              parts.push(result.message);
              if (result.warnings.length > 0) {
                parts.push(`\n\n**Warnings:**`);
                for (const w of result.warnings) parts.push(`- ${w}`);
              }
              if (result.focusAreas.length > 0) {
                parts.push(`\n\n**Focus Areas:**`);
                for (const f of result.focusAreas) parts.push(`- ${f}`);
              }
              if (result.dailyActions.length > 0) {
                parts.push(`\n\n**Today's Actions:**`);
                for (const a of result.dailyActions) parts.push(`- ${a}`);
              }
              this.chatCallback(parts.join('\n'));
            }
          } catch (err) {
            console.error('[GoalService] Morning plan failed:', err);
          }
        }
      }
    }

    // Check evening window
    if (hour >= eveningWindow.start && hour < eveningWindow.end) {
      const existing = vault.getTodayCheckIn('evening_review');
      if (!existing) {
        console.log('[GoalService] Evening review window — running evening review');
        if (this.rhythm) {
          try {
            const result = await this.rhythm.runEveningReview();
            if (this.chatCallback) {
              const parts: string[] = [];
              parts.push(`**Evening Review**\n`);
              parts.push(result.message);
              parts.push(`\n\n${result.assessment}`);
              if (result.scoreUpdates.length > 0) {
                parts.push(`\n\n**Score Updates:**`);
                for (const u of result.scoreUpdates) {
                  parts.push(`- ${u.reason} (${u.newScore.toFixed(1)})`);
                }
              }
              this.chatCallback(parts.join('\n'));
            }
          } catch (err) {
            console.error('[GoalService] Evening review failed:', err);
          }
        }
      }
    }
  }

  // ── Accountability ─────────────────────────────────────────────────

  /**
   * Check active goals for escalation needs.
   * Full drill-sergeant logic is in src/goals/accountability.ts (Phase 4).
   */
  private async checkAccountability(): Promise<void> {
    const needingEscalation = vault.getGoalsNeedingEscalation();
    const overdue = vault.getOverdueGoals();

    for (const goal of needingEscalation) {
      if (goal.escalation_stage === 'none') {
        // Auto-escalate to 'pressure' stage
        const escalationWeeks = this.config.escalation_weeks ?? { pressure: 1, root_cause: 3, suggest_kill: 4 };
        const behindSince = goal.updated_at;
        const weeksBehind = (Date.now() - behindSince) / (7 * 24 * 60 * 60 * 1000);

        if (weeksBehind >= escalationWeeks.pressure) {
          vault.updateGoalEscalation(goal.id, 'pressure');
          this.emit({
            type: 'goal_escalated',
            goalId: goal.id,
            data: { stage: 'pressure', weeksBehind },
            timestamp: Date.now(),
          });
        }
      } else if (goal.escalation_stage === 'pressure') {
        const escalationWeeks = this.config.escalation_weeks ?? { pressure: 1, root_cause: 3, suggest_kill: 4 };
        const startedAt = goal.escalation_started_at ?? goal.updated_at;
        const weeksSinceEscalation = (Date.now() - startedAt) / (7 * 24 * 60 * 60 * 1000);

        if (weeksSinceEscalation >= escalationWeeks.root_cause) {
          vault.updateGoalEscalation(goal.id, 'root_cause');
          this.emit({
            type: 'goal_escalated',
            goalId: goal.id,
            data: { stage: 'root_cause', weeksSinceEscalation },
            timestamp: Date.now(),
          });
        }
      } else if (goal.escalation_stage === 'root_cause') {
        const escalationWeeks = this.config.escalation_weeks ?? { pressure: 1, root_cause: 3, suggest_kill: 4 };
        const startedAt = goal.escalation_started_at ?? goal.updated_at;
        const weeksSinceEscalation = (Date.now() - startedAt) / (7 * 24 * 60 * 60 * 1000);

        if (weeksSinceEscalation >= escalationWeeks.suggest_kill) {
          vault.updateGoalEscalation(goal.id, 'suggest_kill');
          this.emit({
            type: 'goal_escalated',
            goalId: goal.id,
            data: { stage: 'suggest_kill', weeksSinceEscalation },
            timestamp: Date.now(),
          });
        }
      }
    }

    // Log overdue goals (Phase 4 will handle the drill-sergeant messaging)
    if (overdue.length > 0) {
      console.log(`[GoalService] ${overdue.length} overdue goal(s) detected`);
    }
  }

  // ── Health Recalculation ─────────────────────────────────────────

  /**
   * Recalculate health for all active goals based on score and deadline.
   */
  private async recalculateAllHealth(): Promise<void> {
    const activeGoals = vault.findGoals({ status: 'active' });
    let changed = 0;

    for (const goal of activeGoals) {
      const newHealth = this.calculateHealth(goal);
      if (newHealth !== goal.health) {
        this.updateHealth(goal.id, newHealth);
        changed++;
      }
    }

    if (changed > 0) {
      console.log(`[GoalService] Health recalculated: ${changed} goal(s) changed`);
    }
  }

  /**
   * Calculate health for a single goal based on score progress vs time elapsed.
   */
  private calculateHealth(goal: Goal): GoalHealth {
    // If no deadline, base purely on score
    if (!goal.deadline) {
      if (goal.score >= 0.6) return 'on_track';
      if (goal.score >= 0.3) return 'at_risk';
      return 'behind';
    }

    const now = Date.now();
    const startTime = goal.started_at ?? goal.created_at;
    const totalDuration = goal.deadline - startTime;
    const elapsed = now - startTime;

    // If past deadline
    if (now > goal.deadline) {
      if (goal.score >= 0.7) return 'on_track'; // nearly done
      if (goal.score >= 0.4) return 'behind';
      return 'critical';
    }

    // Ratio: how far along are we in time vs score
    const timeRatio = totalDuration > 0 ? elapsed / totalDuration : 0;
    const expectedScore = timeRatio * 0.7; // expecting 0.7 = good at deadline

    const gap = expectedScore - goal.score;

    if (gap <= 0) return 'on_track';      // ahead of pace
    if (gap <= 0.15) return 'at_risk';     // slightly behind
    if (gap <= 0.3) return 'behind';       // significantly behind
    return 'critical';                      // way behind
  }

  // ── Super Jarvis: Directives API ───────────────────────────────────

  /**
   * Get the most critical active goal and its current execution state.
   * This is the bridge between the Goal system and the Autonomous Loop.
   */
  getActiveDirectives(): GoalDirective | null {
    // 1. Find the most critical active goal (prioritize by health, then deadline)
    const activeGoals = vault.findGoals({ status: 'active' })
      .filter(g => g.level === 'objective' || g.level === 'key_result');

    if (activeGoals.length === 0) return null;

    // Sort by health (critical first) and then by deadline
    const healthOrder = { 'critical': 0, 'behind': 1, 'at_risk': 2, 'on_track': 3 };
    activeGoals.sort((a, b) => {
      const healthDiff = healthOrder[a.health] - healthOrder[b.health];
      if (healthDiff !== 0) return healthDiff;
      // If same health, prioritize by deadline (earliest first)
      if (a.deadline && b.deadline) return a.deadline - b.deadline;
      return 0;
    });

    const goal = activeGoals[0];
    const execState = (goal as any).execution_state || { current_step_index: 0, sub_tasks: [], last_pivot_reason: null };

    // Extract current and next tasks
    const currentTask = execState.sub_tasks[execState.current_step_index] || null;
    const nextTasks = execState.sub_tasks.slice(execState.current_step_index + 1);

    // Check if goal needs decomposition
    const needsDecomposition = !execState.sub_tasks || execState.sub_tasks.length === 0;

    if (!goal) return null;
    return {
      goal,
      current_task: currentTask,
      next_tasks: nextTasks,
      needs_decomposition: needsDecomposition,
    };
  }

  /**
   * Update the execution state of a goal (mark tasks as complete/failed).
   */
  updateSubTaskProgress(goalId: string, subtaskId: string, newStatus: 'pending' | 'in_progress' | 'completed' | 'failed'): Goal | null {
    const goal = vault.getGoal(goalId);
    if (!goal) return null;

    const execState = (goal as any).execution_state || { current_step_index: 0, sub_tasks: [], last_pivot_reason: null };
    const subtaskIndex = execState.sub_tasks.findIndex((t: SubTask) => t.id === subtaskId);

    if (subtaskIndex === -1) {
      console.warn(`[GoalService] Subtask ${subtaskId} not found in goal ${goalId}`);
      return goal;
    }

    // Update the subtask status
    execState.sub_tasks[subtaskIndex].status = newStatus;

    // If completed, move to next task
    if (newStatus === 'completed') {
      execState.current_step_index = subtaskIndex + 1;
    } else if (newStatus === 'failed') {
      execState.sub_tasks[subtaskIndex].attempts += 1;
      // If too many attempts, record pivot
      if (execState.sub_tasks[subtaskIndex].attempts >= 3) {
        execState.last_pivot_reason = `Subtask ${subtaskId} failed after 3 attempts`;
      }
    }

    // Save to DB
    return vault.updateGoal(goalId, { execution_state: execState as any });
  }

  /**
   * Decompose a high-level goal into actionable sub-tasks using the LLM.
   * This requires integration with the LLM manager.
   */
  async decomposeGoal(goalId: string, llmManager?: any): Promise<SubTask[]> {
    const goal = vault.getGoal(goalId);
    if (!goal) return [];

    // Simple decomposition logic (placeholder for LLM integration)
    // In a full implementation, this would call the LLM to break down the goal
    const defaultTasks: SubTask[] = [
      {
        id: crypto.randomUUID(),
        description: `Analyze and understand: ${goal.title}`,
        status: 'pending',
        completion_criteria: 'Clear understanding of the goal requirements',
        attempts: 0,
      },
      {
        id: crypto.randomUUID(),
        description: `Plan execution strategy for: ${goal.title}`,
        status: 'pending',
        completion_criteria: 'Detailed plan created',
        attempts: 0,
      },
      {
        id: crypto.randomUUID(),
        description: `Execute primary action: ${goal.title}`,
        status: 'pending',
        completion_criteria: 'Main task completed successfully',
        attempts: 0,
      },
      {
        id: crypto.randomUUID(),
        description: `Verify results and iterate: ${goal.title}`,
        status: 'pending',
        completion_criteria: 'Results verified and any issues fixed',
        attempts: 0,
      },
    ];

    // Update the goal's execution state
    const execState = {
      current_step_index: 0,
      sub_tasks: defaultTasks,
      last_pivot_reason: null,
    };

    vault.updateGoal(goalId, { execution_state: execState as any });

    console.log(`[GoalService] Decomposed goal ${goalId} into ${defaultTasks.length} subtasks`);
    return defaultTasks;
  }

  // ── Metrics ─────────────────────────────────────────────────────

  getMetrics() {
    return vault.getGoalMetrics();
  }
}

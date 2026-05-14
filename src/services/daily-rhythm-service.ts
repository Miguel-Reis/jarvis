/**
 * Daily Rhythm Service
 *
 * Manages daily workflow rhythms, calendar integration, and time-based reminders.
 * Implements morning/evening windows, accountability check-ins, and goal progress reviews.
 *
 * Features:
 * - Morning briefing (7-9am): Review goals, set daily priorities
 * - Evening review (8-10pm): Progress summary, accountability check
 * - Calendar integration for scheduling
 * - Time-based reminders and nudges
 */

import type { Service, ServiceStatus } from '../daemon/types.ts';
import { getDb } from '../vault/schema.ts';

export interface DailyRhythmConfig {
  enabled: boolean;
  morningWindow: { start: number; end: number };  // Default: 7-9 (hours)
  eveningWindow: { start: number; end: number };  // Default: 20-22 (hours)
  accountabilityStyle: 'gentle' | 'drill_sergeant' | 'coach';
  checkInIntervalHours: number;  // Default: 4 hours
  calendarIntegration: boolean;
}

const DEFAULT_CONFIG: DailyRhythmConfig = {
  enabled: true,
  morningWindow: { start: 7, end: 9 },
  eveningWindow: { start: 20, end: 22 },
  accountabilityStyle: 'drill_sergeant',
  checkInIntervalHours: 4,
  calendarIntegration: false,
};

export interface DailyBriefing {
  date: string;
  goals: Array<{ id: string; title: string; priority: number }>;
  priorities: string[];
  scheduledEvents: Array<{ time: string; title: string }>;
  motivationalMessage: string;
}

export interface EveningReview {
  date: string;
  completedTasks: number;
  failedTasks: number;
  progressSummary: string;
  accountabilityMessage: string;
}

export class DailyRhythmService implements Service {
  name = 'daily-rhythm';
  private config: DailyRhythmConfig;
  private statusState: ServiceStatus = 'stopped';
  private checkInTimer: Timer | null = null;
  private lastMorningBriefing: string | null = null;
  private lastEveningReview: string | null = null;

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  // Callbacks
  private onBriefing?: (briefing: DailyBriefing) => void;
  private onReview?: (review: EveningReview) => void;
  private onCheckIn?: (message: string) => void;

  constructor(config?: Partial<DailyRhythmConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[DailyRhythm] Starting...');
    this.statusState = 'starting';

    try {
      // Run initial check
      this.checkTimeWindows();

      // Start periodic check-ins
      this.checkInTimer = setInterval(() => {
        this.checkTimeWindows();
        this.performPeriodicCheckIn();
      }, this.config.checkInIntervalHours * 3600 * 1000);

      this.statusState = 'running';
      console.log(`[DailyRhythm] Running (${this.config.accountabilityStyle} mode, check-ins every ${this.config.checkInIntervalHours}h)`);
    } catch (err) {
      this.statusState = 'error';
      console.error('[DailyRhythm] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[DailyRhythm] Stopping...');
    this.statusState = 'stopping';

    if (this.checkInTimer) {
      clearInterval(this.checkInTimer);
      this.checkInTimer = null;
    }

    this.statusState = 'stopped';
    console.log('[DailyRhythm] Stopped');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Set callbacks
   */
  setBriefingCallback(callback: (briefing: DailyBriefing) => void): void {
    this.onBriefing = callback;
  }

  setReviewCallback(callback: (review: EveningReview) => void): void {
    this.onReview = callback;
  }

  setCheckInCallback(callback: (message: string) => void): void {
    this.onCheckIn = callback;
  }

  /**
   * Check current time windows and trigger appropriate actions
   */
  private checkTimeWindows(): void {
    const now = new Date();
    const currentHour = now.getHours();
    const today = this.getTodayString();

    // Skip if already delivered today
    if (this.lastMorningBriefing === today && this.lastEveningReview === today) {
      return;
    }

    // Check morning window (7-9am)
    if (currentHour >= this.config.morningWindow.start &&
        currentHour < this.config.morningWindow.end &&
        this.lastMorningBriefing !== today) {
      this.deliverMorningBriefing();
      this.lastMorningBriefing = today;
    }

    // Check evening window (8-10pm)
    if (currentHour >= this.config.eveningWindow.start &&
        currentHour < this.config.eveningWindow.end &&
        this.lastEveningReview !== today) {
      this.deliverEveningReview();
      this.lastEveningReview = today;
    }
  }

  /**
   * Deliver morning briefing
   */
  private async deliverMorningBriefing(): Promise<void> {
    console.log('[DailyRhythm] Delivering morning briefing...');

    const today = new Date().toISOString().split('T')[0];
    const briefing = await this.generateMorningBriefing();

    if (this.onBriefing) {
      this.onBriefing(briefing);
    }

    // Format message based on accountability style
    const message = this.formatMorningMessage(briefing);
    console.log(`[DailyRhythm] Morning briefing delivered: ${message.slice(0, 100)}...`);
  }

  /**
   * Generate morning briefing content
   */
  private async generateMorningBriefing(): Promise<DailyBriefing> {
    const db = getDb();

    // Get active goals
    const goalsStmt = db.prepare(`
      SELECT id, title, priority
      FROM goals
      WHERE status = 'active'
      ORDER BY priority DESC, created_at ASC
      LIMIT 5
    `);
    const goals = goalsStmt.all() as Array<{ id: string; title: string; priority: number }>;

    // Get today's scheduled events (if calendar integration enabled)
    const events: Array<{ time: string; title: string }> = [];
    if (this.config.calendarIntegration) {
      // Would integrate with Google Calendar or similar
      // For now, placeholder
    }

    // Generate priorities based on goal deadlines
    const priorities = goals.map(g => `Continue work on: ${g.title}`);

    // Motivational message based on accountability style
    const motivationalMessage = this.getMotivationalMessage('morning');

    return {
      date: this.getTodayString(),
      goals,
      priorities,
      scheduledEvents: events,
      motivationalMessage,
    };
  }

  /**
   * Format morning message based on accountability style
   */
  private formatMorningMessage(briefing: DailyBriefing): string {
    const style = this.config.accountabilityStyle;

    if (style === 'gentle') {
      return `Good morning! 🌅 Today's focus: ${briefing.priorities.slice(0, 2).join('. ')}. ${briefing.motivationalMessage}`;
    } else if (style === 'coach') {
      return `Morning! 💪 You have ${briefing.goals.length} active goals. Let's make progress on: ${briefing.priorities.slice(0, 2).join('. ')}. ${briefing.motivationalMessage}`;
    } else {
      // drill_sergeant
      return `RISE AND GRIND! ⚡ ${briefing.goals.length} goals waiting. Priority targets: ${briefing.priorities.slice(0, 2).join('. ')}. ${briefing.motivationalMessage}`;
    }
  }

  /**
   * Deliver evening review
   */
  private async deliverEveningReview(): Promise<void> {
    console.log('[DailyRhythm] Delivering evening review...');

    const review = await this.generateEveningReview();

    if (this.onReview) {
      this.onReview(review);
    }

    console.log(`[DailyRhythm] Evening review delivered: ${review.progressSummary.slice(0, 100)}...`);
  }

  /**
   * Generate evening review content
   */
  private async generateEveningReview(): Promise<EveningReview> {
    const db = getDb();

    // Get today's task completions
    const today = this.getTodayString();
    const todayStart = new Date(today).getTime();
    const todayEnd = todayStart + 86400000;

    const tasksStmt = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM task_history
      WHERE status IN ('completed', 'failed')
        AND actual_duration_ms IS NOT NULL
      GROUP BY status
    `);
    const results = tasksStmt.all() as Array<{ status: string; count: number }>;

    const completedTasks = results.find(r => r.status === 'completed')?.count ?? 0;
    const failedTasks = results.find(r => r.status === 'failed')?.count ?? 0;

    // Progress summary
    const total = completedTasks + failedTasks;
    const successRate = total > 0 ? Math.round((completedTasks / total) * 100) : 0;
    const progressSummary = `Completed ${completedTasks} tasks (${successRate}% success rate). ${failedTasks > 0 ? `${failedTasks} tasks failed - review and retry tomorrow.` : 'Great execution!'}`;

    // Accountability message based on style
    const accountabilityMessage = this.getAccountabilityMessage(completedTasks, failedTasks);

    return {
      date: today,
      completedTasks,
      failedTasks,
      progressSummary,
      accountabilityMessage,
    };
  }

  /**
   * Get accountability message based on performance and style
   */
  private getAccountabilityMessage(completed: number, failed: number): string {
    const style = this.config.accountabilityStyle;
    const total = completed + failed;
    const successRate = total > 0 ? completed / total : 0;

    if (style === 'gentle') {
      if (successRate >= 0.8) return "Wonderful progress today! 🌟 Keep it up!";
      if (successRate >= 0.5) return "Good effort! Tomorrow is a fresh start. 💚";
      return "Tough day, but tomorrow is new. Rest well. 🌙";
    } else if (style === 'coach') {
      if (successRate >= 0.8) return "Crushing it! 🔥 That's how you build momentum!";
      if (successRate >= 0.5) return "Solid work! Let's push harder tomorrow. 💪";
      return "Not your best day. Let's analyze and come back stronger. 📈";
    } else {
      // drill_sergeant
      if (successRate >= 0.8) return "OUTSTANDING! 🎯 THAT'S THE ENERGY! Keep this up!";
      if (successRate >= 0.5) return "ACCEPTABLE. But you can do better. Tomorrow: FULL ATTACK! ⚡";
      return "PATHETIC. 😤 Tomorrow you WILL do better. No excuses!";
    }
  }

  /**
   * Get motivational message based on style
   */
  private getMotivationalMessage(timeOfDay: 'morning' | 'evening'): string {
    const style = this.config.accountabilityStyle;

    const morningQuotes = {
      gentle: "Every small step counts. You've got this! 🌱",
      coach: "Today's effort = tomorrow's results. Let's go! 💪",
      drill_sergeant: "EXCELLENCE IS NOT OPTIONAL. Make today count! ⚡",
    };

    const eveningQuotes = {
      gentle: "Rest well, you earned it. Tomorrow awaits. 🌙",
      coach: "Review, learn, improve. Tomorrow's another rep! 💪",
      drill_sergeant: "MISSION COMPLETE. Rest up. War continues tomorrow! 🎯",
    };

    return timeOfDay === 'morning' ? morningQuotes[style] : eveningQuotes[style];
  }

  /**
   * Perform periodic check-in (between morning/evening windows)
   */
  private performPeriodicCheckIn(): void {
    const now = new Date();
    const currentHour = now.getHours();

    // Skip if in morning or evening window
    const inMorning = currentHour >= this.config.morningWindow.start && currentHour < this.config.morningWindow.end;
    const inEvening = currentHour >= this.config.eveningWindow.start && currentHour < this.config.eveningWindow.end;

    if (inMorning || inEvening) return;

    // Generate check-in message
    const messages = [
      "Quick check-in: How's the progress on your goals? 🎯",
      "Mid-day reminder: Stay focused on your priorities. 💪",
      "Progress check: Are you moving the needle today? 📈",
    ];

    const randomMessage = messages[Math.floor(Math.random() * messages.length)]!;

    if (this.onCheckIn) {
      this.onCheckIn(randomMessage);
    }
  }

  /**
   * Get current config
   */
  getConfig(): DailyRhythmConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<DailyRhythmConfig>): void {
    this.config = { ...this.config, ...updates };
    console.log(`[DailyRhythm] Config updated: ${JSON.stringify(this.config)}`);
  }
}

// Singleton
let instance: DailyRhythmService | null = null;

export function getDailyRhythmService(): DailyRhythmService {
  if (!instance) {
    instance = new DailyRhythmService();
  }
  return instance;
}

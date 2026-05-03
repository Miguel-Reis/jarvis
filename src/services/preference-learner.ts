/**
 * PreferenceLearnerService — Orchestrates pattern observation and preference learning
 *
 * Integrates with:
 * - PatternObserver: Detects recurring user behavior patterns
 * - UserPreferences: Stores learned preferences in Vault
 * - PromptBuilder: Injects preferences into agent system prompts
 */

import type { Service, ServiceStatus } from '../daemon/services.ts';
import { globalPatternObserver, observeUserAction, type ObservedAction } from './pattern-observer.ts';
import {
  initializePreferences,
  getPreferencesForPrompt,
  getHighConfidencePreferences,
  type PreferenceCategory,
} from '../vault/user-preferences.ts';

export class PreferenceLearnerService implements Service {
  name = 'preference-learner';
  private statusState: ServiceStatus = 'stopped';
  private observationInterval: Timer | null = null;

  /**
   * Initialize the preference learning system
   */
  async start(): Promise<void> {
    console.log('[PreferenceLearner] Starting...');
    this.statusState = 'starting';

    try {
      // Initialize database table
      initializePreferences();

      // Start periodic pattern analysis
      this.observationInterval = setInterval(() => {
        this.analyzeRecentPatterns();
      }, 60000); // Every minute

      this.statusState = 'running';
      console.log('[PreferenceLearner] Running — observing user patterns');
    } catch (err) {
      this.statusState = 'error';
      console.error('[PreferenceLearner] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[PreferenceLearner] Stopping...');
    this.statusState = 'stopping';

    if (this.observationInterval) {
      clearInterval(this.observationInterval);
      this.observationInterval = null;
    }

    this.statusState = 'stopped';
    console.log('[PreferenceLearner] Stopped');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Analyze patterns from recent observations
   */
  private analyzeRecentPatterns(): void {
    const stats = globalPatternObserver.getPatternStats();
    const activePatterns = Object.entries(stats).filter(([_, data]) => data.count > 0);

    if (activePatterns.length > 0) {
      console.log(`[PreferenceLearner] Active patterns: ${activePatterns.length}`);
    }
  }

  /**
   * Record a user action for pattern analysis
   */
  observeAction(
    type: string,
    category: PreferenceCategory,
    metadata: Record<string, unknown> = {}
  ): void {
    observeUserAction(type, category, metadata);
  }

  /**
   * Get preferences formatted for system prompt
   */
  getPromptInjection(): string {
    return getPreferencesForPrompt();
  }

  /**
   * Get high-confidence preferences for API/UI
   */
  getPreferences(threshold: number = 0.7) {
    return getHighConfidencePreferences(threshold);
  }

  /**
   * Manually set a preference (explicit user feedback)
   */
  setPreference(
    category: PreferenceCategory,
    name: string,
    value: unknown,
    confidence: number = 1.0
  ): void {
    const { observePreference, updatePreferenceConfidence } = require('../vault/user-preferences.ts');
    observePreference(category, name, value, 'explicit');
    updatePreferenceConfidence(category, name, confidence);
    console.log(`[PreferenceLearner] Explicit preference set: ${category}.${name}`);
  }
}

/**
 * Pattern Observer — Observes user actions to detect recurring patterns
 *
 * Monitors:
 * - Code editing patterns (test-first, refactor cycles)
 * - Command execution patterns
 * - File operation patterns
 * - Communication style patterns
 *
 * When a pattern is detected N times, it becomes a preference.
 */

import { observePreference, type PreferenceCategory } from '../vault/user-preferences.ts';

export interface ObservedAction {
  type: string;
  category: PreferenceCategory;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface PatternConfig {
  minOccurrences: number;      // Default: 3
  timeWindowMs: number;        // Default: 7 days
  confidenceBoost: number;     // Default: 0.1
}

const DEFAULT_CONFIG: PatternConfig = {
  minOccurrences: 3,
  timeWindowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  confidenceBoost: 0.1,
};

export class PatternObserver {
  private config: PatternConfig;
  private actionHistory: ObservedAction[] = [];
  private patternCounts: Map<string, { count: number; lastSeen: number; value: unknown }> = new Map();

  constructor(config?: Partial<PatternConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an action for pattern analysis
   */
  observe(action: ObservedAction): void {
    this.actionHistory.push(action);

    // Prune old actions outside time window
    const cutoff = Date.now() - this.config.timeWindowMs;
    this.actionHistory = this.actionHistory.filter(a => a.timestamp > cutoff);

    // Analyze for patterns
    this.analyzeForPatterns(action);
  }

  /**
   * Analyze actions for recurring patterns
   */
  private analyzeForPatterns(newAction: ObservedAction): void {
    // Pattern: Test-first development
    if (newAction.type === 'run_command') {
      const cmd = (newAction.metadata.command as string)?.toLowerCase() ?? '';
      if (cmd.includes('test') || cmd.includes('bun test')) {
        this.recordPattern('workflow.test_first', true, newAction);
      }
    }

    // Pattern: Running lint before commit
    if (newAction.type === 'run_command') {
      const cmd = (newAction.metadata.command as string)?.toLowerCase() ?? '';
      if (cmd.includes('lint') || cmd.includes('eslint')) {
        this.recordPattern('workflow.lint_before_commit', true, newAction);
      }
    }

    // Pattern: TypeScript strict mode (type annotations in writes)
    if (newAction.type === 'write_file') {
      const content = (newAction.metadata.content as string) ?? '';
      const hasTypeAnnotations = /\b(string|number|boolean|interface|type)\s*[:=]/.test(content);
      if (hasTypeAnnotations) {
        this.recordPattern('coding.typescript_strict', true, newAction);
      }
    }

    // Pattern: Creating tests after implementation
    if (newAction.type === 'write_file') {
      const path = (newAction.metadata.path as string) ?? '';
      if (path.includes('.test.') || path.includes('.spec.')) {
        this.recordPattern('testing.test_after_implementation', true, newAction);
      }
    }

    // Pattern: Verbose error messages preferred
    if (newAction.type === 'run_command') {
      const cmd = (newAction.metadata.command as string)?.toLowerCase() ?? '';
      if (cmd.includes('--verbose') || cmd.includes('-v') || cmd.includes('--debug')) {
        this.recordPattern('communication.verbose_errors', true, newAction);
      }
    }

    // Pattern: Documentation updates
    if (newAction.type === 'write_file') {
      const path = (newAction.metadata.path as string) ?? '';
      if (path.endsWith('.md') || path.includes('README') || path.includes('docs')) {
        this.recordPattern('documentation.frequent_updates', true, newAction);
      }
    }

    // Pattern: Using Bun (not npm/yarn)
    if (newAction.type === 'run_command') {
      const cmd = (newAction.metadata.command as string)?.toLowerCase() ?? '';
      if (cmd.startsWith('bun ')) {
        this.recordPattern('coding.prefers_bun', true, newAction);
      } else if (cmd.startsWith('npm ') || cmd.startsWith('yarn ')) {
        this.recordPattern('coding.prefers_bun', false, newAction);
      }
    }

    // Pattern: Code comments style
    if (newAction.type === 'write_file') {
      const content = (newAction.metadata.content as string) ?? '';
      const hasDetailedComments = /\/\*\*[\s\S]*?\*\//g.test(content);
      if (hasDetailedComments) {
        this.recordPattern('documentation.detailed_comments', true, newAction);
      }
    }
  }

  /**
   * Record a pattern occurrence
   */
  private recordPattern(
    patternName: string,
    value: unknown,
    action: ObservedAction
  ): void {
    const key = `${action.category}.${patternName}`;
    const existing = this.patternCounts.get(key);

    if (existing) {
      // Check if value matches
      if (JSON.stringify(existing.value) === JSON.stringify(value)) {
        existing.count++;
        existing.lastSeen = action.timestamp;

        // If threshold reached, save as preference
        if (existing.count >= this.config.minOccurrences) {
          observePreference(action.category, patternName, value, 'observed');
          console.log(`[PatternObserver] Pattern detected: ${patternName} (${existing.count}x)`);
        }
      } else {
        // Value changed, reset counter
        existing.count = 1;
        existing.value = value;
        existing.lastSeen = action.timestamp;
      }
    } else {
      this.patternCounts.set(key, {
        count: 1,
        lastSeen: action.timestamp,
        value,
      });
    }
  }

  /**
   * Get current pattern counts (for debugging)
   */
  getPatternStats(): Record<string, { count: number; lastSeen: number }> {
    const stats: Record<string, { count: number; lastSeen: number }> = {};
    for (const [key, data] of this.patternCounts.entries()) {
      stats[key] = { count: data.count, lastSeen: data.lastSeen };
    }
    return stats;
  }

  /**
   * Clear all observed patterns (for testing)
   */
  clear(): void {
    this.actionHistory = [];
    this.patternCounts.clear();
  }
}

/**
 * Singleton instance for global pattern observation
 */
export const globalPatternObserver = new PatternObserver();

/**
 * Observe an action through the global observer
 */
export function observeUserAction(
  type: string,
  category: PreferenceCategory,
  metadata: Record<string, unknown> = {}
): void {
  globalPatternObserver.observe({
    type,
    category,
    timestamp: Date.now(),
    metadata,
  });
}

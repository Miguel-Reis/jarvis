/**
 * Workflow Auto-Suggest — Analyzes M13 awareness patterns to suggest workflows
 *
 * Detects:
 * - Repeated app switches (e.g., copy from browser → paste in editor)
 * - Recurring errors in the same app
 * - Regular-interval manual tasks (e.g., checking email every 30 min)
 * - Repeated tool usage patterns
 */

import type { NodeRegistry } from './nodes/registry.ts';
import type { WorkflowDefinition } from './types.ts';

export type WorkflowSuggestion = {
  id: string;
  title: string;
  description: string;
  confidence: number; // 0-1
  category: 'repetitive_action' | 'error_response' | 'scheduled_task' | 'app_pattern';
  previewDefinition: WorkflowDefinition;
  patternEvidence: string[];
};

type AwarenessPattern = {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
};

export class WorkflowAutoSuggest {
  private nodeRegistry: NodeRegistry;
  private llmManager: any;
  private patterns: AwarenessPattern[] = [];
  private suggestions: WorkflowSuggestion[] = [];
  private lastAnalysis = 0;
  private analysisCooldownMs = 300_000; // 5 min

  constructor(nodeRegistry: NodeRegistry, llmManager: unknown) {
    this.nodeRegistry = nodeRegistry;
    this.llmManager = llmManager;
  }

  /**
   * Feed awareness events into the pattern buffer
   */
  addPattern(event: AwarenessPattern): void {
    this.patterns.push(event);
    // Keep last 500 events
    if (this.patterns.length > 500) {
      this.patterns = this.patterns.slice(-500);
    }
  }

  /**
   * Generate workflow suggestions from accumulated patterns
   */
  async generateSuggestions(): Promise<WorkflowSuggestion[]> {
    const now = Date.now();
    // Don't analyze too frequently
    if (now - this.lastAnalysis < this.analysisCooldownMs && this.suggestions.length > 0) {
      return this.suggestions;
    }
    this.lastAnalysis = now;

    if (this.patterns.length < 10) {
      return this.suggestions;
    }

    const detectedPatterns: WorkflowSuggestion[] = [];

    // Detect repeated app switches
    const appSwitches = this.detectAppSwitchPatterns();
    detectedPatterns.push(...appSwitches);

    // Detect recurring errors
    const errorPatterns = this.detectErrorPatterns();
    detectedPatterns.push(...errorPatterns);

    // Detect scheduled-like behavior
    const scheduledPatterns = this.detectScheduledPatterns();
    detectedPatterns.push(...scheduledPatterns);

    // Use LLM for more complex pattern detection if we have enough data
    if (this.patterns.length > 50) {
      try {
        const llmSuggestions = await this.llmAnalyzePatterns();
        detectedPatterns.push(...llmSuggestions);
      } catch {
        // LLM analysis is best-effort
      }
    }

    // Deduplicate by title
    const seen = new Set<string>();
    this.suggestions = detectedPatterns.filter(s => {
      if (seen.has(s.title)) return false;
      seen.add(s.title);
      return true;
    }).slice(0, 10);

    return this.suggestions;
  }

  /**
   * Dismiss a suggestion
   */
  dismiss(id: string): void {
    this.suggestions = this.suggestions.filter(s => s.id !== id);
  }

  // ── Pattern detection ──

  private detectAppSwitchPatterns(): WorkflowSuggestion[] {
    const suggestions: WorkflowSuggestion[] = [];
    const appSwitchEvents = this.patterns.filter(p => p.type === 'context_change');

    // Look for repeated A→B→A switches (copy-paste patterns)
    const switchPairs: Map<string, number> = new Map();
    for (let i = 1; i < appSwitchEvents.length; i++) {
      const from = String(appSwitchEvents[i - 1]!.data.appName ?? '');
      const to = String(appSwitchEvents[i]!.data.appName ?? '');
      if (from && to && from !== to) {
        const key = `${from}→${to}`;
        switchPairs.set(key, (switchPairs.get(key) ?? 0) + 1);
      }
    }

    for (const [pair, count] of switchPairs) {
      if (count >= 5) {
        const [from, to] = pair.split('→');
        suggestions.push({
          id: `suggest-switch-${Date.now()}-${from}-${to}`,
          title: `Automate ${from} → ${to} workflow`,
          description: `You frequently switch between ${from} and ${to} (${count} times recently). Consider automating this.`,
          confidence: Math.min(count / 20, 0.9),
          category: 'app_pattern',
          patternEvidence: [`${count} switches between ${from} and ${to}`],
          previewDefinition: {
            nodes: [
              { id: 'trigger-1', type: 'trigger.screen', label: `Watch ${from}`, position: { x: 100, y: 200 }, config: { condition_type: 'app_active', app_name: from } },
              { id: 'action-1', type: 'action.notification', label: `Notify about ${to}`, position: { x: 400, y: 200 }, config: { message: `Ready to switch to ${to}?` } },
            ],
            edges: [
              { id: 'e-1', source: 'trigger-1', target: 'action-1' },
            ],
            settings: { maxRetries: 1, retryDelayMs: 5000, timeoutMs: 60000, parallelism: 'sequential', onError: 'stop' },
          },
        });
      }
    }

    return suggestions;
  }

  private detectErrorPatterns(): WorkflowSuggestion[] {
    const suggestions: WorkflowSuggestion[] = [];
    const errorEvents = this.patterns.filter(p => p.type === 'error_detected');

    // Group errors by app
    const errorsByApp: Map<string, number> = new Map();
    for (const evt of errorEvents) {
      const app = String(evt.data.appName ?? 'unknown');
      errorsByApp.set(app, (errorsByApp.get(app) ?? 0) + 1);
    }

    for (const [app, count] of errorsByApp) {
      if (count >= 3) {
        suggestions.push({
          id: `suggest-error-${Date.now()}-${app}`,
          title: `Auto-respond to ${app} errors`,
          description: `${app} has had ${count} errors recently. Set up automatic error handling.`,
          confidence: Math.min(count / 10, 0.85),
          category: 'error_response',
          patternEvidence: [`${count} errors in ${app}`],
          previewDefinition: {
            nodes: [
              { id: 'trigger-1', type: 'trigger.screen', label: `Detect ${app} error`, position: { x: 100, y: 200 }, config: { condition_type: 'text_present', text: 'error' } },
              { id: 'action-1', type: 'action.agent_task', label: 'Research fix', position: { x: 400, y: 200 }, config: { task: `Research and suggest a fix for the error in ${app}` } },
              { id: 'action-2', type: 'action.notification', label: 'Notify solution', position: { x: 700, y: 200 }, config: { message: '{{$node["action-1"].data.response}}' } },
            ],
            edges: [
              { id: 'e-1', source: 'trigger-1', target: 'action-1' },
              { id: 'e-2', source: 'action-1', target: 'action-2' },
            ],
            settings: { maxRetries: 2, retryDelayMs: 5000, timeoutMs: 120000, parallelism: 'sequential', onError: 'continue' },
          },
        });
      }
    }

    return suggestions;
  }

  private detectScheduledPatterns(): WorkflowSuggestion[] {
    const suggestions: WorkflowSuggestion[] = [];

    // Look for events that happen at roughly the same time daily
    const eventsByHour: Map<number, AwarenessPattern[]> = new Map();
    for (const p of this.patterns) {
      const hour = new Date(p.timestamp).getHours();
      const existing = eventsByHour.get(hour) ?? [];
      existing.push(p);
      eventsByHour.set(hour, existing);
    }

    for (const [hour, events] of eventsByHour) {
      // Group by type within the hour
      const typeCount: Map<string, number> = new Map();
      for (const e of events) {
        typeCount.set(e.type, (typeCount.get(e.type) ?? 0) + 1);
      }

      for (const [type, count] of typeCount) {
        if (count >= 3 && type === 'context_change') {
          const apps = [...new Set(events.filter(e => e.type === type).map(e => String(e.data.appName ?? '')))].filter(Boolean);
          if (apps.length > 0) {
            suggestions.push({
              id: `suggest-scheduled-${Date.now()}-${hour}`,
              title: `Schedule ${hour}:00 routine`,
              description: `You regularly use ${apps.slice(0, 3).join(', ')} around ${hour}:00. Automate this routine.`,
              confidence: Math.min(count / 10, 0.7),
              category: 'scheduled_task',
              patternEvidence: [`${count} occurrences around ${hour}:00`],
              previewDefinition: {
                nodes: [
                  { id: 'trigger-1', type: 'trigger.cron', label: `Daily at ${hour}:00`, position: { x: 100, y: 200 }, config: { expression: `0 ${hour} * * *` } },
                  { id: 'action-1', type: 'action.notification', label: 'Start routine', position: { x: 400, y: 200 }, config: { message: `Time for your ${hour}:00 routine with ${apps[0]}` } },
                ],
                edges: [
                  { id: 'e-1', source: 'trigger-1', target: 'action-1' },
                ],
                settings: { maxRetries: 1, retryDelayMs: 5000, timeoutMs: 60000, parallelism: 'sequential', onError: 'stop' },
              },
            });
          }
        }
      }
    }

    return suggestions;
  }

  private async llmAnalyzePatterns(): Promise<WorkflowSuggestion[]> {
    // Summarize recent patterns for LLM analysis
    const recentPatterns = this.patterns.slice(-100).map(p => ({
      type: p.type,
      app: p.data.appName ?? p.data.app ?? undefined,
      time: new Date(p.timestamp).toLocaleTimeString(),
    }));

    const prompt = [
      {
        role: 'system' as const,
        content: `You analyze user behavior patterns and suggest automation workflows. Respond with a JSON array of suggestions. Each suggestion should have: title (string), description (string), confidence (0-1), category (repetitive_action|error_response|scheduled_task|app_pattern). Only suggest if you see clear patterns. Return [] if no strong patterns.`,
      },
      {
        role: 'user' as const,
        content: `Here are recent user activity patterns:\n${JSON.stringify(recentPatterns, null, 2)}\n\nWhat workflow automations would you suggest?`,
      },
    ];

    const response = await this.llmManager.chat(prompt, { temperature: 0.3, max_tokens: 2000 });
    const text = response.content;

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed.slice(0, 3).map((s: any, i: number) => ({
        id: `suggest-llm-${Date.now()}-${i}`,
        title: s.title ?? 'Suggested workflow',
        description: s.description ?? '',
        confidence: Math.min(s.confidence ?? 0.5, 0.9),
        category: s.category ?? 'repetitive_action',
        patternEvidence: ['Detected by AI analysis'],
        previewDefinition: {
          nodes: [
            { id: 'trigger-1', type: 'trigger.manual', label: 'Manual Trigger', position: { x: 100, y: 200 }, config: {} },
          ],
          edges: [],
          settings: { maxRetries: 3, retryDelayMs: 5000, timeoutMs: 300000, parallelism: 'parallel', onError: 'stop' },
        },
      }));
    } catch {
      return [];
    }
  }
}

/**
 * ScreenConditionEvaluator — evaluates visual conditions for screen-based triggers
 *
 * Supports instant text/app conditions as well as LLM-backed visual checks.
 */

// ── Types ──

export type ScreenConditionType =
  | 'text_present'
  | 'text_absent'
  | 'app_active'
  | 'visual_match'
  | 'llm_check';

export type ScreenCondition = {
  type: ScreenConditionType;
  /** For text_present / text_absent: the text substring to look for */
  text?: string;
  /** For app_active: the application name to check */
  appName?: string;
  /** For visual_match: a description of what should be visible */
  description?: string;
  /** For llm_check: a natural-language prompt sent to the LLM */
  prompt?: string;
  /** Optional: case-sensitive matching (default: false) */
  caseSensitive?: boolean;
};

export type ConditionResult = {
  matched: boolean;
  reason: string;
};

// ── ScreenConditionEvaluator ──

export class ScreenConditionEvaluator {
  private llmManager: unknown;

  constructor(llmManager: unknown) {
    this.llmManager = llmManager;
  }

  /**
   * Evaluate a screen condition.
   *
   * - text_present / text_absent: instant, no LLM needed
   * - app_active: instant, checks appName against current active app
   * - visual_match / llm_check: defers to LLM (async, requires llmManager)
   *
   * @param condition - The condition to evaluate
   * @param ocrText - Current screen OCR text (for text-based conditions)
   * @param appName - Currently active application name (for app_active)
   * @returns boolean result
   */
  async evaluate(
    condition: ScreenCondition,
    ocrText?: string,
    appName?: string,
  ): Promise<boolean> {
    switch (condition.type) {
      case 'text_present':
        return this.evaluateTextPresent(condition, ocrText ?? '');

      case 'text_absent':
        return this.evaluateTextAbsent(condition, ocrText ?? '');

      case 'app_active':
        return this.evaluateAppActive(condition, appName ?? '');

      case 'visual_match':
        return this.evaluateVisualMatch(condition, ocrText ?? '', appName ?? '');

      case 'llm_check':
        return this.evaluateLlmCheck(condition, ocrText ?? '', appName ?? '');

      default: {
        // TypeScript exhaustiveness guard
        const _exhaustive: never = condition.type;
        console.warn(`[ScreenConditionEvaluator] Unknown condition type: ${String(_exhaustive)}`);
        return false;
      }
    }
  }

  // ── Instant evaluators ──

  private evaluateTextPresent(condition: ScreenCondition, ocrText: string): boolean {
    if (!condition.text) {
      console.warn('[ScreenConditionEvaluator] text_present condition missing "text" field');
      return false;
    }

    if (condition.caseSensitive) {
      return ocrText.includes(condition.text);
    }

    return ocrText.toLowerCase().includes(condition.text.toLowerCase());
  }

  private evaluateTextAbsent(condition: ScreenCondition, ocrText: string): boolean {
    return !this.evaluateTextPresent({ ...condition, type: 'text_present' }, ocrText);
  }

  private evaluateAppActive(condition: ScreenCondition, activeApp: string): boolean {
    if (!condition.appName) {
      console.warn('[ScreenConditionEvaluator] app_active condition missing "appName" field');
      return false;
    }

    // No active app is running — condition cannot match
    if (!activeApp) return false;

    const target = condition.caseSensitive
      ? condition.appName
      : condition.appName.toLowerCase();

    const current = condition.caseSensitive
      ? activeApp
      : activeApp.toLowerCase();

    // Support partial match (e.g. "Chrome" matches "Google Chrome")
    return current.includes(target) || target.includes(current);
  }

  // ── LLM-backed evaluators ──

  private async evaluateVisualMatch(
    condition: ScreenCondition,
    ocrText: string,
    appName: string,
  ): Promise<boolean> {
    if (!condition.description) {
      console.warn('[ScreenConditionEvaluator] visual_match condition missing "description" field');
      return false;
    }

    if (!this.llmManager) {
      console.warn('[ScreenConditionEvaluator] No LLM manager available for visual_match — returning false');
      return false;
    }

    const prompt = [
      `You are evaluating a screen condition for workflow automation.`,
      ``,
      `Current screen state:`,
      `- Active application: ${appName || '(unknown)'}`,
      `- OCR text on screen: ${ocrText ? `"${ocrText.slice(0, 2000)}"` : '(none)'}`,
      ``,
      `Condition to check: "${condition.description}"`,
      ``,
      `Does the current screen state match this description? Answer with ONLY "yes" or "no".`,
    ].join('\n');

    return this.askLlm(prompt);
  }

  private async evaluateLlmCheck(
    condition: ScreenCondition,
    ocrText: string,
    appName: string,
  ): Promise<boolean> {
    if (!condition.prompt) {
      console.warn('[ScreenConditionEvaluator] llm_check condition missing "prompt" field');
      return false;
    }

    if (!this.llmManager) {
      console.warn('[ScreenConditionEvaluator] No LLM manager available for llm_check — returning false');
      return false;
    }

    const systemContext = [
      `You are a screen state evaluator for workflow automation.`,
      `Current screen state:`,
      `- Active application: ${appName || '(unknown)'}`,
      `- OCR text visible: ${ocrText ? `"${ocrText.slice(0, 2000)}"` : '(none)'}`,
      ``,
      `Answer the following question about the screen state with ONLY "yes" or "no".`,
    ].join('\n');

    const fullPrompt = `${systemContext}\n\n${condition.prompt}`;
    return this.askLlm(fullPrompt);
  }

  /**
   * Ask the LLM manager a yes/no question and parse the response.
   */
  private async askLlm(prompt: string): Promise<boolean> {
    try {
      // llmManager is loosely typed (unknown) to avoid circular deps.
      // We cast it to access the expected interface.
      const mgr = this.llmManager as {
        complete?: (prompt: string, opts?: Record<string, unknown>) => Promise<{ text: string }>;
        chat?: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string }>;
      };

      let responseText: string | null = null;

      if (typeof mgr.complete === 'function') {
        const result = await mgr.complete(prompt, { max_tokens: 10, temperature: 0 });
        responseText = result.text;
      } else if (typeof mgr.chat === 'function') {
        const result = await mgr.chat([{ role: 'user', content: prompt }]);
        responseText = result.content;
      } else {
        console.warn('[ScreenConditionEvaluator] llmManager has no usable interface');
        return false;
      }

      const normalized = (responseText ?? '').trim().toLowerCase();
      return normalized.startsWith('yes');
    } catch (err) {
      console.error('[ScreenConditionEvaluator] LLM evaluation failed:', err);
      return false;
    }
  }
}

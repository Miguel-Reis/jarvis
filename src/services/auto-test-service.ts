/**
 * Automated Testing Service
 *
 * Automatically runs tests when code changes are detected.
 * Integrates with InterruptManager to report failures.
 *
 * Features:
 * - Watch mode for file changes
 * - Auto-run on save
 * - Failure reporting via interrupts
 * - Fix suggestions via LLM
 */

import type { Service, ServiceStatus } from '../daemon/services.ts';
import { watch, type FSWatcher } from 'node:fs';
import { join, extname } from 'node:path';
import type { InterruptManager } from '../agents/interrupt-manager.ts';

export interface AutoTestConfig {
  enabled: boolean;
  watchPatterns: string[];       // Files to watch
  ignorePatterns: string[];      // Files to ignore
  runOnSave: boolean;            // Run tests on every save
  runOnHeartbeat: boolean;       // Run tests on heartbeat
  suggestFixes: boolean;         // Suggest fixes via LLM
  testCommand: string;           // Default: 'bun test'
  debounceMs: number;            // Debounce rapid saves (default: 500ms)
}

const DEFAULT_CONFIG: AutoTestConfig = {
  enabled: true,
  watchPatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  ignorePatterns: ['node_modules', 'dist', 'build', '.git', '*.test.ts', '*.spec.ts'],
  runOnSave: true,
  runOnHeartbeat: false,
  suggestFixes: true,
  testCommand: 'bun test',
  debounceMs: 500,
};

export class AutoTestService implements Service {
  name = 'auto-test';
  private config: AutoTestConfig;
  private statusState: ServiceStatus = 'stopped';
  private interruptManager?: InterruptManager;
  private watchers: FSWatcher[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private lastTestRun = 0;
  private lastTestResult: { passed: boolean; output: string; timestamp: number } | null = null;
  private onTestComplete?: (result: { passed: boolean; output: string }) => void;

  constructor(config?: Partial<AutoTestConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set interrupt manager for failure reporting
   */
  setInterruptManager(manager: InterruptManager): void {
    this.interruptManager = manager;
  }

  /**
   * Set test complete callback
   */
  setTestCompleteCallback(callback: (result: { passed: boolean; output: string }) => void): void {
    this.onTestComplete = callback;
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[AutoTest] Starting...');
    this.statusState = 'starting';

    try {
      if (this.config.enabled && this.config.runOnSave) {
        this.startFileWatchers();
      }

      this.statusState = 'running';
      console.log('[AutoTest] Running (watch mode active)');
    } catch (err) {
      this.statusState = 'error';
      console.error('[AutoTest] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[AutoTest] Stopping...');
    this.statusState = 'stopping';

    // Close all watchers
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore
      }
    }
    this.watchers = [];

    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.statusState = 'stopped';
    console.log('[AutoTest] Stopped');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Start watching files for changes
   */
  private startFileWatchers(): void {
    const watchPath = process.cwd();
    console.log(`[AutoTest] Watching ${watchPath} for changes...`);

    const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
      if (!filename || filename === '.DS_Store') return;

      // Check if file matches patterns
      if (!this.shouldWatchFile(filename)) return;

      const filePath = join(watchPath, filename);
      console.log(`[AutoTest] Change detected: ${filename} (${eventType})`);

      // Debounce rapid saves
      const existingTimer = this.debounceTimers.get(filePath);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        this.runTests(filePath).catch(err =>
          console.error('[AutoTest] Test run error:', err instanceof Error ? err.message : err)
        );
        this.debounceTimers.delete(filePath);
      }, this.config.debounceMs);

      this.debounceTimers.set(filePath, timer);
    });

    watcher.on('error', (err) => {
      console.error('[AutoTest] Watcher error:', err.message);
    });

    this.watchers.push(watcher);
    console.log('[AutoTest] File watchers active');
  }

  /**
   * Check if a file should be watched
   */
  private shouldWatchFile(filename: string): boolean {
    const ext = extname(filename).toLowerCase();

    // Check extension
    const validExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    if (!validExtensions.includes(ext)) return false;

    // Check ignore patterns
    for (const pattern of this.config.ignorePatterns) {
      if (filename.includes(pattern) || filename.endsWith(pattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Run tests
   */
  async runTests(triggerFile?: string): Promise<{ passed: boolean; output: string }> {
    console.log(`[AutoTest] Running tests${triggerFile ? ` (triggered by ${triggerFile})` : ''}`);

    try {
      const result = Bun.spawnSync(this.config.testCommand.split(' '), {
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = result.stdout.toString() + result.stderr.toString();
      const passed = result.exitCode === 0;

      this.lastTestRun = Date.now();
      this.lastTestResult = { passed, output, timestamp: this.lastTestRun };

      console.log(`[AutoTest] Tests ${passed ? 'PASSED' : 'FAILED'} (${(output.length / 1024).toFixed(1)}KB output)`);

      // Report failures
      if (!passed && this.interruptManager) {
        await this.interruptManager.triggerInterrupt({
          type: 'test_failure',
          severity: 'high',
          data: {
            triggerFile,
            output: output.slice(0, 2000),
            testCommand: this.config.testCommand,
          },
          message: `Tests failed: ${output.split('\n').find(l => l.includes('FAIL') || l.includes('Error'))?.slice(0, 100) ?? 'Test failure detected'}`,
        });

        // Suggest fix via LLM
        if (this.config.suggestFixes) {
          await this.suggestFix(output, triggerFile);
        }
      }

      // Callback for UI
      if (this.onTestComplete) {
        this.onTestComplete({ passed, output });
      }

      return { passed, output };
    } catch (err) {
      const errorOutput = err instanceof Error ? err.message : String(err);
      this.lastTestResult = { passed: false, output: errorOutput, timestamp: Date.now() };

      console.error('[AutoTest] Test execution error:', errorOutput);

      if (this.interruptManager) {
        await this.interruptManager.triggerInterrupt({
          type: 'test_execution_error',
          severity: 'high',
          data: { error: errorOutput, triggerFile },
          message: `Test execution error: ${errorOutput.slice(0, 100)}`,
        });
      }

      return { passed: false, output: errorOutput };
    }
  }

  /**
   * Suggest fix for test failure via LLM
   */
  private async suggestFix(errorOutput: string, triggerFile?: string): Promise<void> {
    try {
      const { Anthropic } = await import('@anthropic-ai/sdk');

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return;

      const anthropic = new Anthropic({ apiKey });

      const prompt = `Tests failed with this error:
${errorOutput.slice(0, 2000)}

${triggerFile ? `The change was in: ${triggerFile}\n\n` : ''}
Provide a brief, actionable fix suggestion (max 3 sentences). Start with the solution, not an explanation.`;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6' as any,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      const textBlock = response.content.find((b: any) => b.type === 'text') as any;
      const suggestion = textBlock?.text as string | undefined;

      if (suggestion && this.interruptManager) {
        await this.interruptManager.triggerInterrupt({
          type: 'test_fix_suggestion',
          severity: 'medium',
          data: { suggestion, originalError: errorOutput.slice(0, 500) },
          message: `Fix suggestion: ${suggestion.slice(0, 150)}`,
        });
      }
    } catch (err) {
      console.error('[AutoTest] Fix suggestion error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Get last test result
   */
  getLastTestResult(): { passed: boolean; output: string; timestamp: number } | null {
    return this.lastTestResult;
  }

  /**
   * Trigger manual test run
   */
  async runNow(): Promise<{ passed: boolean; output: string }> {
    console.log('[AutoTest] Manual test run triggered');
    return this.runTests();
  }

  /**
   * Enable/disable the service
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled && this.statusState === 'stopped') {
      this.start().catch(err =>
        console.error('[AutoTest] Re-start error:', err instanceof Error ? err.message : err)
      );
    } else if (!enabled && this.statusState === 'running') {
      this.stop().catch(err =>
        console.error('[AutoTest] Re-stop error:', err instanceof Error ? err.message : err)
      );
    }
    console.log(`[AutoTest] ${enabled ? 'Enabled' : 'Disabled'}`);
  }
}

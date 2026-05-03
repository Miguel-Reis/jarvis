/**
 * InterruptSystem: Fase 2 - The Senses
 * Bridges system observers (FileWatcher, ProcessMonitor, etc.) to the AgentOrchestrator.
 */

import type { AgentOrchestrator } from './orchestrator.ts';
import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';

export type InterruptSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface InterruptEvent {
  type: string;
  severity: InterruptSeverity;
  data: Record<string, unknown>;
  timestamp: number;
  message: string;
}

export interface SystemObserver {
  name: string;
  observe(): void;
  stop(): void;
}

/**
 * FileWatcherObserver — watches critical files for changes using fs.watch
 */
export class FileWatcherObserver implements SystemObserver {
  name = 'file-watcher';
  private interruptManager: InterruptManager;
  private watchPaths: string[];
  private stopWatching = false;
  private watchers: FSWatcher[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(interruptManager: InterruptManager, paths: string[] = []) {
    this.interruptManager = interruptManager;
    this.watchPaths = paths;
  }

  observe(): void {
    console.log(`[FileWatcherObserver] Starting real-time watch on ${this.watchPaths.length} path(s)`);

    for (const watchPath of this.watchPaths) {
      try {
        const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
          if (this.stopWatching || filename === '.DS_Store') return;

          // Debounce rapid file changes
          const key = `${eventType}-${filename}`;
          const existingTimer = this.debounceTimers.get(key);
          if (existingTimer) clearTimeout(existingTimer);

          const timer = setTimeout(() => {
            if (this.stopWatching || !filename) return;

            const changeType = eventType === 'rename' ? 'deleted' : 'modified';
            const filePath = `${watchPath}/${filename}`;

            console.log(`[FileWatcherObserver] Detected ${changeType}: ${filePath}`);

            // Only trigger interrupt for significant files
            if (this.isSignificantFile(filename)) {
              this.interruptManager.triggerInterrupt({
                type: 'file_change',
                severity: this.getFileSeverity(filename),
                data: { path: filePath, changeType, filename },
                message: `File ${changeType}: ${filename}`,
              }).catch(err => console.error('[FileWatcherObserver] Trigger error:', err));
            }
          }, 500); // 500ms debounce

          this.debounceTimers.set(key, timer);
        });

        watcher.on('error', (err) => {
          console.error(`[FileWatcherObserver] Watch error on ${watchPath}:`, err.message);
        });

        this.watchers.push(watcher);
      } catch (err) {
        console.error(`[FileWatcherObserver] Failed to watch ${watchPath}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log('[FileWatcherObserver] Real-time file watching active');
  }

  /**
   * Check if a file is significant enough to trigger an interrupt
   */
  private isSignificantFile(filename: string): boolean {
    const significantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.md', '.txt', '.log'];
    const significantNames = ['config', '.env', 'package.json', 'jarvis.db'];

    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return significantExtensions.includes(ext) || significantNames.includes(filename);
  }

  /**
   * Determine severity based on file type
   */
  private getFileSeverity(filename: string): InterruptSeverity {
    if (filename.includes('.env') || filename.includes('config')) return 'high';
    if (filename.endsWith('.db')) return 'high';
    if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'medium';
    return 'low';
  }

  stop(): void {
    this.stopWatching = true;

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all watchers
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
    }
    this.watchers = [];

    console.log('[FileWatcherObserver] Stopped all file watchers');
  }

  /**
   * Trigger a file change interrupt manually (for testing)
   */
  async triggerFileChange(filePath: string, changeType: 'created' | 'modified' | 'deleted'): Promise<void> {
    await this.interruptManager.triggerInterrupt({
      type: 'file_change',
      severity: 'medium',
      data: { path: filePath, changeType },
      message: `File ${changeType}: ${filePath}`,
    });
  }
}

/**
 * ProcessMonitorObserver — monitors critical processes using /proc or tasklist
 */
export class ProcessMonitorObserver implements SystemObserver {
  name = 'process-monitor';
  private interruptManager: InterruptManager;
  private monitoredProcesses: Set<string>;
  private stopMonitoring = false;
  private knownPids: Map<string, number> = new Map();
  private checkInterval: Timer | null = null;

  constructor(interruptManager: InterruptManager, processes: string[] = []) {
    this.interruptManager = interruptManager;
    this.monitoredProcesses = new Set(processes);
  }

  observe(): void {
    console.log(`[ProcessMonitorObserver] Starting process monitoring for: ${[...this.monitoredProcesses].join(', ')}`);

    // Check every 5 seconds for process changes
    this.checkInterval = setInterval(() => {
      if (this.stopMonitoring) return;

      for (const processName of this.monitoredProcesses) {
        const pid = this.findProcessByName(processName);

        if (pid) {
          // Process found
          if (!this.knownPids.has(processName)) {
            // New process started
            this.knownPids.set(processName, pid);
            console.log(`[ProcessMonitorObserver] Process started: ${processName} (PID: ${pid})`);
            this.interruptManager.triggerInterrupt({
              type: 'process_event',
              severity: 'medium',
              data: { process: processName, event: 'started', pid },
              message: `Process started: ${processName}`,
            }).catch(err => console.error('[ProcessMonitorObserver] Error:', err));
          }
        } else {
          // Process not found
          if (this.knownPids.has(processName)) {
            // Process stopped/crashed
            const oldPid = this.knownPids.get(processName)!;
            this.knownPids.delete(processName);
            console.log(`[ProcessMonitorObserver] Process stopped: ${processName} (was PID: ${oldPid})`);
            this.interruptManager.triggerInterrupt({
              type: 'process_event',
              severity: 'critical',
              data: { process: processName, event: 'stopped', pid: oldPid },
              message: `Process stopped: ${processName}`,
            }).catch(err => console.error('[ProcessMonitorObserver] Error:', err));
          }
        }
      }
    }, 5000);

    console.log('[ProcessMonitorObserver] Real-time process monitoring active (5s interval)');
  }

  /**
   * Find a process by name using platform-specific commands
   */
  private findProcessByName(name: string): number | null {
    try {
      const isWindows = process.platform === 'win32';
      const cmd = isWindows
        ? `powershell -command "Get-Process ${name} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id"`
        : `pgrep -x ${name} | head -1`;

      const result = Bun.spawnSync(cmd.split(' '), {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (result.exitCode === 0) {
        const pid = parseInt(result.stdout.toString().trim(), 10);
        if (!isNaN(pid) && pid > 0) {
          return pid;
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  stop(): void {
    this.stopMonitoring = true;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.knownPids.clear();
    console.log('[ProcessMonitorObserver] Stopped process monitoring');
  }

  /**
   * Trigger a process event interrupt manually (for testing)
   */
  async triggerProcessEvent(processName: string, event: 'started' | 'stopped' | 'crashed'): Promise<void> {
    const severity: InterruptSeverity = event === 'crashed' ? 'critical' : 'medium';
    await this.interruptManager.triggerInterrupt({
      type: 'process_event',
      severity,
      data: { process: processName, event },
      message: `Process ${event}: ${processName}`,
    });
  }
}

/**
 * ErrorMonitorObserver — watches for error patterns in Vault observations
 */
export class ErrorMonitorObserver implements SystemObserver {
  name = 'error-monitor';
  private interruptManager: InterruptManager;
  private errorPatterns: RegExp[];
  private stopMonitoring = false;
  private checkInterval: Timer | null = null;
  private lastCheckTime: number = Date.now();

  constructor(interruptManager: InterruptManager, patterns: RegExp[] = []) {
    this.interruptManager = interruptManager;
    this.errorPatterns = patterns;
  }

  observe(): void {
    console.log(`[ErrorMonitorObserver] Starting error pattern monitoring: ${this.errorPatterns.map(p => p.source).join(', ')}`);

    // Check every 3 seconds for new error observations
    this.checkInterval = setInterval(async () => {
      if (this.stopMonitoring) return;

      try {
        await this.checkForErrors();
      } catch (err) {
        console.error('[ErrorMonitorObserver] Check error:', err instanceof Error ? err.message : err);
      }
    }, 3000);

    console.log('[ErrorMonitorObserver] Real-time error monitoring active (3s interval)');
  }

  /**
   * Check vault observations for new errors
   */
  private async checkForErrors(): Promise<void> {
    const { getUnprocessed } = await import('../vault/observations.ts');

    const observations = getUnprocessed().filter(
      (obs: any) => obs.created_at > this.lastCheckTime
    );

    for (const obs of observations) {
      const errorText = this.extractErrorText(obs);
      if (!errorText) continue;

      // Check against error patterns
      for (const pattern of this.errorPatterns) {
        if (pattern.test(errorText)) {
          console.log(`[ErrorMonitorObserver] Error detected: ${errorText.slice(0, 100)}`);

          await this.interruptManager.triggerInterrupt({
            type: 'error_detected',
            severity: 'high',
            data: {
              error: errorText,
              source: obs.type,
              observationId: obs.id,
            },
            message: `Error detected: ${errorText.slice(0, 80)}`,
          });
          break; // Only trigger once per observation
        }
      }
    }

    // Update last check time
    if (observations.length > 0) {
      this.lastCheckTime = Math.max(...observations.map((o: any) => o.created_at));
    }
  }

  /**
   * Extract error text from observation data
   */
  private extractErrorText(obs: any): string | null {
    const data = obs.data;
    if (!data) return null;

    // Check common error fields
    if (typeof data.error === 'string') return data.error;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.text === 'string') return data.text;
    if (typeof data.content === 'string') return data.content;

    // Try to stringify and search
    const dataStr = JSON.stringify(data);
    if (dataStr.length < 500) return dataStr;

    return null;
  }

  stop(): void {
    this.stopMonitoring = true;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    console.log('[ErrorMonitorObserver] Stopped error monitoring');
  }

  /**
   * Trigger an error detected interrupt manually (for testing)
   */
  async triggerErrorDetected(errorText: string, source: string): Promise<void> {
    await this.interruptManager.triggerInterrupt({
      type: 'error_detected',
      severity: 'high',
      data: { error: errorText, source },
      message: `Error detected in ${source}: ${errorText.slice(0, 100)}`,
    });
  }
}

/**
 * ScreenObserver — captures screen and analyzes with VLM for visual context
 */
export class ScreenObserver implements SystemObserver {
  name = 'screen-observer';
  private interruptManager: InterruptManager;
  private stopCapturing = false;
  private captureInterval: Timer | null = null;
  private lastAnalysis: string | null = null;

  constructor(interruptManager: InterruptManager) {
    this.interruptManager = interruptManager;
  }

  observe(): void {
    console.log('[ScreenObserver] Starting visual context analysis (60s interval)');

    // Analyze screen every 60 seconds
    this.captureInterval = setInterval(async () => {
      if (this.stopCapturing) return;

      try {
        await this.captureAndAnalyze();
      } catch (err) {
        console.error('[ScreenObserver] Capture error:', err instanceof Error ? err.message : err);
      }
    }, 60000);
  }

  private async captureAndAnalyze(): Promise<void> {
    // Dynamic import to avoid circular dependency
    const { VLMAnalyzer } = await import('../services/vlm-analyzer.ts');
    const { ScreenCaptureService } = await import('../services/screen-capture.ts');

    const captureService = new ScreenCaptureService({ captureIntervalMs: 0 });
    const analyzer = new VLMAnalyzer();

    // Capture screen
    const capture = await captureService.captureScreen();
    if (!capture) return;

    // Analyze with VLM
    const context = await analyzer.analyzeCapture(capture);
    if (!context) return;

    // Only trigger interrupt if something significant changed
    const analysisKey = `${context.application}-${context.activityType}-${context.errorsVisible}`;
    if (this.lastAnalysis !== analysisKey && context.errorsVisible) {
      this.lastAnalysis = analysisKey;

      await this.interruptManager.triggerInterrupt({
        type: 'visual_context_change',
        severity: context.errorsVisible ? 'high' : 'low',
        data: {
          application: context.application,
          activity: context.activityType,
          errorsVisible: context.errorsVisible,
          errorsDescription: context.errorsDescription,
        },
        message: context.errorsVisible
          ? `Error detected in ${context.application}: ${context.errorsDescription}`
          : `Context changed to ${context.application} (${context.activityType})`,
      });
    }
  }

  stop(): void {
    this.stopCapturing = true;

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    console.log('[ScreenObserver] Stopped screen analysis');
  }
}

export class InterruptManager {
  private observers: Set<SystemObserver> = new Set();
  private orchestrator: AgentOrchestrator;

  constructor(orchestrator: AgentOrchestrator) {
    this.orchestrator = orchestrator;
  }

  /**
   * Register a system observer.
   * The observer should call triggerInterrupt when a significant event occurs.
   */
  registerObserver(observer: SystemObserver): void {
    this.observers.add(observer);
    observer.observe();
    console.log(`[InterruptManager] Registered observer: ${observer.name}`);
  }

  /**
   * Trigger an interrupt that pivots the orchestrator to a new high-priority task.
   * Timestamps are automatically added.
   */
  async triggerInterrupt(event: Omit<InterruptEvent, 'timestamp'>): Promise<void> {
    const fullEvent: InterruptEvent = {
      ...event,
      timestamp: Date.now(),
    };
    console.log(`[InterruptManager] 🚨 INTERRUPT TRIGGERED [${fullEvent.severity.toUpperCase()}]: ${fullEvent.message}`);

    if (this.orchestrator && typeof this.orchestrator.interrupt === 'function') {
      await this.orchestrator.interrupt(fullEvent);
    } else {
      console.error('[InterruptManager] Orchestrator does not support interrupt() method.');
    }
  }

  unregisterObserver(observer: SystemObserver): void {
    observer.stop();
    this.observers.delete(observer);
  }

  shutdown(): void {
    for (const observer of this.observers) {
      observer.stop();
    }
    this.observers.clear();
  }
}

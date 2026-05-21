/**
 * ProjectContextService — Manages project-specific context switching
 *
 * - Detects git root changes
 * - Loads project-specific context
 * - Injects context into agent prompts
 * - Maintains session history per project
 */

import type { Service, ServiceStatus } from '../daemon/types.ts';
import {
  initializeProjectContexts,
  getOrCreateCurrentProjectContext,
  getProjectContextByPath,
  getProjectContextForPrompt,
  upsertProjectContext,
  type ProjectContext,
  findGitRoot,
} from '../vault/project-contexts.ts';
import type { FSWatcher } from 'node:fs';

export interface ProjectContextConfig {
  enabled: boolean;
  autoDetect: boolean;      // Auto-detect git root changes
  watchInterval: number;    // ms between checks (default: 5000)
}

const DEFAULT_CONFIG: ProjectContextConfig = {
  enabled: true,
  autoDetect: true,
  watchInterval: 5000,
};

export class ProjectContextService implements Service {
  name = 'project-context';
  private config: ProjectContextConfig;
  private statusState: ServiceStatus = 'stopped';
  private currentProject: ProjectContext | null = null;
  private watchInterval: Timer | null = null;
  private lastKnownPath: string | null = null;
  private cwdWatcher: FSWatcher | null = null;

  constructor(config?: Partial<ProjectContextConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[ProjectContext] Starting...');
    this.statusState = 'starting';

    try {
      // Initialize database table
      initializeProjectContexts();

      // Initial context load
      this.currentProject = getOrCreateCurrentProjectContext();
      this.lastKnownPath = process.cwd();

      if (this.currentProject) {
        console.log(`[ProjectContext] Loaded: ${this.currentProject.name}`);
      }

      // Start path watcher if auto-detect enabled
      if (this.config.autoDetect) {
        this.startPathWatcher();
      }

      this.statusState = 'running';
      console.log('[ProjectContext] Running — auto-detect enabled');
    } catch (err) {
      this.statusState = 'error';
      console.error('[ProjectContext] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[ProjectContext] Stopping...');
    this.statusState = 'stopping';

    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    if (this.cwdWatcher) {
      try {
        this.cwdWatcher.close();
      } catch {
        // Ignore
      }
      this.cwdWatcher = null;
    }

    this.statusState = 'stopped';
    console.log('[ProjectContext] Stopped');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Start watching for directory changes
   */
  private startPathWatcher(): void {
    // Poll-based detection (more reliable than fs.watch for cwd changes)
    this.watchInterval = setInterval(() => {
      const currentPath = process.cwd();

      if (currentPath !== this.lastKnownPath) {
        console.log(`[ProjectContext] Path changed: ${this.lastKnownPath} → ${currentPath}`);
        this.checkForProjectChange(currentPath);
        this.lastKnownPath = currentPath;
      }
    }, this.config.watchInterval);

    console.log(`[ProjectContext] Path watcher active (${this.config.watchInterval}ms interval)`);
  }

  /**
   * Check if project context needs to change
   */
  private checkForProjectChange(newPath: string): void {
    const newGitRoot = findGitRoot(newPath);

    if (!newGitRoot) {
      // Not in a git repo
      if (this.currentProject) {
        console.log('[ProjectContext] Left git repository, clearing context');
        this.currentProject = null;
      }
      return;
    }

    if (!this.currentProject || this.currentProject.rootPath !== newGitRoot) {
      // Project changed
      const project = getProjectContextByPath(newGitRoot) || getOrCreateCurrentProjectContext(newPath);

      if (project) {
        console.log(`[ProjectContext] Switched to: ${project.name}`);
        this.currentProject = project;

        // Broadcast context change event
        this.broadcastContextChange(project);
      }
    }
  }

  /**
   * Broadcast context change via custom event (for WebSocket to pick up)
   */
  private broadcastContextChange(project: ProjectContext): void {
    // Emit event for other services to listen to
    const event = new CustomEvent('project-context-changed', {
      detail: { project },
    });
    globalThis.dispatchEvent(event);

    console.log(`[ProjectContext] Context change broadcast: ${project.name}`);
  }

  /**
   * Get current project context
   */
  getCurrentProject(): ProjectContext | null {
    return this.currentProject;
  }

  /**
   * Get formatted context for system prompt
   */
  getPromptInjection(): string {
    if (!this.currentProject) {
      return '';
    }
    return getProjectContextForPrompt(this.currentProject);
  }

  /**
   * Manually set or update project context
   */
  setProjectContext(
    name: string,
    rootPath: string,
    architecture: {
      patterns: string[];
      techStack: string[];
      constraints: string[];
    },
    dependencies?: Record<string, string>,
    description?: string
  ): ProjectContext {
    const project = upsertProjectContext(name, rootPath, architecture, dependencies, description);
    this.currentProject = project;
    this.lastKnownPath = rootPath;
    console.log(`[ProjectContext] Manually set: ${project.name}`);
    return project;
  }

  /**
   * Update current project's current goal
   */
  setCurrentGoal(goal: string): void {
    if (this.currentProject) {
      const { setProjectCurrentGoal } = require('../vault/project-contexts.ts');
      setProjectCurrentGoal(this.currentProject.rootPath, goal);
      this.currentProject.currentGoal = goal;
      console.log(`[ProjectContext] Goal updated: ${goal}`);
    }
  }

  /**
   * Get all projects
   */
  getAllProjects(): ProjectContext[] {
    const { getAllProjects } = require('../vault/project-contexts.ts');
    return getAllProjects();
  }
}

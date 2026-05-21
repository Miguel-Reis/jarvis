/**
 * Base Agent Service
 *
 * Shared base class for AgentService and BackgroundAgentService.
 * Contains common prompt building, knowledge extraction, and learning logic.
 */

import type { JarvisConfig } from '../config/types.ts';
import type { RoleDefinition } from '../roles/types.ts';
import type { PromptContext } from '../roles/prompt-builder.ts';
import { buildSystemPrompt, getArchitecturalConstraints } from '../roles/prompt-builder.ts';
import { loadActiveRoleFromConfig } from '../roles/loader.ts';
import { getDueCommitments, getUpcoming } from '../vault/commitments.ts';
import { getRecentObservations } from '../vault/observations.ts';
import { findContent } from '../vault/content-pipeline.ts';
import { getActiveGoalsSummary } from '../vault/retrieval.ts';
import { getPreferencesForPrompt } from '../vault/user-preferences.ts';
import { extractAndStore } from '../vault/extractor.ts';
import { getActiveProjectId, getProject } from '../vault/projects.ts';
import { getWebappInstructionsForMessage } from '../vault/webapp-templates.ts';
import { formatUserProfileForPrompt } from '../user/profile.ts';
import { getUserProfile } from '../vault/user-profile.ts';

export abstract class BaseAgentService {
  protected config: JarvisConfig;
  protected role: RoleDefinition | null = null;

  constructor(config: JarvisConfig) {
    this.config = config;
  }

  /**
   * Load active role from config using centralized loader
   */
  protected loadActiveRole(): RoleDefinition {
    const role = loadActiveRoleFromConfig(this.config.active_role);
    console.log(`[${this.constructor.name}] Loaded role '${role.name}'`);
    return role;
  }

  /**
   * Build prompt context with live data from the vault
   */
  protected buildPromptContext(userMessage?: string, precomputedKnowledge?: string): PromptContext {
    const due = getDueCommitments();
    const upcoming = getUpcoming(5);
    const activeCommitments: string[] = [];

    const formatDue = (ms: number | null) => (ms ? new Date(ms).toISOString() : 'no deadline');
    for (const c of due) {
      activeCommitments.push(`- [${c.status.toUpperCase()}] ${c.what} (due: ${formatDue(c.when_due)})`);
    }
    for (const c of upcoming) {
      activeCommitments.push(`- [SCHEDULED] ${c.what} (due: ${formatDue(c.when_due)})`);
    }

    const recentObservations = getRecentObservations(undefined, 5).map(o => {
      const summary = JSON.stringify(o.data).slice(0, 200);
      return `- [${o.type}] ${summary}`;
    });

    const contentItems = findContent({}).slice(0, 5).map(
      c => `- ${c.title} (${c.content_type}): ${c.stage}`
    );

    const projectId = getActiveProjectId();
    const currentProject = projectId ? getProject(projectId) : null;

    const webappInstructions = userMessage
      ? getWebappInstructionsForMessage(userMessage)
      : undefined;

    const preferences = getPreferencesForPrompt();
    const userProfile = getUserProfile();
    const userProfileText = userProfile ? formatUserProfileForPrompt(userProfile) : undefined;

    return {
      activeCommitments: activeCommitments.length > 0 ? activeCommitments : undefined,
      recentObservations: recentObservations.length > 0 ? recentObservations : undefined,
      contentPipeline: contentItems.length > 0 ? contentItems : undefined,
      currentProject: currentProject
        ? { name: currentProject.name, description: currentProject.description, path: currentProject.path }
        : undefined,
      knowledgeContext: precomputedKnowledge,
      webappInstructions,
      userPreferences: preferences || undefined,
      userProfile: userProfileText,
      architecturalConstraints: getArchitecturalConstraints(),
      activeGoals: getActiveGoalsSummary(),
    };
  }

  /**
   * Build full system prompt from role and context
   */
  protected buildFullSystemPrompt(_channel?: string, userMessage?: string, precomputedKnowledge?: string): string {
    if (!this.role) return '';
    const context = this.buildPromptContext(userMessage, precomputedKnowledge);
    return buildSystemPrompt(this.role, context);
  }

  /**
   * Build heartbeat system prompt
   */
  protected buildHeartbeatPrompt(coalescedEvents?: string): string {
    if (!this.role) return '';
    const context = this.buildPromptContext();
    const rolePrompt = buildSystemPrompt(this.role, context);
    const parts = [rolePrompt, '', '# Heartbeat Check', this.role.heartbeat_instructions];
    if (coalescedEvents) {
      parts.push('', '# Recent System Events', coalescedEvents);
    }
    parts.push('', '# COMMITMENT EXECUTION');
    parts.push('If any commitments are overdue or due soon, EXECUTE them now using your tools.');
    parts.push('Do not just mention them — actually perform the work. Use browse, terminal, file operations as needed.');
    return parts.join('\n');
  }

  /**
   * Extract knowledge from user message and assistant response
   */
  protected async extractKnowledge(userMessage: string, fullResponse: string): Promise<void> {
    try {
      await extractAndStore(userMessage, fullResponse);
    } catch (err) {
      console.error(`[${this.constructor.name}] Knowledge extraction error:`, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Learn from user interaction (personality adaptation).
   * No-op in the base class — subclasses override with real signal extraction.
   */
  protected async learnFromInteraction(_userMessage: string, _fullResponse: string, _channel: string): Promise<void> {
    // intentionally empty
  }
}

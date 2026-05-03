/**
 * REST API Routes — thin aggregator over domain route modules.
 *
 * Each domain has its own file in ./routes/. This file re-exports them
 * all and provides the final merged routes object for Bun.serve().
 *
 * To add or modify routes: edit the appropriate module in ./routes/.
 */

import type { HealthMonitor } from './health.ts';
import type { AgentService } from './agent-service.ts';
import type { JarvisConfig } from '../config/types.ts';
import type { EntityType } from '../vault/entities.ts';
import type { CommitmentPriority, CommitmentStatus } from '../vault/commitments.ts';
import type { ObservationType } from '../vault/observations.ts';
import type { ContentStage, ContentType } from '../vault/content-pipeline.ts';
import type { AuthorityEngine } from '../authority/engine.ts';
import type { ApprovalManager } from '../authority/approval.ts';
import type { AuditTrail, AuthorityDecisionType } from '../authority/audit.ts';
import type { AuthorityLearner } from '../authority/learning.ts';
import type { EmergencyController } from '../authority/emergency.ts';
import type { DeferredExecutor } from '../authority/deferred-executor.ts';
import type { ActionCategory } from '../roles/authority.ts';
import type { AwarenessService } from '../awareness/service.ts';
import type { WebSocketService } from './ws-service.ts';
import type { ChannelService } from './channel-service.ts';

// Re-export shared helpers for backward compatibility
export { setCorsOrigin, json, error, getSearchParams } from './routes/_shared.ts';

// ── Domain route modules ─────────────────────────────────────────────────────────

import { registerRoutes as vaultRoutes } from './routes/vault.ts';
import { registerRoutes as commitmentRoutes } from './routes/commitments.ts';
import { registerRoutes as agentRoutes } from './routes/agents.ts';
import { registerRoutes as contentRoutes } from './routes/content.ts';
import { registerRoutes as workflowRoutes } from './routes/workflows.ts';
import { registerRoutes as goalRoutes } from './routes/goals.ts';
import { registerRoutes as awarenessRoutes } from './routes/awareness.ts';
import { registerRoutes as authorityRoutes } from './routes/authority.ts';
import { registerRoutes as configRoutes } from './routes/config.ts';
import { registerRoutes as projectRoutes } from './routes/projects.ts';
import { registerRoutes as mcpRoutes } from './routes/mcp.ts';
import { registerRoutes as miscRoutes } from './routes/misc.ts';
import { registerRoutes as superJarvisRoutes } from './routes/super-jarvis.ts';
import { registerRoutes as preferencesRoutes } from './routes/preferences.ts';
import { registerRoutes as metricsRoutes } from './routes/metrics.ts';
import { registerRoutes as coordinationRoutes } from './routes/coordination.ts';
import { registerRoutes as statusRoutes } from './routes/status.ts';

// ── Shared helpers (also re-exported above for external use) ─────────────────────

export type ApiContext = {
  healthMonitor: HealthMonitor;
  agentService: AgentService;
  config: JarvisConfig;
  wsService?: WebSocketService;
  channelService?: ChannelService;
  authorityEngine?: AuthorityEngine;
  approvalManager?: ApprovalManager;
  auditTrail?: AuditTrail;
  learner?: AuthorityLearner;
  emergencyController?: EmergencyController;
  deferredExecutor?: DeferredExecutor;
  awarenessService?: AwarenessService | null;
  workflowEngine?: import('../workflows/engine.ts').WorkflowEngine;
  triggerManager?: import('../workflows/triggers/manager.ts').TriggerManager;
  webhookManager?: import('../workflows/triggers/webhook.ts').WebhookManager;
  nodeRegistry?: import('../workflows/nodes/registry.ts').NodeRegistry;
  nlBuilder?: import('../workflows/nl-builder.ts').NLWorkflowBuilder;
  autoSuggest?: import('../workflows/auto-suggest.ts').WorkflowAutoSuggest;
  goalService?: import('../goals/service.ts').GoalService;
  sidecarManager?: import('../sidecar/manager.ts').SidecarManager;
  siteBuilderService?: import('../sites/service.ts').SiteBuilderService;
  mcpService?: import('./mcp-service.ts').McpService;
  observerService?: import('./observer-service.ts').ObserverService;
  liveScreenService?: import('../services/live-screen.ts').LiveScreenService;
  llmManager?: import('../llm/manager.ts').LLMManager;
};

function mergeRoutes(...allRoutes: Array<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const routes of allRoutes) {
    for (const [key, value] of Object.entries(routes)) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Create all API route handlers — merges all domain route modules.
 */
export function createApiRoutes(ctx: ApiContext): Record<string, unknown> {
  return mergeRoutes(
    miscRoutes(ctx),
    vaultRoutes(ctx),
    commitmentRoutes(ctx),
    agentRoutes(ctx),
    contentRoutes(ctx),
    workflowRoutes(ctx),
    goalRoutes(ctx),
    awarenessRoutes(ctx),
    authorityRoutes(ctx),
    configRoutes(ctx),
    projectRoutes(ctx),
    mcpRoutes(ctx),
    superJarvisRoutes(ctx),
    preferencesRoutes(ctx),
    metricsRoutes(ctx),
    coordinationRoutes(ctx),
    statusRoutes(ctx),
  );
}

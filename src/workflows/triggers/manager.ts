/**
 * TriggerManager — ties together all trigger mechanisms and maps them to the WorkflowEngine
 *
 * Implements the Service interface and acts as the single entry point for:
 *   - Cron-based scheduling (trigger.cron)
 *   - Inbound webhooks (trigger.webhook)
 *   - Outbound HTTP polling (trigger.poll)
 *   - Observer-based events (trigger.file_change, trigger.clipboard, etc.)
 *   - Manual triggers (fired externally via fireTrigger)
 */

import type { Service, ServiceStatus } from '../../daemon/services.ts';
import type { WorkflowEngine } from '../engine.ts';
import type { WorkflowDefinition, WorkflowNode } from '../types.ts';
import { CronScheduler } from './cron.ts';
import { WebhookManager } from './webhook.ts';
import { PollingEngine } from './poller.ts';
import type { PollConfig } from './poller.ts';
import * as vault from '../../vault/workflows.ts';

// ── Types ──

/** All trigger node types recognised by the TriggerManager */
const TRIGGER_TYPES = new Set([
  'trigger.cron',
  'trigger.webhook',
  'trigger.poll',
  'trigger.manual',
  'trigger.file_change',
  'trigger.clipboard',
  'trigger.process',
  'trigger.email',
  'trigger.calendar',
  'trigger.notification',
  'trigger.screen',
  'trigger.message',
]);

type MessageTriggerEntry = {
  workflowId: string;
  nodeId: string;
  pattern: RegExp;
  channel?: string;
};

// ── TriggerManager ──

export class TriggerManager implements Service {
  readonly name = 'trigger-manager';

  private _status: ServiceStatus = 'stopped';
  private engine: WorkflowEngine;

  private cron: CronScheduler;
  private webhooks: WebhookManager;
  private poller: PollingEngine;

  /** workflowId → set of registered trigger identifiers */
  private registrations: Map<string, Set<string>> = new Map();
  /** message triggers: matched against every incoming chat message */
  private messagePatterns: MessageTriggerEntry[] = [];

  constructor(workflowEngine: WorkflowEngine) {
    this.engine = workflowEngine;
    this.cron = new CronScheduler();
    this.webhooks = new WebhookManager();
    this.poller = new PollingEngine();

    // Wire webhook callbacks
    this.webhooks.setTriggerCallback((workflowId, data) => {
      this.fire(workflowId, 'webhook', data);
    });
  }

  // ── Service lifecycle ──

  async start(): Promise<void> {
    this._status = 'starting';
    try {
      await this.reloadAll();
      this._status = 'running';
      console.log('[TriggerManager] Started');
    } catch (err) {
      this._status = 'error';
      throw err;
    }
  }

  async stop(): Promise<void> {
    this._status = 'stopping';

    this.cron.cancelAll();
    this.poller.unregisterAll();
    this.registrations.clear();
    this.messagePatterns = [];
    // Webhooks are stateless HTTP handlers; nothing to teardown at the transport level

    this._status = 'stopped';
    console.log('[TriggerManager] Stopped');
  }

  status(): ServiceStatus {
    return this._status;
  }

  // ── Public API ──

  /**
   * Register all trigger nodes found in a workflow definition.
   */
  registerWorkflow(workflowId: string, definition: WorkflowDefinition): void {
    // Remove any existing triggers first (idempotent)
    this.unregisterWorkflow(workflowId);

    const triggerNodes = definition.nodes.filter(n => TRIGGER_TYPES.has(n.type));
    const ids = new Set<string>();

    for (const node of triggerNodes) {
      const nodeKey = `${workflowId}:${node.id}`;
      this.registerTriggerNode(workflowId, node, nodeKey);
      ids.add(nodeKey);
    }

    if (ids.size > 0) {
      this.registrations.set(workflowId, ids);
      console.log(`[TriggerManager] Registered ${ids.size} trigger(s) for workflow "${workflowId}"`);
    }
  }

  /**
   * Unregister all triggers associated with a workflow.
   */
  unregisterWorkflow(workflowId: string): void {
    const ids = this.registrations.get(workflowId);
    if (!ids) return;

    for (const id of ids) {
      this.cron.cancel(id);
      this.poller.unregister(id);
      // Webhook is keyed by workflowId, unregister once
    }

    this.webhooks.unregister(workflowId);
    this.messagePatterns = this.messagePatterns.filter(e => e.workflowId !== workflowId);
    this.registrations.delete(workflowId);
    console.log(`[TriggerManager] Unregistered triggers for workflow "${workflowId}"`);
  }

  /**
   * Check an incoming user message against all registered `trigger.message` patterns.
   * Fires matching workflows with the message text and channel as trigger data.
   * Call this from ws-service whenever a user message arrives.
   */
  checkMessage(text: string, channel: string): void {
    for (const entry of this.messagePatterns) {
      if (entry.channel && entry.channel !== channel) continue;
      if (entry.pattern.test(text)) {
        console.log(`[TriggerManager] Message trigger matched workflow "${entry.workflowId}" (pattern: ${entry.pattern})`);
        this.fire(entry.workflowId, 'message', {
          text,
          channel,
          nodeId: entry.nodeId,
          matchedPattern: entry.pattern.source,
        });
      }
    }
  }

  /**
   * Load all enabled workflows from the vault and register their triggers.
   * Safe to call multiple times (idempotent — clears first).
   */
  async reloadAll(): Promise<void> {
    // Clear existing
    this.cron.cancelAll();
    this.poller.unregisterAll();
    this.registrations.clear();
    this.messagePatterns = [];

    const workflows = vault.findWorkflows({ enabled: true });
    let registered = 0;

    for (const wf of workflows) {
      const version = vault.getLatestVersion(wf.id);
      if (!version) continue;

      try {
        this.registerWorkflow(wf.id, version.definition);
        registered++;
      } catch (err) {
        console.error(`[TriggerManager] Failed to register triggers for workflow "${wf.name}":`, err);
      }
    }

    console.log(`[TriggerManager] Loaded triggers for ${registered}/${workflows.length} workflows`);
  }

  /**
   * Manually fire a trigger for a workflow (useful for manual/test triggers).
   */
  fireTrigger(workflowId: string, triggerType: string, data?: Record<string, unknown>): void {
    this.fire(workflowId, triggerType, data ?? {});
  }

  // ── Accessors ──

  getCronScheduler(): CronScheduler {
    return this.cron;
  }

  getWebhookManager(): WebhookManager {
    return this.webhooks;
  }

  getPollingEngine(): PollingEngine {
    return this.poller;
  }

  // ── Internal ──

  private registerTriggerNode(workflowId: string, node: WorkflowNode, nodeKey: string): void {
    switch (node.type) {
      case 'trigger.cron':
        this.registerCronTrigger(workflowId, node, nodeKey);
        break;

      case 'trigger.webhook':
        this.registerWebhookTrigger(workflowId, node);
        break;

      case 'trigger.poll':
        this.registerPollTrigger(workflowId, node, nodeKey);
        break;

      case 'trigger.message':
        this.registerMessageTrigger(workflowId, node);
        break;

      case 'trigger.manual':
        // Manual triggers are fired programmatically via fireTrigger() — no setup needed
        console.log(`[TriggerManager] Manual trigger registered for workflow "${workflowId}" (node: ${node.id})`);
        break;

      // Observer-sourced triggers — registered via ObserverBridge externally,
      // but we still track them in registrations for cleanup purposes
      case 'trigger.file_change':
      case 'trigger.clipboard':
      case 'trigger.process':
      case 'trigger.email':
      case 'trigger.calendar':
      case 'trigger.notification':
      case 'trigger.screen':
        console.log(`[TriggerManager] Observer trigger "${node.type}" registered for workflow "${workflowId}"`);
        break;

      default:
        console.warn(`[TriggerManager] Unknown trigger type "${node.type}" in workflow "${workflowId}"`);
    }
  }

  private registerMessageTrigger(workflowId: string, node: WorkflowNode): void {
    const raw = (node.config.pattern as string | undefined) ?? '';
    if (!raw) {
      console.warn(`[TriggerManager] Message trigger node "${node.id}" in workflow "${workflowId}" has no pattern`);
      return;
    }

    let pattern: RegExp;
    try {
      const flags = (node.config.flags as string | undefined) ?? 'i';
      pattern = new RegExp(raw, flags);
    } catch {
      // Treat the raw string as a plain keyword match if it's not a valid regex
      pattern = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const channel = (node.config.channel as string | undefined) ?? undefined;

    this.messagePatterns.push({ workflowId, nodeId: node.id, pattern, channel });
    console.log(`[TriggerManager] Message trigger registered for workflow "${workflowId}" — pattern: ${pattern}${channel ? ` (channel: ${channel})` : ''}`);
  }

  private registerCronTrigger(workflowId: string, node: WorkflowNode, key: string): void {
    const expression = node.config.expression as string | undefined;
    if (!expression) {
      console.warn(`[TriggerManager] Cron trigger node "${node.id}" in workflow "${workflowId}" has no expression`);
      return;
    }

    try {
      this.cron.schedule(key, expression, () => {
        this.fire(workflowId, 'cron', { expression, nodeId: node.id });
      });
    } catch (err) {
      console.error(`[TriggerManager] Failed to schedule cron "${expression}" for workflow "${workflowId}":`, err);
    }
  }

  private registerWebhookTrigger(workflowId: string, node: WorkflowNode): void {
    const secret = node.config.secret as string | undefined;
    const path = this.webhooks.register(workflowId, secret);
    console.log(`[TriggerManager] Webhook trigger for workflow "${workflowId}" registered at ${path}`);
  }

  private registerPollTrigger(workflowId: string, node: WorkflowNode, key: string): void {
    const url = node.config.url as string | undefined;
    if (!url) {
      console.warn(`[TriggerManager] Poll trigger node "${node.id}" in workflow "${workflowId}" has no url`);
      return;
    }

    const config: PollConfig = {
      url,
      intervalMs: (node.config.intervalMs as number | undefined) ?? 60_000,
      method: (node.config.method as string | undefined) ?? 'GET',
      headers: node.config.headers as Record<string, string> | undefined,
      body: node.config.body as string | undefined,
      deduplicateField: node.config.deduplicateField as string | undefined,
    };

    try {
      this.poller.register(key, config, (data, meta) => {
        this.fire(workflowId, 'poll', {
          data,
          url: meta.url,
          status: meta.status,
          timestamp: meta.timestamp,
          nodeId: node.id,
        });
      });
    } catch (err) {
      console.error(`[TriggerManager] Failed to register poll trigger for workflow "${workflowId}":`, err);
    }
  }

  /**
   * Fire the WorkflowEngine for a given workflow trigger.
   */
  private fire(workflowId: string, triggerType: string, data: Record<string, unknown>): void {
    this.engine.execute(workflowId, triggerType, data).catch(err => {
      console.error(`[TriggerManager] Execution failed for workflow "${workflowId}" (trigger: ${triggerType}):`, err);
    });
  }
}

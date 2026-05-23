/**
 * Bootstrap Phase 3 — Authority & Autonomy Engine.
 *
 * Creates: AuthorityEngine, ApprovalManager, AuditTrail, AuthorityLearner,
 * EmergencyController, ApprovalDelivery, DeferredExecutor.
 */

import { AuthorityEngine } from '../../authority/engine.ts';
import { ApprovalManager } from '../../authority/approval.ts';
import { AuditTrail } from '../../authority/audit.ts';
import { AuthorityLearner } from '../../authority/learning.ts';
import { EmergencyController } from '../../authority/emergency.ts';
import { ApprovalDelivery } from '../../authority/approval-delivery.ts';
import { DeferredExecutor } from '../../authority/deferred-executor.ts';
import type { CoreServices } from './services.ts';
import type { JarvisConfig } from '../../config/types.ts';

export type AuthorityContext = {
  authorityEngine: AuthorityEngine;
  approvalManager: ApprovalManager;
  auditTrail: AuditTrail;
  learner: AuthorityLearner;
  emergencyController: EmergencyController;
  approvalDelivery: ApprovalDelivery;
  deferredExecutor: DeferredExecutor;
};

export function bootstrapAuthority(
  jarvisConfig: JarvisConfig,
  services: CoreServices,
): AuthorityContext {
  const { wsService, channelService, agentService } = services;
  const authorityConfig = jarvisConfig.authority ?? { default_level: 3 };

  const authorityEngine = new AuthorityEngine({
    default_level: authorityConfig.default_level,
    governed_categories: (authorityConfig.governed_categories ?? ['send_email', 'send_message', 'make_payment']) as any,
    overrides: (authorityConfig.overrides ?? []) as any,
    context_rules: (authorityConfig.context_rules ?? []) as any,
    learning: authorityConfig.learning ?? { enabled: true, suggest_threshold: 5 },
    emergency_state: authorityConfig.emergency_state ?? 'normal',
  });

  const approvalManager = new ApprovalManager();
  const auditTrail = new AuditTrail();
  const learner = new AuthorityLearner(authorityConfig.learning?.suggest_threshold ?? 5);
  const emergencyController = new EmergencyController();
  const approvalDelivery = new ApprovalDelivery();
  const deferredExecutor = new DeferredExecutor(approvalManager, auditTrail);
  deferredExecutor.setLearner(learner);

  // Restore emergency state from config
  const savedEmergencyState = authorityConfig.emergency_state ?? 'normal';
  if (savedEmergencyState === 'paused') emergencyController.pause();
  else if (savedEmergencyState === 'killed') emergencyController.kill();

  // Persist emergency state changes to config.yaml
  emergencyController.setStateChangeCallback(async (state) => {
    wsService.broadcastEmergencyState(state);
    try {
      const { loadConfig: reloadConfig, saveConfig: resaveConfig } = await import('../../config/loader.ts');
      const fresh = await reloadConfig();
      if (!fresh.authority) fresh.authority = { default_level: 3 } as any;
      fresh.authority.emergency_state = state;
      await resaveConfig(fresh);
    } catch (err) {
      console.error('[Daemon] Failed to persist emergency state:', err);
    }
  });

  // Wire authority engine into orchestrator
  const orchestrator = agentService.getOrchestrator();
  orchestrator.setAuthorityEngine(authorityEngine);
  orchestrator.setApprovalManager(approvalManager);
  orchestrator.setAuditTrail(auditTrail);
  orchestrator.setEmergencyController(emergencyController);

  orchestrator.setApprovalCallback((request) => {
    approvalDelivery.deliver(request).catch(err =>
      console.error('[Daemon] Approval delivery error:', err),
    );
  });

  agentService.setAuthorityEngine(authorityEngine);

  // Wire channel approval handler
  channelService.setApprovalHandler(async (action, shortId, channel) => {
    const request = approvalManager.findByShortId(shortId);
    if (!request) return `No pending approval found for ID ${shortId}`;

    if (action === 'approve') {
      const approved = approvalManager.approve(request.id, channel);
      if (!approved) return 'Request already decided';
      const result = await deferredExecutor.executeApproved(request.id);
      const updated = approvalManager.getRequest(request.id);
      if (updated) wsService.broadcastApprovalUpdate(updated);
      return `Approved and executed. Result: ${result.slice(0, 200)}`;
    } else {
      const denied = approvalManager.deny(request.id, channel);
      if (!denied) return 'Request already decided';
      deferredExecutor.recordDenial(denied);
      wsService.broadcastApprovalUpdate(denied);
      return `Denied: ${request.tool_name}`;
    }
  });

  console.log(`[Daemon] Authority engine initialized (governed: ${authorityEngine.getConfig().governed_categories.join(', ')})`);

  return { authorityEngine, approvalManager, auditTrail, learner, emergencyController, approvalDelivery, deferredExecutor };
}

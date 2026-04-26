/**
 * Authority & autonomy routes — status, approvals, audit, emergency, config, learning.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams } from './_shared.ts';
import type { ActionCategory } from '../../roles/authority.ts';
import type { AuthorityDecisionType } from '../../authority/audit.ts';

export function registerRoutes(ctx: ApiContext) {
  return {

    // --- Authority & Autonomy ---
    '/api/authority/status': {
      GET: () => {
        const engine = ctx.authorityEngine;
        const emergency = ctx.emergencyController;
        const approvals = ctx.approvalManager;
        if (!engine || !emergency) return json({ enabled: false });

        return json({
          enabled: true,
          emergency_state: emergency.getState(),
          pending_approvals: approvals?.getPending().length ?? 0,
          config: engine.getConfig(),
        });
      },
    },

    '/api/authority/approvals': {
      GET: (req: Request) => {
        if (!ctx.approvalManager) return json([]);
        const params = getSearchParams(req);
        const status = params.get('status');
        if (status === 'pending') {
          return json(ctx.approvalManager.getPending());
        }
        return json(ctx.approvalManager.getHistory({
          limit: parseInt(params.get('limit') ?? '50') || 50,
          action: (params.get('action') as ActionCategory) || undefined,
          agentId: params.get('agent_id') || undefined,
          status: (params.get('status') as any) || undefined,
        }));
      },
    },

    '/api/authority/approvals/:id/approve': {
      POST: async (req: Request & { params: { id: string } }) => {
        if (!ctx.approvalManager || !ctx.deferredExecutor) {
          return error('Authority system not configured', 500);
        }
        const requestId = req.params.id;
        const approved = ctx.approvalManager.approve(requestId, 'dashboard');
        if (!approved) return error('Request not found or already decided', 404);

        const result = await ctx.deferredExecutor.executeApproved(requestId);

        const updated = ctx.approvalManager.getRequest(requestId);
        if (updated) ctx.wsService?.broadcastApprovalUpdate(updated);

        return json({ ok: true, result: result.slice(0, 500) });
      },
    },

    '/api/authority/approvals/:id/deny': {
      POST: async (req: Request & { params: { id: string } }) => {
        if (!ctx.approvalManager || !ctx.deferredExecutor) {
          return error('Authority system not configured', 500);
        }
        const requestId = req.params.id;
        const denied = ctx.approvalManager.deny(requestId, 'dashboard');
        if (!denied) return error('Request not found or already decided', 404);

        ctx.deferredExecutor.recordDenial(denied);
        ctx.wsService?.broadcastApprovalUpdate(denied);

        return json({ ok: true });
      },
    },

    '/api/authority/audit': {
      GET: (req: Request) => {
        if (!ctx.auditTrail) return json([]);
        const params = getSearchParams(req);
        return json(ctx.auditTrail.query({
          agentId: params.get('agent_id') || undefined,
          action: (params.get('action') as ActionCategory) || undefined,
          tool: params.get('tool') || undefined,
          decision: (params.get('decision') as AuthorityDecisionType) || undefined,
          since: params.get('since') ? parseInt(params.get('since')!) : undefined,
          limit: parseInt(params.get('limit') ?? '100') || 100,
        }));
      },
    },

    '/api/authority/audit/stats': {
      GET: (req: Request) => {
        if (!ctx.auditTrail) return json({ total: 0, allowed: 0, denied: 0, approvalRequired: 0, byCategory: {} });
        const params = getSearchParams(req);
        const since = params.get('since') ? parseInt(params.get('since')!) : undefined;
        return json(ctx.auditTrail.getStats(since));
      },
    },

    '/api/authority/emergency/pause': {
      POST: () => {
        if (!ctx.emergencyController) return error('Emergency controller not configured', 500);
        ctx.emergencyController.pause();
        return json({ ok: true, state: ctx.emergencyController.getState() });
      },
    },

    '/api/authority/emergency/resume': {
      POST: () => {
        if (!ctx.emergencyController) return error('Emergency controller not configured', 500);
        ctx.emergencyController.resume();
        return json({ ok: true, state: ctx.emergencyController.getState() });
      },
    },

    '/api/authority/emergency/kill': {
      POST: () => {
        if (!ctx.emergencyController) return error('Emergency controller not configured', 500);
        ctx.emergencyController.kill();
        return json({ ok: true, state: ctx.emergencyController.getState() });
      },
    },

    '/api/authority/emergency/reset': {
      POST: () => {
        if (!ctx.emergencyController) return error('Emergency controller not configured', 500);
        ctx.emergencyController.reset();
        return json({ ok: true, state: ctx.emergencyController.getState() });
      },
    },

    '/api/authority/config': {
      GET: () => {
        if (!ctx.authorityEngine) return json({});
        return json(ctx.authorityEngine.getConfig());
      },
      POST: async (req: Request) => {
        if (!ctx.authorityEngine) return error('Authority engine not configured', 500);
        try {
          const body = await req.json() as Record<string, unknown>;
          const currentConfig = ctx.authorityEngine.getConfig();

          if (body.governed_categories) currentConfig.governed_categories = body.governed_categories as ActionCategory[];
          if (body.default_level !== undefined) currentConfig.default_level = body.default_level as number;
          if (body.overrides) currentConfig.overrides = body.overrides as any[];
          if (body.context_rules) currentConfig.context_rules = body.context_rules as any[];
          if (body.learning) currentConfig.learning = { ...currentConfig.learning, ...body.learning as any };

          ctx.authorityEngine.updateConfig(currentConfig);

          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();
          freshConfig.authority = {
            ...freshConfig.authority,
            default_level: currentConfig.default_level,
            governed_categories: currentConfig.governed_categories,
            overrides: currentConfig.overrides,
            context_rules: currentConfig.context_rules,
            learning: currentConfig.learning,
          };
          await saveConfig(freshConfig);

          return json({ ok: true, config: currentConfig });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/authority/learning/suggestions': {
      GET: () => {
        if (!ctx.learner) return json([]);
        return json(ctx.learner.getSuggestions());
      },
    },

    '/api/authority/learning/accept': {
      POST: async (req: Request) => {
        if (!ctx.learner || !ctx.authorityEngine) {
          return error('Learning system not configured', 500);
        }
        try {
          const body = await req.json() as { action: ActionCategory; tool_name: string };
          if (!body.action) return error('Missing "action" field');

          ctx.authorityEngine.addOverride({
            action: body.action,
            allowed: true,
            requires_approval: false,
          });

          ctx.learner.markSuggestionSent(body.action, body.tool_name ?? '');

          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();
          freshConfig.authority = {
            ...freshConfig.authority,
            ...ctx.authorityEngine.getConfig(),
          };
          await saveConfig(freshConfig);

          return json({ ok: true });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/authority/learning/dismiss': {
      POST: async (req: Request) => {
        if (!ctx.learner) return error('Learning system not configured', 500);
        try {
          const body = await req.json() as { action: ActionCategory; tool_name: string };
          if (!body.action) return error('Missing "action" field');
          ctx.learner.resetPattern(body.action, body.tool_name ?? '');
          return json({ ok: true });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

  };
}

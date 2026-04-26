/**
 * Goals routes — goal CRUD, trees, check-ins, scoring, progress.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams } from './_shared.ts';

export function registerRoutes(ctx: ApiContext) {
  return {

    // ── Goals ───────────────────────────────────────────────────────────
    '/api/goals': {
      GET: (req: Request) => {
        try {
          const url = new URL(req.url);
          const status = url.searchParams.get('status') ?? undefined;
          const level = url.searchParams.get('level') ?? undefined;
          const tag = url.searchParams.get('tag') ?? undefined;
          const health = url.searchParams.get('health') ?? undefined;
          const parent_id = url.searchParams.get('parent_id');
          const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
          const q = url.searchParams.get('q')?.toLowerCase();
          const goals = require('../../vault/goals.ts');
          let results = goals.findGoals({
            status: status as any,
            level: level as any,
            tag,
            health: health as any,
            parent_id: parent_id === 'null' ? null : parent_id ?? undefined,
            limit: q ? 200 : limit,
          });
          if (q) {
            results = results.filter((g: any) =>
              g.title?.toLowerCase().includes(q) ||
              g.description?.toLowerCase().includes(q) ||
              g.success_criteria?.toLowerCase().includes(q)
            ).slice(0, limit);
          }
          return json(results);
        } catch (err) { return error(`${err}`); }
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>;
          const mode = body.mode as string | undefined;

          // Natural language → OKR proposal (uses LLM)
          if (mode === 'propose') {
            const text = body.text as string;
            if (!text?.trim()) return error('text is required for propose mode', 400);
            const { NLGoalBuilder } = await import('../../goals/nl-builder.ts');
            const llmManager = ctx.agentService.getLLMManager();
            const builder = new NLGoalBuilder(llmManager);
            const proposal = await builder.parseGoal(text.trim());
            return json(proposal);
          }

          // Create goals from a confirmed proposal
          if (mode === 'create_from_proposal') {
            const proposal = body.proposal as any;
            if (!proposal?.objective?.title) return error('proposal with objective required', 400);
            const { NLGoalBuilder } = await import('../../goals/nl-builder.ts');
            const llmManager = ctx.agentService.getLLMManager();
            const builder = new NLGoalBuilder(llmManager);
            const created = builder.createFromProposal(proposal, body.parent_id as string | undefined);
            return json(created, 201);
          }

          // Quick create (direct)
          const title = body.title as string;
          const level = (body.level as string) ?? 'task';
          if (!title) return error('title is required', 400);
          const goals = require('../../vault/goals.ts');
          const goal = goals.createGoal(title, level, body);
          return json(goal, 201);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/roots': {
      GET: () => {
        try {
          const goals = require('../../vault/goals.ts');
          return json(goals.getRootGoals());
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/overdue': {
      GET: () => {
        try {
          const goals = require('../../vault/goals.ts');
          return json(goals.getOverdueGoals());
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/metrics': {
      GET: () => {
        try {
          const goals = require('../../vault/goals.ts');
          return json(goals.getGoalMetrics());
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/reorder': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { id: string; sort_order: number }[];
          const goals = require('../../vault/goals.ts');
          goals.reorderGoals(body);
          return json({ ok: true });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/check-ins': {
      GET: (req: Request) => {
        try {
          const url = new URL(req.url);
          const type = url.searchParams.get('type') as any;
          const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
          const goals = require('../../vault/goals.ts');
          return json(goals.getRecentCheckIns(type ?? undefined, limit));
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/daily-actions': {
      GET: () => {
        try {
          const goals = require('../../vault/goals.ts');
          return json(goals.findGoals({ level: 'daily_action', status: 'active', limit: 20 }));
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/:id': {
      GET: (req: Request) => {
        try {
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          const goals = require('../../vault/goals.ts');
          const goal = goals.getGoal(id);
          if (!goal) return error('Goal not found', 404);
          return json(goal);
        } catch (err) { return error(`${err}`); }
      },
      PATCH: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          const body = await req.json() as Record<string, unknown>;
          const goals = require('../../vault/goals.ts');
          const updated = goals.updateGoal(id, body);
          if (!updated) return error('Goal not found', 404);
          return json(updated);
        } catch (err) { return error(`${err}`); }
      },
      DELETE: (req: Request) => {
        try {
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          const goals = require('../../vault/goals.ts');
          const deleted = goals.deleteGoal(id);
          if (!deleted) return error('Goal not found', 404);
          return json({ ok: true });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/:id/tree': {
      GET: (req: Request) => {
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          const goals = require('../../vault/goals.ts');
          return json(goals.getGoalTree(id));
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/:id/children': {
      GET: (req: Request) => {
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          const goals = require('../../vault/goals.ts');
          return json(goals.getGoalChildren(id));
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/:id/score': {
      POST: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          const body = await req.json() as { score: number; reason: string; source?: string };
          const goals = require('../../vault/goals.ts');
          const updated = goals.updateGoalScore(id, body.score, body.reason, body.source ?? 'user');
          if (!updated) return error('Goal not found', 404);
          return json(updated);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/:id/status': {
      POST: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          const body = await req.json() as { status: string };
          const goals = require('../../vault/goals.ts');
          const updated = goals.updateGoalStatus(id, body.status as any);
          if (!updated) return error('Goal not found', 404);
          return json(updated);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/:id/health': {
      POST: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          const body = await req.json() as { health: string };
          const goals = require('../../vault/goals.ts');
          const updated = goals.updateGoalHealth(id, body.health as any);
          if (!updated) return error('Goal not found', 404);
          return json(updated);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/goals/:id/progress': {
      GET: (req: Request) => {
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
          const goals = require('../../vault/goals.ts');
          return json(goals.getProgressHistory(id, limit));
        } catch (err) { return error(`${err}`); }
      },
    },

  };
}

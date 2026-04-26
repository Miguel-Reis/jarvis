/**
 * Miscellaneous routes — health, notifications, dashboard, calendar, WhatsApp webhook, CORS preflight.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams, CORS } from './_shared.ts';
import { findEntities } from '../../vault/entities.ts';
import { getDb } from '../../vault/schema.ts';
import { getWhatsAppAdapter } from '../../comms/channels/whatsapp.ts';

export function registerRoutes(ctx: ApiContext) {
  return {

    // --- Health ---
    '/api/health': {
      GET: () => json(ctx.healthMonitor.getHealth()),
    },

    // --- Notification history ---
    '/api/notifications': {
      GET: (req: Request) => {
        try {
          const { listNotifications, countUnread } = require('../../vault/notifications.ts');
          const params = getSearchParams(req);
          const limit = parseInt(params.get('limit') ?? '50', 10);
          const unreadOnly = params.get('unread') === 'true';
          const items = listNotifications({ limit, unreadOnly });
          const unread = countUnread();
          return json({ items, unread });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/notifications/read-all': {
      POST: () => {
        try {
          const { markAllRead, countUnread } = require('../../vault/notifications.ts');
          markAllRead();
          return json({ ok: true, unread: countUnread() });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/notifications/:id/read': {
      POST: (req: Request) => {
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          const { markRead, countUnread } = require('../../vault/notifications.ts');
          const ok = markRead(id);
          if (!ok) return error('Notification not found', 404);
          return json({ ok: true, unread: countUnread() });
        } catch (err) { return error(`${err}`); }
      },
    },

    // --- Dashboard aggregate ---
    '/api/dashboard': {
      GET: () => {
        try {
          const agents = buildAgentSnapshotsForDashboard(ctx).agents;
          const health = ctx.healthMonitor.getHealth();
          const entities = findEntities({});
          const goalsModule = require('../../vault/goals.ts');
          const activeGoals = goalsModule.findGoals({ status: 'active', limit: 8 });
          const { findWorkflows } = require('../../vault/workflows.ts');
          const workflows = findWorkflows({});
          return json({
            agents,
            health,
            entityCount: entities.length,
            recentEntities: entities.slice(0, 20),
            activeGoals,
            workflows,
          });
        } catch (err) { return error(`${err}`); }
      },
    },

    // --- Calendar ---
    '/api/calendar': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const rangeStart = parseInt(params.get('range_start') ?? '0');
        const rangeEnd = parseInt(params.get('range_end') ?? '0');

        if (!rangeStart || !rangeEnd) {
          return error('Missing range_start and/or range_end (Unix ms timestamps)');
        }

        const db = getDb();
        const events: Array<{
          id: string;
          type: 'commitment' | 'content';
          title: string;
          timestamp: number;
          status: string;
          priority?: string;
          content_type?: string;
          stage?: string;
          assigned_to?: string;
          has_due_date?: boolean;
        }> = [];

        const dueRows = db.prepare(
          'SELECT * FROM commitments WHERE when_due IS NOT NULL AND when_due >= ? AND when_due < ?'
        ).all(rangeStart, rangeEnd) as any[];

        for (const row of dueRows) {
          events.push({
            id: row.id,
            type: 'commitment',
            title: row.what,
            timestamp: row.when_due,
            status: row.status,
            priority: row.priority,
            assigned_to: row.assigned_to ?? undefined,
            has_due_date: true,
          });
        }

        const noDueRows = db.prepare(
          "SELECT * FROM commitments WHERE when_due IS NULL AND status IN ('pending', 'active') AND created_at >= ? AND created_at < ?"
        ).all(rangeStart, rangeEnd) as any[];

        for (const row of noDueRows) {
          events.push({
            id: row.id,
            type: 'commitment',
            title: row.what,
            timestamp: row.created_at,
            status: row.status,
            priority: row.priority,
            assigned_to: row.assigned_to ?? undefined,
            has_due_date: false,
          });
        }

        const contentRows = db.prepare(
          'SELECT * FROM content_items WHERE scheduled_at IS NOT NULL AND scheduled_at >= ? AND scheduled_at < ?'
        ).all(rangeStart, rangeEnd) as any[];

        for (const row of contentRows) {
          events.push({
            id: row.id,
            type: 'content',
            title: row.title,
            timestamp: row.scheduled_at,
            status: row.stage,
            content_type: row.content_type,
            stage: row.stage,
          });
        }

        events.sort((a, b) => a.timestamp - b.timestamp);

        return json(events);
      },
    },

    // ── WhatsApp Cloud API webhook ─────────────────────────────────────
    '/webhooks/whatsapp': {
      GET: (req: Request) => {
        const adapter = getWhatsAppAdapter();
        if (!adapter) return new Response('WhatsApp not configured', { status: 404 });
        return adapter.handleVerify(req);
      },
      POST: async (req: Request) => {
        const adapter = getWhatsAppAdapter();
        if (!adapter) return new Response('WhatsApp not configured', { status: 404 });
        return adapter.handleIncoming(req);
      },
    },

    // --- CORS preflight ---
    '/api/*': {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    },

  };
}

type AgentTaskSnapshot = {
  id: string;
  agentId: string;
  status: string;
  task: string;
  startedAt: number;
  completedAt?: number | null;
};

function buildAgentSnapshotsForDashboard(ctx: ApiContext) {
  const orchestrator = ctx.agentService.getOrchestrator();
  const taskManager = ctx.agentService.getTaskManager();
  const latestTaskByAgent = new Map<string, AgentTaskSnapshot>();
  const busyAgents = new Set<string>();

  if (taskManager) {
    for (const task of taskManager.listTasks()) {
      if (!task.agentId) continue;
      if (!task.completedAt) {
        busyAgents.add(task.agentId);
      }

      const existing = latestTaskByAgent.get(task.agentId);
      if (!existing || task.startedAt >= existing.startedAt) {
        latestTaskByAgent.set(task.agentId, task);
      }
    }
  }

  const agents = orchestrator.getAllAgents().map((agent) => {
    const base = agent.toJSON();
    const latestTask = latestTaskByAgent.get(agent.id);
    const busy = busyAgents.has(agent.id) || base.status === 'active' || Boolean(base.current_task);
    return {
      ...base,
      busy,
      latest_task: latestTask ? {
        id: latestTask.id,
        status: latestTask.status,
        task: latestTask.task,
        started_at: latestTask.startedAt,
        completed_at: latestTask.completedAt,
      } : null,
    };
  });

  return { agents, latestTaskByAgent, taskManager };
}

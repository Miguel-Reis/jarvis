/**
 * Agent routes — agent listing, spawning, specialist roles, task management.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error } from './_shared.ts';
import { assignPersistentAgentTask, listPersistentAgents, spawnPersistentAgent, terminatePersistentAgent } from '../../actions/tools/agents.ts';

export function registerRoutes(ctx: ApiContext) {
  return {

    // --- Agents ---
    '/api/agents': {
      GET: () => {
        return json(buildAgentSnapshots(ctx).agents);
      },
      POST: async (req: Request) => {
        try {
          const taskManager = ctx.agentService.getTaskManager();
          if (!taskManager) return error('Persistent agents are not available.', 503);

          const body = await req.json() as { specialist?: string; task?: string; context?: string };
          const deps = {
            orchestrator: ctx.agentService.getOrchestrator(),
            llmManager: ctx.agentService.getLLMManager(),
            specialists: ctx.agentService.getSpecialists(),
            taskManager,
          };

          const spawned = spawnPersistentAgent(deps, body.specialist ?? '');
          let assignment: Awaited<ReturnType<typeof assignPersistentAgentTask>> | null = null;

          if (body.task?.trim()) {
            assignment = await assignPersistentAgentTask(deps, {
              agentId: spawned.agent.id,
              task: body.task.trim(),
              context: body.context?.trim(),
            });
          }

          const latestTask = taskManager.getAgentTask(spawned.agent.id);
          const busy = taskManager.isAgentBusy(spawned.agent.id)
            || spawned.agent.status === 'active'
            || Boolean(spawned.agent.agent.current_task);
          return json({
            ...spawned.agent.toJSON(),
            busy,
            latest_task: latestTask ? {
              id: latestTask.id,
              status: latestTask.status,
              task: latestTask.task,
              started_at: latestTask.startedAt,
              completed_at: latestTask.completedAt,
            } : null,
            spawned: spawned.summary,
            assignment,
          }, 201);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/agents/specialists': {
      GET: () => {
        const specialists = Array.from(ctx.agentService.getSpecialists().values()).map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          authority_level: role.authority_level,
          tools: role.tools,
        }));
        return json({ specialists });
      },
    },

    '/api/agents/:id': {
      DELETE: (req: Request & { params: { id: string } }) => {
        try {
          const taskManager = ctx.agentService.getTaskManager();
          if (!taskManager) return error('Persistent agents are not available.', 503);
          const deps = {
            orchestrator: ctx.agentService.getOrchestrator(),
            llmManager: ctx.agentService.getLLMManager(),
            specialists: ctx.agentService.getSpecialists(),
            taskManager,
          };
          return json(terminatePersistentAgent(deps, req.params.id));
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/agents/tree': {
      GET: () => {
        const orchestrator = ctx.agentService.getOrchestrator();
        const all = orchestrator.getAllAgents().map((a) => a.toJSON());
        // Build tree structure
        const primary = all.find((a) => !a.parent_id);
        const children = all.filter((a) => a.parent_id);
        return json({
          primary: primary ?? null,
          children,
        });
      },
    },

    '/api/agents/tasks': {
      GET: () => {
        const tm = ctx.agentService.getTaskManager();
        if (!tm) {
          return json({
            active_agents: 0,
            agents: [],
            tasks_total: 0,
            tasks_running: 0,
            tasks: [],
          });
        }
        return json(listPersistentAgents({
          orchestrator: ctx.agentService.getOrchestrator(),
          llmManager: ctx.agentService.getLLMManager(),
          specialists: ctx.agentService.getSpecialists(),
          taskManager: tm,
        }));
      },
    },

  };
}

// ── Shared helpers (duplicated from api-routes.ts to keep route module self-contained) ──────────────────────────

type AgentTaskSnapshot = {
  id: string;
  agentId: string;
  status: string;
  task: string;
  startedAt: number;
  completedAt?: number | null;
};

function buildAgentSnapshots(ctx: ApiContext) {
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

  return {
    agents,
    latestTaskByAgent,
    taskManager,
  };
}

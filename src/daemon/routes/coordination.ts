/**
 * Coordination API Routes
 *
 * REST endpoints for multi-agent coordination visibility.
 */

import { json, type ApiContext } from './_shared.ts';
import { getCoordinationLogger } from '../../services/coordination-logger-service.ts';

export function registerRoutes(_ctx: ApiContext): Record<string, Record<string, (req: Request) => Response | Promise<Response>>> {
  const coordinationLogger = getCoordinationLogger();

  return {
    // Get all active agents
    '/api/coordination/agents': {
      GET: () => {
        const agents = coordinationLogger.getActiveAgents();
        return json({ data: agents });
      },
    },

    // Get recent coordination events
    '/api/coordination/events': {
      GET: (req) => {
        const url = new URL(req.url);
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

        const events = coordinationLogger.getRecentEvents(limit);
        return json({ data: events });
      },
    },

    // Get agent by ID
    '/api/coordination/agent/:id': {
      GET: (req) => {
        const url = new URL(req.url);
        const agentId = url.pathname.split('/').pop() || '';

        const agents = coordinationLogger.getActiveAgents();
        const agent = agents.find(a => a.id === agentId);

        if (!agent) {
          return json({ error: 'Agent not found' }, 404);
        }

        return json({ data: agent });
      },
    },

    // Get available specialist skills
    '/api/coordination/skills': {
      GET: async () => {
        try {
          const { discoverSpecialists } = await import('../../agents/role-discovery.ts');
          const specialists = discoverSpecialists('roles/specialists');
          const skills = Array.from(specialists.entries()).map(([name, def]) => ({
            id: name,
            name: def.name,
            description: def.description?.slice(0, 150) || '',
          }));
          return json({ skills });
        } catch (err) {
          return json({ skills: [], error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  };
}

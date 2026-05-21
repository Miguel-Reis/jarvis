/**
 * Graphify API Routes
 *
 * Endpoints for importing and querying knowledge graphs.
 */

import type { ApiContext } from '../api-routes.ts';
import { json, error } from './_shared.ts';

export function registerRoutes(_ctx: ApiContext) {
  return {
    '/api/graphify/import': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { path?: string; projectId?: string };
          const { getGraphifyService } = await import('../../services/graphify-service.ts');
          const service = getGraphifyService();

          const graphPath = body.path || './graph.json';
          const result = await service.importGraph(graphPath, body.projectId);

          if (result.errors.length > 0 && result.nodesImported === 0) {
            return error(result.errors.join('; '), 500);
          }

          return json(result);
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/graphify/search': {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const q = url.searchParams.get('q') || '';
          const limit = parseInt(url.searchParams.get('limit') || '20', 10);

          if (!q.trim()) {
            return error('Query parameter "q" is required', 400);
          }

          const { getGraphifyService } = await import('../../services/graphify-service.ts');
          const service = getGraphifyService();
          const results = service.search(q, limit);

          return json(results);
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/graphify/connections': {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const id = url.searchParams.get('id');

          if (!id) {
            return error('Query parameter "id" is required', 400);
          }

          const { getGraphifyService } = await import('../../services/graphify-service.ts');
          const service = getGraphifyService();
          const connections = service.getConnections(id);

          return json(connections);
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/graphify/stats': {
      GET: async () => {
        try {
          const { getGraphifyService } = await import('../../services/graphify-service.ts');
          const service = getGraphifyService();
          const stats = service.getStats();

          return json(stats);
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/graphify/clear': {
      POST: async () => {
        try {
          const { getGraphifyService } = await import('../../services/graphify-service.ts');
          const service = getGraphifyService();
          service.clearGraph();

          return json({ ok: true });
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/graphify/status': {
      GET: async () => {
        try {
          const { getGraphifyService } = await import('../../services/graphify-service.ts');
          const service = getGraphifyService();
          const hasGraph = service.hasGraph();
          const stats = hasGraph ? service.getStats() : null;

          return json({
            hasGraph,
            stats,
          });
        } catch (err) {
          return error(`${err}`);
        }
      },
    },
  };
}

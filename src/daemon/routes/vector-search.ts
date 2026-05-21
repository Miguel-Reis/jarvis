/**
 * Vector Search API Routes
 *
 * Semantic search powered by HNSW index.
 */

import type { ApiContext } from '../api-routes.ts';
import { json, error } from './_shared.ts';
import { getVectorIndex } from '../../vault/vector-index.ts';

export function registerRoutes(_ctx: ApiContext) {
  return {
    '/api/vector/search': {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const q = url.searchParams.get('q') || '';
          const limit = parseInt(url.searchParams.get('limit') || '20', 10);

          if (!q.trim()) {
            return error('Query parameter "q" is required', 400);
          }

          const service = getVectorIndex();
          const results = await service.search(q, limit);

          return json({
            query: q,
            results,
            total: results.length,
          });
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/vector/stats': {
      GET: () => {
        try {
          const service = getVectorIndex();
          const stats = service.getStats();

          return json(stats);
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/vector/rebuild': {
      POST: async () => {
        try {
          const service = getVectorIndex();
          const result = await service.rebuildIndex();

          return json(result);
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/vector/clear': {
      POST: () => {
        try {
          const service = getVectorIndex();
          service.clear();

          return json({ ok: true });
        } catch (err) {
          return error(`${err}`);
        }
      },
    },

    '/api/vector/status': {
      GET: () => {
        try {
          const service = getVectorIndex();
          const stats = service.getStats();

          return json({
            available: stats.totalVectors > 0,
            stats,
          });
        } catch (err) {
          return error(`${err}`);
        }
      },
    },
  };
}

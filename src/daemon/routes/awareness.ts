/**
 * Awareness routes — context, captures, sessions, suggestions, reports, insights.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams, CORS } from './_shared.ts';
import { getCapture, getRecentCaptures, getCapturesInRange } from '../../vault/awareness.ts';
import { readFileSync } from 'node:fs';
import type { SuggestionType } from '../../awareness/types.ts';
import path from 'node:path';
import os from 'node:os';

export function registerRoutes(ctx: ApiContext) {
  return {

    // --- Awareness ---
    '/api/awareness/status': {
      GET: () => {
        if (!ctx.awarenessService) return error('Awareness service not running', 503);
        return json({
          status: ctx.awarenessService.status(),
          enabled: ctx.awarenessService.isEnabled(),
          liveContext: ctx.awarenessService.getLiveContext(),
          usageEstimate: ctx.awarenessService.getUsageEstimate(),
        });
      },
    },

    '/api/awareness/context': {
      GET: () => {
        if (!ctx.awarenessService) return error('Awareness service not running', 503);
        return json(ctx.awarenessService.getLiveContext());
      },
    },

    '/api/awareness/captures': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const limit = parseInt(params.get('limit') ?? '50', 10);
        const app = params.get('app') ?? undefined;
        return json(getRecentCaptures(limit, app));
      },
    },

    '/api/awareness/captures/:id': {
      GET: (req: Request & { params: { id: string } }) => {
        const capture = getCapture(req.params.id);
        if (!capture) return error('Capture not found', 404);
        return json(capture);
      },
    },

    '/api/awareness/captures/:id/image': {
      GET: (req: Request & { params: { id: string } }) => {
        const capture = getCapture(req.params.id);
        if (!capture || !capture.image_path) return error('Image not found', 404);
        const jarvisDir = path.join(os.homedir(), '.jarvis');
        if (!isWithinBase(capture.image_path, jarvisDir)) {
          return error('Image not found', 404);
        }
        try {
          const imageData = readFileSync(capture.image_path);
          return new Response(imageData, {
            headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
          });
        } catch {
          return error('Image file not found on disk', 404);
        }
      },
    },

    '/api/awareness/captures/:id/thumbnail': {
      GET: (req: Request & { params: { id: string } }) => {
        const capture = getCapture(req.params.id);
        if (!capture) return error('Capture not found', 404);
        const jarvisDir = path.join(os.homedir(), '.jarvis');
        if (capture.thumbnail_path && isWithinBase(capture.thumbnail_path, jarvisDir)) {
          try {
            const thumbData = readFileSync(capture.thumbnail_path);
            return new Response(thumbData, {
              headers: { ...CORS, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' },
            });
          } catch { /* thumbnail file missing, fall through */ }
        }
        if (capture.image_path && isWithinBase(capture.image_path, jarvisDir)) {
          try {
            const imageData = readFileSync(capture.image_path);
            return new Response(imageData, {
              headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
            });
          } catch { /* fall through */ }
        }
        return error('Thumbnail not found', 404);
      },
    },

    '/api/awareness/sessions': {
      GET: (req: Request) => {
        if (!ctx.awarenessService) return error('Awareness service not running', 503);
        const params = getSearchParams(req);
        const limit = parseInt(params.get('limit') ?? '20', 10);
        return json(ctx.awarenessService.getSessionHistory(limit));
      },
    },

    '/api/awareness/suggestions': {
      GET: (req: Request) => {
        if (!ctx.awarenessService) return error('Awareness service not running', 503);
        const params = getSearchParams(req);
        const limit = parseInt(params.get('limit') ?? '20', 10);
        const type = params.get('type') as SuggestionType | null;
        return json(ctx.awarenessService.getRecentSuggestionsList(limit, type ?? undefined));
      },
    },

    '/api/awareness/suggestions/:id/dismiss': {
      PATCH: (req: Request & { params: { id: string } }) => {
        if (!ctx.awarenessService) return error('Awareness service not running', 503);
        ctx.awarenessService.dismissSuggestion(req.params.id);
        return json({ ok: true });
      },
    },

    '/api/awareness/suggestions/:id/act': {
      PATCH: (req: Request & { params: { id: string } }) => {
        if (!ctx.awarenessService) return error('Awareness service not running', 503);
        ctx.awarenessService.actOnSuggestion(req.params.id);
        return json({ ok: true });
      },
    },

    '/api/awareness/report': {
      GET: async (req: Request) => {
        if (!ctx.awarenessService) return error('Awareness service not running', 503);
        const params = getSearchParams(req);
        const date = params.get('date') ?? undefined;
        try {
          const report = await ctx.awarenessService.generateReport(date);
          return json(report);
        } catch (err) {
          return error(`Report generation failed: ${err instanceof Error ? err.message : err}`, 500);
        }
      },
    },

    '/api/awareness/stats': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const start = parseInt(params.get('start') ?? String(Date.now() - 24 * 60 * 60 * 1000), 10);
        const end = parseInt(params.get('end') ?? String(Date.now()), 10);
        return json(getCapturesInRange(start, end));
      },
    },

    '/api/awareness/report/weekly': {
      GET: async (req: Request) => {
        if (!ctx.awarenessService) return error('Awareness service not available', 503);
        try {
          const params = getSearchParams(req);
          const weekStart = params.get('weekStart') ?? undefined;
          const report = await ctx.awarenessService.generateWeeklyReport(weekStart);
          return json(report);
        } catch (err) {
          return error(`Weekly report error: ${err instanceof Error ? err.message : err}`);
        }
      },
    },

    '/api/awareness/insights': {
      GET: (req: Request) => {
        if (!ctx.awarenessService) return error('Awareness service not available', 503);
        try {
          const params = getSearchParams(req);
          const days = parseInt(params.get('days') ?? '7', 10) || 7;
          const insights = ctx.awarenessService.getBehavioralInsights(days);
          return json(insights);
        } catch (err) {
          return error(`Insights error: ${err instanceof Error ? err.message : err}`);
        }
      },
    },

    '/api/awareness/toggle': {
      POST: async (req: Request) => {
        if (!ctx.awarenessService) return error('Awareness service not available', 503);
        try {
          const body = await req.json() as { enabled: boolean };
          ctx.awarenessService.toggle(body.enabled);
          return json({ ok: true, enabled: body.enabled });
        } catch {
          return error('Invalid request body');
        }
      },
    },

  };
}

function isWithinBase(resolvedPath: string, baseDir: string): boolean {
  const normalizedBase = path.resolve(baseDir) + path.sep;
  const normalizedPath = path.resolve(resolvedPath);
  return normalizedPath.startsWith(normalizedBase) || normalizedPath === path.resolve(baseDir);
}

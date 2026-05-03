/**
 * Metrics API Routes
 *
 * REST endpoints for progress tracking dashboard.
 */

import { json, error, type ApiContext } from './_shared.ts';
import { getMetricsService } from '../../services/metrics-service.ts';
import { getPredictionEngine } from '../../services/prediction-engine.ts';
import { getTimeTracker } from '../../services/time-tracker.ts';

export function registerRoutes(ctx: ApiContext): Record<string, Record<string, (req: Request) => Response | Promise<Response>>> {
  return {
    // Daily metrics
    '/api/metrics/daily': {
      GET: (req) => {
        const url = new URL(req.url);
        const days = parseInt(url.searchParams.get('days') ?? '30', 10);
        const agentId = url.searchParams.get('agentId') ?? undefined;

        const metricsService = getMetricsService();
        const data = metricsService.getDailyMetricsForRange(Math.min(days, 90), agentId);

        return json({ data });
      },
    },

    // Weekly metrics
    '/api/metrics/weekly': {
      GET: () => {
        const metricsService = getMetricsService();
        const data = metricsService.calculateWeeklyMetrics(undefined);
        return json({ data });
      },
    },

    // Heatmap data
    '/api/metrics/heatmap': {
      GET: (req) => {
        const url = new URL(req.url);
        const months = parseInt(url.searchParams.get('months') ?? '6', 10);

        const metricsService = getMetricsService();
        const data = metricsService.getHeatmapData(Math.min(months, 12));

        return json({ data });
      },
    },

    // Project metrics
    '/api/metrics/project/:id': {
      GET: (req) => {
        const url = new URL(req.url);
        const projectId = url.pathname.split('/').pop() || '';

        const metricsService = getMetricsService();
        const data = metricsService.getProjectMetrics(projectId);

        return json({ data });
      },
    },

    // Goal predictions
    '/api/predictions/goals': {
      GET: (req) => {
        const url = new URL(req.url);
        const projectId = url.searchParams.get('projectId') ?? undefined;

        const predictionEngine = getPredictionEngine();
        const data = predictionEngine.getAllActivePredictions(projectId || undefined);

        return json({ data });
      },
    },

    // Single goal prediction
    '/api/predictions/goal/:id': {
      GET: (req) => {
        const url = new URL(req.url);
        const goalId = url.pathname.split('/').pop() || '';

        const predictionEngine = getPredictionEngine();
        const data = predictionEngine.calculateGoalPrediction(goalId);

        if (!data) {
          return error('Goal not found', 404);
        }

        return json({ data });
      },
    },

    // Project prediction
    '/api/predictions/project/:id': {
      GET: (req) => {
        const url = new URL(req.url);
        const projectId = url.pathname.split('/').pop() || '';

        const predictionEngine = getPredictionEngine();
        const data = predictionEngine.calculateProjectPrediction(projectId);

        if (!data) {
          return error('Project not found', 404);
        }

        return json({ data });
      },
    },

    // Active time tracking sessions
    '/api/time-tracker/active': {
      GET: () => {
        const timeTracker = getTimeTracker();
        const sessions = Array.from((timeTracker as any).activeSessions.values());
        return json({ sessions });
      },
    },

    // Today's tracked time
    '/api/time-tracker/today': {
      GET: (req) => {
        const url = new URL(req.url);
        const agentId = url.searchParams.get('agentId') ?? undefined;

        const timeTracker = getTimeTracker();
        const totalMs = timeTracker.getTotalTimeToday(agentId);

        return json({ totalMs, totalHours: Math.round((totalMs / (1000 * 60 * 60)) * 100) / 100 });
      },
    },

    // Start time tracking session
    '/api/time-tracker/start': {
      POST: async (req) => {
        try {
          const body = await req.json();
          const { agentId, taskId, goalId, projectId, activityType, description } = body;

          if (!agentId) {
            return error('agentId required', 400);
          }

          const timeTracker = getTimeTracker();
          timeTracker.startSession(agentId, {
            taskId,
            goalId,
            projectId,
            activityType,
            description,
          });

          return json({ success: true });
        } catch {
          return error('Invalid request body', 400);
        }
      },
    },

    // End time tracking session
    '/api/time-tracker/end': {
      POST: async (req) => {
        try {
          const body = await req.json();
          const { agentId } = body;

          if (!agentId) {
            return error('agentId required', 400);
          }

          const timeTracker = getTimeTracker();
          const entry = timeTracker.endSession(agentId);

          return json({ success: true, entry });
        } catch {
          return error('Invalid request body', 400);
        }
      },
    },
  };
}

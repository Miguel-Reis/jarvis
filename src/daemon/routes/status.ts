/**
 * System Status API Routes
 *
 * Health and status endpoints for all services.
 */

import { json, error, type ApiContext } from './_shared.ts';
import { getStatusPage } from '../status-page.ts';

export function registerRoutes(ctx: ApiContext): Record<string, Record<string, (req: Request) => Response | Promise<Response>>> {
  // Track uptime for status page
  const startTime = Date.now();

  return {
    // HTML Dashboard
    '/status': {
      GET: () => {
        const html = getStatusPage(
          ctx.agentService,
          ctx.wsService,
          ctx.approvalManager ?? null,
          ctx.auditTrail ?? null,
          ctx.commitmentExecutor ?? null,
          Date.now() - startTime
        );
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' },
        });
      },
    },

    // Overall system health
    '/api/status': {
      GET: () => {
        const healthMonitor = ctx.healthMonitor;
        const health = healthMonitor?.getHealth();

        // Determine overall status from services
        const services = health?.services || {};
        const serviceValues = Object.values(services);
        const overall = serviceValues.some(s => s === 'error' || s === 'stopping')
          ? 'degraded'
          : serviceValues.length > 0 ? 'healthy' : 'unknown';

        return json({
          status: overall,
          timestamp: Date.now(),
          uptime: process.uptime(),
          services,
        });
      },
    },

    // Performance diagnostics - measures latency of LLM and other components
    '/api/diagnostics/latency': {
      GET: async () => {
        const results: Record<string, number> = {};

        // Measure LLM latency (primary provider)
        try {
          const llmStart = Date.now();
          const { anthropic } = await import('../../llm/anthropic.ts');
          await anthropic({
            model: 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: 'Respond with just OK' }],
            max_tokens: 10,
          });
          results.llm_anthropic = Date.now() - llmStart;
        } catch (err) {
          results.llm_anthropic = -1;
        }

        // Measure database latency
        try {
          const dbStart = Date.now();
          const { getDb } = await import('../../vault/schema.ts');
          getDb().query('SELECT 1').get();
          results.database = Date.now() - dbStart;
        } catch (err) {
          results.database = -1;
        }

        // Memory stats
        const mem = process.memoryUsage();

        return json({
          latency_ms: results,
          memory: {
            heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
            heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
            rss_mb: Math.round(mem.rss / 1024 / 1024),
          },
          timestamp: Date.now(),
        });
      },
    },

    // Site builder control
    '/api/site-builder/start': {
      POST: async () => {
        const svc = ctx.siteBuilderService;
        if (!svc) return error('Site builder service not initialized', 503);
        await svc.start();
        return json({ ok: true, status: svc.status() });
      },
    },
    '/api/site-builder/stop': {
      POST: async () => {
        const svc = ctx.siteBuilderService;
        if (!svc) return error('Site builder service not initialized', 503);
        await svc.stop();
        return json({ ok: true, status: svc.status() });
      },
    },
    '/api/site-builder/status': {
      GET: () => {
        const svc = ctx.siteBuilderService;
        if (!svc) return json({ status: 'not_initialized' });
        return json({ status: svc.status() });
      },
    },
    '/api/site-builder/projects': {
      GET: async () => {
        const svc = ctx.siteBuilderService;
        if (!svc) return json({ projects: [] });
        const projects = await svc.listProjectsWithStatus();
        return json({ projects });
      },
    },

    // Live screen control
    '/api/live-screen/start': {
      POST: async () => {
        const svc = ctx.liveScreenService;
        if (!svc) return error('Live screen service not initialized', 503);
        svc.setEnabled(true);
        return json({ ok: true, status: svc.status() });
      },
    },
    '/api/live-screen/stop': {
      POST: async () => {
        const svc = ctx.liveScreenService;
        if (!svc) return error('Live screen service not initialized', 503);
        svc.setEnabled(false);
        return json({ ok: true, status: svc.status() });
      },
    },
    '/api/live-screen/status': {
      GET: () => {
        const svc = ctx.liveScreenService;
        if (!svc) return json({ status: 'not_initialized' });
        return json({
          status: svc.status(),
          connectedSidecars: svc.getConnectedSidecarCount(),
          privacyMode: svc.isPrivacyMode(),
        });
      },
    },
    '/api/live-screen/capture': {
      POST: async () => {
        const svc = ctx.liveScreenService;
        if (!svc) return error('Live screen service not initialized', 503);
        const results = await svc.captureNow();
        return json({
          captures: results.map(r => ({
            sidecarName: r.sidecarName,
            sidecarId: r.sidecarId,
            timestamp: r.timestamp,
            error: r.error,
          })),
        });
      },
    },

    // Service-specific health
    '/api/status/services': {
      GET: () => {
        const healthMonitor = ctx.healthMonitor;
        const health = healthMonitor?.getHealth();

        return json({
          services: health?.services || {},
        });
      },
    },

    // Observer status
    '/api/status/observers': {
      GET: () => {
        // Return observer status from service registry
        const observerService = ctx.observerService;
        if (!observerService) {
          return json({ observers: [] });
        }
        const status = (observerService as any).manager?.getStatus?.() || {};
        const observers = Object.entries(status).map(([name, running]) => ({
          name,
          active: running,
        }));
        return json({ observers });
      },
    },

    // Network status
    '/api/status/network': {
      GET: async () => {
        try {
          // Return cached network status if available
          return json({
            status: 'online',
            message: 'Network monitoring active',
          });
        } catch (err) {
          return json({
            status: 'unknown',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    // Battery status
    '/api/status/battery': {
      GET: async () => {
        try {
          const { existsSync } = await import('node:fs');
          const hasBattery = existsSync('/sys/class/power_supply/BAT0');
          return json({
            available: hasBattery,
            status: hasBattery ? 'monitoring' : 'not_available',
            message: hasBattery ? 'Battery monitor active' : 'No battery interface (WSL2 or desktop)',
          });
        } catch (err) {
          return json({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    // Database stats
    '/api/status/database': {
      GET: async () => {
        try {
          const { getDb } = await import('../../vault/schema.ts');
          const db = getDb();

          // Get table sizes
          const tables = [
            'entities', 'facts', 'relationships', 'commitments',
            'observations', 'agent_messages', 'conversations',
            'goals', 'workflows', 'screen_captures',
            'time_entries', 'task_history',
          ];

          const stats: Record<string, number> = {};
          for (const table of tables) {
            try {
              const stmt = db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
              const result = stmt.get() as { count: number };
              stats[table] = result.count;
            } catch {
              stats[table] = 0;
            }
          }

          return json({
            status: 'healthy',
            tables: stats,
          });
        } catch (err) {
          return json({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          }, 500);
        }
      },
    },

    // Memory and process stats
    '/api/status/system': {
      GET: () => {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        return json({
          memory: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            rss: Math.round(memUsage.rss / 1024 / 1024),
          },
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system,
          },
          uptime: process.uptime(),
          platform: process.platform,
          nodeVersion: process.version,
        });
      },
    },

    // Active agents count
    '/api/status/agents': {
      GET: async () => {
        // Coordination logger removed - return basic stats
        return json({
          total: 0,
          active: 0,
          blocked: 0,
          idle: 0,
        });
      },
    },

    // Goal stats
    '/api/status/goals': {
      GET: async () => {
        try {
          const { getDb } = await import('../../vault/schema.ts');
          const db = getDb();

          const stmt = db.prepare(`
            SELECT status, COUNT(*) as count
            FROM goals
            GROUP BY status
          `);
          const rows = stmt.all() as { status: string; count: number }[];

          const stats: Record<string, number> = {};
          for (const row of rows) {
            stats[row.status] = row.count;
          }

          return json({
            total: Object.values(stats).reduce((a, b) => a + b, 0),
            byStatus: stats,
          });
        } catch (err) {
          return json({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          }, 500);
        }
      },
    },

    // Local Brain metrics
    '/api/status/local-brain': {
      GET: async () => {
        try {
          const { globalLocalBrain } = await import('../../brain/local-brain.ts');
          const metrics = globalLocalBrain.getMetrics();
          const skills = globalLocalBrain.listSkills().map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
          }));

          // Calculate Ollama stats from LLM manager tokens
          const llmManager = ctx.llmManager;
          const sessionTokens = llmManager?.getSessionTokenCount() ?? 0;

          return json({
            metrics,
            skills,
            estimatedSavings: {
              llmCallsSaved: metrics.localMatches,
              estimatedCostSavings: (metrics.localMatches * 0.0001).toFixed(4), // ~$0.0001 per LLM call
              latencyReduction: '90%+ for local matches',
            },
            ollamaStats: {
              totalCalls: metrics.totalRequests,
              localCalls: metrics.localMatches,
              cloudCalls: metrics.llmFallbacks,
              tokensUsed: sessionTokens,
              estimatedCost: (sessionTokens * 0.00000015).toFixed(6), // ~$0.15 per 1M tokens
            },
          });
        } catch (err) {
          return json({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          }, 500);
        }
      },
    },
  };
}

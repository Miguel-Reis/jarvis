/**
 * Super Jarvis API Routes
 *
 * - /api/super-jarvis/directives — Get current goal directives
 * - /api/super-jarvis/observers — Get observer status
 * - /api/super-jarvis/observers/:name/enable — Enable an observer
 * - /api/super-jarvis/observers/:name/disable — Disable an observer
 * - /api/super-jarvis/wakeword/enable — Enable wake-word
 * - /api/super-jarvis/wakeword/disable — Disable wake-word
 * - /api/super-jarvis/interrupts — Get interrupt history
 */

import type { ApiContext } from '../api-routes.ts';
import { json } from './_shared.ts';

export function registerRoutes(ctx: ApiContext): Record<string, unknown> {
  const routes: Record<string, unknown> = {};

  // GET /api/super-jarvis/directives — Get current goal directives
  routes['/api/super-jarvis/directives'] = {
    GET: (_req: Request) => {
      try {
        const { goalService } = ctx;
        if (!goalService) {
          return json({ error: 'Goal service not available' }, 503);
        }

        const directives = goalService.getActiveDirectives();
        if (!directives) {
          return json({
            goal: null,
            current_task: null,
            next_tasks: [],
            needs_decomposition: false,
            message: 'No active directives — system in discovery mode',
          });
        }

        return json(directives);
      } catch (err) {
        console.error('[SuperJarvis] /directives error:', err);
        return json({ error: 'Failed to get directives' }, 500);
      }
    },
  };

  // GET /api/super-jarvis/observers — Get observer status
  routes['/api/super-jarvis/observers'] = {
    GET: (_req: Request) => {
      try {
        // Return observer status from interrupt manager
        // In a real implementation, this would query the actual interrupt manager
        const observers = [
          { name: 'file-watcher', active: true, triggerCount: 0 },
          { name: 'process-monitor', active: true, triggerCount: 0 },
          { name: 'error-monitor', active: true, triggerCount: 0 },
        ];
        return json(observers);
      } catch (err) {
        console.error('[SuperJarvis] /observers error:', err);
        return json({ error: 'Failed to get observers' }, 500);
      }
    },
  };

  // POST /api/super-jarvis/observers/:name/enable
  routes['/api/super-jarvis/observers/:name/enable'] = {
    POST: (_req: Request, params: { name: string }) => {
      try {
        const { name } = params;
        console.log(`[SuperJarvis] Enabling observer: ${name}`);
        // In a real implementation, this would enable the observer
        return json({ success: true, observer: name, action: 'enabled' });
      } catch (err) {
        console.error('[SuperJarvis] /observers/:name/enable error:', err);
        return json({ error: 'Failed to enable observer' }, 500);
      }
    },
  };

  // POST /api/super-jarvis/observers/:name/disable
  routes['/api/super-jarvis/observers/:name/disable'] = {
    POST: (_req: Request, params: { name: string }) => {
      try {
        const { name } = params;
        console.log(`[SuperJarvis] Disabling observer: ${name}`);
        // In a real implementation, this would disable the observer
        return json({ success: true, observer: name, action: 'disabled' });
      } catch (err) {
        console.error('[SuperJarvis] /observers/:name/disable error:', err);
        return json({ error: 'Failed to disable observer' }, 500);
      }
    },
  };

  // POST /api/super-jarvis/wakeword/enable
  routes['/api/super-jarvis/wakeword/enable'] = {
    POST: (_req: Request) => {
      try {
        console.log('[SuperJarvis] Wake-word enable requested (browser handles detection)');
        return json({ success: true, message: 'Wake-word enabled in browser' });
      } catch (err) {
        console.error('[SuperJarvis] /wakeword/enable error:', err);
        return json({ error: 'Failed to enable wake-word' }, 500);
      }
    },
  };

  // POST /api/super-jarvis/wakeword/disable
  routes['/api/super-jarvis/wakeword/disable'] = {
    POST: (_req: Request) => {
      try {
        console.log('[SuperJarvis] Wake-word disable requested');
        return json({ success: true, message: 'Wake-word disabled' });
      } catch (err) {
        console.error('[SuperJarvis] /wakeword/disable error:', err);
        return json({ error: 'Failed to disable wake-word' }, 500);
      }
    },
  };

  // GET /api/super-jarvis/interrupts — Get interrupt history
  routes['/api/super-jarvis/interrupts'] = {
    GET: (_req: Request) => {
      try {
        // Return empty array — real interrupts come via WebSocket
        return json([]);
      } catch (err) {
        console.error('[SuperJarvis] /interrupts error:', err);
        return json({ error: 'Failed to get interrupts' }, 500);
      }
    },
  };

  return routes;
}

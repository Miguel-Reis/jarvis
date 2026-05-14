/**
 * Safe Mode Control API Routes
 *
 * Enable/disable safe mode for command execution.
 * When safe mode is enabled, dangerous commands are blocked.
 */

import { json, type ApiContext } from './_shared.ts';
import { setSafeMode, isSafeModeEnabled } from '../../actions/tools/builtin.ts';

export function registerRoutes(ctx: ApiContext): Record<string, Record<string, (req: Request) => Response | Promise<Response>>> {
  return {
    // Get safe mode status
    '/api/safe-mode': {
      GET: () => {
        return json({
          enabled: isSafeModeEnabled(),
          description: 'When enabled, dangerous commands (rm, sudo, chmod, etc.) are blocked',
        });
      },
    },

    // Enable safe mode
    '/api/safe-mode/enable': {
      POST: () => {
        setSafeMode(true);
        return json({
          ok: true,
          enabled: true,
          message: 'Safe mode enabled - dangerous commands will be blocked',
        });
      },
    },

    // Disable safe mode
    '/api/safe-mode/disable': {
      POST: () => {
        setSafeMode(false);
        return json({
          ok: true,
          enabled: false,
          message: 'Safe mode disabled - all commands will be allowed (use with caution)',
        });
      },
    },

    // Toggle safe mode
    '/api/safe-mode/toggle': {
      POST: () => {
        const newState = !isSafeModeEnabled();
        setSafeMode(newState);
        return json({
          ok: true,
          enabled: newState,
          message: `Safe mode ${newState ? 'enabled' : 'disabled'}`,
        });
      },
    },
  };
}

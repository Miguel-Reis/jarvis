/**
 * User Preferences API Routes
 *
 * - GET /api/preferences — Get all user preferences
 * - GET /api/preferences/:category — Get preferences by category
 * - POST /api/preferences — Set a preference explicitly
 * - DELETE /api/preferences/:category/:name — Delete a preference
 * - POST /api/preferences/:category/:name/confidence — Update confidence
 */

import type { ApiContext } from '../api-routes.ts';
import { json } from './_shared.ts';
import {
  exportAllPreferences,
  importPreferences,
  getPreferencesByCategory,
  getHighConfidencePreferences,
  observePreference,
  updatePreferenceConfidence,
  deletePreference,
  type PreferenceCategory,
} from '../../vault/user-preferences.ts';

export function registerRoutes(_ctx: ApiContext): Record<string, unknown> {
  const routes: Record<string, unknown> = {};

  // GET /api/preferences — Get all high-confidence preferences
  routes['/api/preferences'] = {
    GET: () => {
      try {
        const preferences = getHighConfidencePreferences(0.5);
        return json(preferences);
      } catch (err) {
        console.error('[Preferences API] /preferences error:', err);
        return json({ error: 'Failed to get preferences' }, 500);
      }
    },
  };

  // GET /api/preferences/by-category — Get preferences grouped by category
  routes['/api/preferences/by-category'] = {
    GET: () => {
      try {
        const categories: PreferenceCategory[] = ['coding', 'communication', 'workflow', 'testing', 'documentation'];
        const grouped: Record<string, unknown[]> = {};

        for (const cat of categories) {
          grouped[cat] = getPreferencesByCategory(cat);
        }

        return json(grouped);
      } catch (err) {
        console.error('[Preferences API] /by-category error:', err);
        return json({ error: 'Failed to get preferences by category' }, 500);
      }
    },
  };

  // GET /api/preferences/:category — Get preferences by single category
  routes['/api/preferences/:category'] = {
    GET: (_req: Request, params: { category: string }) => {
      try {
        const category = params.category as PreferenceCategory;
        const validCategories: PreferenceCategory[] = ['coding', 'communication', 'workflow', 'testing', 'documentation'];

        if (!validCategories.includes(category)) {
          return json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` }, 400);
        }

        const preferences = getPreferencesByCategory(category);
        return json(preferences);
      } catch (err) {
        console.error('[Preferences API] /:category error:', err);
        return json({ error: 'Failed to get preferences by category' }, 500);
      }
    },
  };

  // POST /api/preferences — Set a preference explicitly
  routes['/api/preferences'] = {
    POST: async (req: Request) => {
      try {
        const body = await req.json().catch(() => ({})) as {
          category: PreferenceCategory;
          name: string;
          value: unknown;
          confidence?: number;
        };

        if (!body.category || !body.name || body.value === undefined) {
          return json({ error: 'Missing required fields: category, name, value' }, 400);
        }

        const validCategories: PreferenceCategory[] = ['coding', 'communication', 'workflow', 'testing', 'documentation'];
        if (!validCategories.includes(body.category)) {
          return json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` }, 400);
        }

        observePreference(body.category, body.name, body.value, 'explicit');

        if (body.confidence !== undefined) {
          updatePreferenceConfidence(body.category, body.name, body.confidence);
        }

        return json({ success: true, category: body.category, name: body.name });
      } catch (err) {
        console.error('[Preferences API] POST error:', err);
        return json({ error: 'Failed to set preference' }, 500);
      }
    },
  };

  // DELETE /api/preferences/:category/:name — Delete a preference
  routes['/api/preferences/:category/:name'] = {
    DELETE: (_req: Request, params: { category: string; name: string }) => {
      try {
        const category = params.category as PreferenceCategory;
        const name = params.name;

        const deleted = deletePreference(category, name);
        if (deleted) {
          return json({ success: true, category, name });
        } else {
          return json({ error: 'Preference not found' }, 404);
        }
      } catch (err) {
        console.error('[Preferences API] DELETE error:', err);
        return json({ error: 'Failed to delete preference' }, 500);
      }
    },
  };

  // POST /api/preferences/:category/:name/confidence — Update confidence
  routes['/api/preferences/:category/:name/confidence'] = {
    POST: async (req: Request, params: { category: string; name: string }) => {
      try {
        const category = params.category as PreferenceCategory;
        const name = params.name;
        const body = await req.json().catch(() => ({})) as { confidence: number };

        if (typeof body.confidence !== 'number' || body.confidence < 0 || body.confidence > 1) {
          return json({ error: 'Confidence must be a number between 0 and 1' }, 400);
        }

        const updated = updatePreferenceConfidence(category, name, body.confidence);
        if (updated) {
          return json({ success: true, preference: updated });
        } else {
          return json({ error: 'Preference not found' }, 404);
        }
      } catch (err) {
        console.error('[Preferences API] POST confidence error:', err);
        return json({ error: 'Failed to update confidence' }, 500);
      }
    },
  };

  // GET /api/preferences/export — Export all preferences as JSON
  routes['/api/preferences/export'] = {
    GET: () => {
      try {
        const preferences = exportAllPreferences();
        return json({
          version: 1,
          exported_at: Date.now(),
          preferences,
        });
      } catch (err) {
        console.error('[Preferences API] /export error:', err);
        return json({ error: 'Failed to export preferences' }, 500);
      }
    },
  };

  // POST /api/preferences/import — Import preferences from JSON
  routes['/api/preferences/import'] = {
    POST: async (req: Request) => {
      try {
        const body = await req.json().catch(() => ({})) as { preferences: Array<Partial<import('../../vault/user-preferences.ts').UserPreference>> };

        if (!body.preferences || !Array.isArray(body.preferences)) {
          return json({ error: 'Invalid import format. Expected { preferences: [...] }' }, 400);
        }

        const imported = importPreferences(body.preferences);
        return json({ success: true, imported });
      } catch (err) {
        console.error('[Preferences API] /import error:', err);
        return json({ error: 'Failed to import preferences' }, 500);
      }
    },
  };

  return routes;
}

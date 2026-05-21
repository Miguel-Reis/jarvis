/**
 * Config routes — LLM, channels, STT, TTS, Google OAuth, roles, personality, user profile, system.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams } from './_shared.ts';
import { getPersonality } from '../../personality/model.ts';
import { getUserProfile, saveUserProfile, clearUserProfile } from '../../vault/user-profile.ts';
import { USER_PROFILE_QUESTIONS, countAnsweredUserProfileQuestions, hasUserProfile, applyUserProfilePreset, USER_PROFILE_PRESETS } from '../../user/profile.ts';
import { isAutostartInstalled, getAutostartName, scheduleAutostartRestart } from '../../cli/autostart.ts';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';

const EDGE_TTS_VOICES_FALLBACK = [
  { voice_id: 'en-US-AriaNeural',    name: 'Aria (US Female)',       category: 'neural', locale: 'en-US' },
  { voice_id: 'en-US-GuyNeural',     name: 'Guy (US Male)',          category: 'neural', locale: 'en-US' },
  { voice_id: 'en-GB-SoniaNeural',   name: 'Sonia (UK Female)',      category: 'neural', locale: 'en-GB' },
  { voice_id: 'en-AU-NatashaNeural', name: 'Natasha (AU Female)',    category: 'neural', locale: 'en-AU' },
  { voice_id: 'en-US-JennyNeural',   name: 'Jenny (US Female)',      category: 'neural', locale: 'en-US' },
  { voice_id: 'en-US-DavisNeural',   name: 'Davis (US Male)',        category: 'neural', locale: 'en-US' },
  { voice_id: 'en-IE-EmilyNeural',   name: 'Emily (IE Female)',      category: 'neural', locale: 'en-IE' },
  { voice_id: 'en-IN-NeerjaNeural',  name: 'Neerja (IN Female)',     category: 'neural', locale: 'en-IN' },
  { voice_id: 'en-US-AndrewNeural',  name: 'Andrew (US Male)',       category: 'neural', locale: 'en-US' },
  { voice_id: 'en-US-EmmaNeural',    name: 'Emma (US Female)',       category: 'neural', locale: 'en-US' },
];

let edgeTtsVoicesCache: { voices: unknown[]; fetchedAt: number } | null = null;
const EDGE_TTS_CACHE_TTL = 24 * 60 * 60 * 1000;

function getProfilePresetDescription(id: string): string {
  switch (id) {
    case 'coder':
      return 'Full-stack developer focused on clean code, TypeScript, Bun, and modern web technologies';
    case 'metin2_dev':
      return 'Metin2 private server developer - C++, Lua, FreeBSD, EPHY/MALENTENDED sources, game server deployment';
    case 'data_scientist':
      return 'Data scientist / ML engineer working with Python, models, and data pipelines';
    case 'founder':
      return 'Startup founder building and scaling a business with focus on growth and product';
    default:
      return '';
  }
}

async function fetchEdgeTtsVoices(lang?: string): Promise<unknown[]> {
  const now = Date.now();
  if (edgeTtsVoicesCache && now - edgeTtsVoicesCache.fetchedAt < EDGE_TTS_CACHE_TTL) {
    const voices = edgeTtsVoicesCache.voices as Array<{ locale?: string }>;
    return lang && lang !== 'all' ? voices.filter(v => v.locale?.startsWith(lang)) : voices;
  }
  try {
    const res = await fetch(
      'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4',
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json() as Array<{ ShortName: string; FriendlyName: string; Gender: string; Locale: string }>;
    const voices = raw.map(v => ({
      voice_id: v.ShortName,
      name: v.FriendlyName.replace('Microsoft ', '').replace(' Online (Natural) - ', ' (').replace(/\)$/, ')'),
      category: 'neural',
      locale: v.Locale,
    }));
    edgeTtsVoicesCache = { voices, fetchedAt: now };
    return lang && lang !== 'all' ? voices.filter(v => (v.locale as string).startsWith(lang)) : voices;
  } catch {
    return EDGE_TTS_VOICES_FALLBACK;
  }
}

export function registerRoutes(ctx: ApiContext) {
  return {

    // --- Config (sanitized — no API keys) ---
    '/api/config': {
      GET: () => {
        const config = ctx.config;
        return json({
          daemon: config.daemon,
          llm: {
            primary: config.llm.primary,
            fallback: config.llm.fallback,
            anthropic: config.llm.anthropic ? { model: config.llm.anthropic.model } : null,
            openai: config.llm.openai ? { model: config.llm.openai.model } : null,
            groq: config.llm.groq ? { model: config.llm.groq.model } : null,
            ollama: config.llm.ollama ?? null,
          },
          personality: config.personality,
          authority: config.authority,
          heartbeat: config.heartbeat,
          active_role: config.active_role,
        });
      },
    },

    // --- Heartbeat Config ---
    '/api/config/heartbeat': {
      GET: () => {
        return json(ctx.config.heartbeat);
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { interval_minutes?: number; active_hours?: { start: number; end: number }; aggressiveness?: string };
          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();

          if (body.interval_minutes !== undefined) {
            freshConfig.heartbeat.interval_minutes = body.interval_minutes;
          }
          if (body.active_hours) {
            freshConfig.heartbeat.active_hours = body.active_hours;
          }
          if (body.aggressiveness) {
            freshConfig.heartbeat.aggressiveness = body.aggressiveness as any;
          }

          await saveConfig(freshConfig);
          ctx.config.heartbeat = freshConfig.heartbeat;

          return json({ ok: true, message: 'Heartbeat config saved.' });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    // --- System: Autostart ---
    '/api/system/autostart': {
      GET: () => {
        const installed = isAutostartInstalled();
        const keepaliveSupported = process.platform === 'darwin' || process.platform === 'linux';
        return json({
          platform: process.platform,
          manager: keepaliveSupported ? getAutostartName() : 'unsupported',
          installed,
          keepalive_supported: keepaliveSupported,
          restart_supported: keepaliveSupported && installed,
        });
      },
    },

    '/api/system/autostart/restart': {
      POST: () => {
        if (!(process.platform === 'darwin' || process.platform === 'linux')) {
          return error('24/7 restart is not supported on this platform.', 400);
        }
        if (!isAutostartInstalled()) {
          return error('JARVIS keepalive mode is not installed yet.', 400);
        }
        const scheduled = scheduleAutostartRestart();
        if (!scheduled) {
          return error('Failed to schedule keepalive service restart.');
        }
        return json({
          ok: true,
          message: `Restarting the JARVIS 24/7 ${getAutostartName()} service.`,
        });
      },
    },

    // --- Auto-update ---
    '/api/system/update': {
      GET: async () => {
        try {
          const { $ } = await import('bun');
          const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
          const localSha = (await $`git rev-parse HEAD`.text()).trim();
          await $`git fetch origin ${branch} --quiet`.quiet();
          const remoteSha = (await $`git rev-parse origin/${branch}`.text()).trim();
          return json({
            branch,
            local_sha: localSha.slice(0, 8),
            remote_sha: remoteSha.slice(0, 8),
            up_to_date: localSha === remoteSha,
            auto_update_enabled: process.env['JARVIS_AUTO_UPDATE'] === 'true',
          });
        } catch (err) {
          return error(`Failed to check for updates: ${err instanceof Error ? err.message : err}`);
        }
      },
      POST: async () => {
        try {
          const { $ } = await import('bun');
          const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
          await $`git fetch origin ${branch} --quiet`.quiet();
          const localSha = (await $`git rev-parse HEAD`.text()).trim();
          const remoteSha = (await $`git rev-parse origin/${branch}`.text()).trim();

          if (localSha === remoteSha) {
            return json({ ok: true, message: 'Already up to date.', updated: false });
          }

          try {
            await $`git pull --ff-only origin ${branch}`.quiet();
          } catch {
            await $`git fetch origin ${branch}`.quiet();
            await $`git reset --hard origin/${branch}`.quiet();
          }
          await $`bun install --frozen-lockfile`.quiet().catch(() => $`bun install`.quiet());

          setTimeout(() => process.exit(0), 500);
          return json({ ok: true, message: 'Update applied. Restarting...', updated: true, new_sha: remoteSha.slice(0, 8) });
        } catch (err) {
          return error(`Update failed: ${err instanceof Error ? err.message : err}`);
        }
      },
    },

    // --- Search Config ---
    '/api/config/search': {
      GET: () => {
        const search = ctx.config.search;
        return json({
          provider: search?.provider ?? 'duckduckgo',
          has_brave_key: !!search?.brave_api_key,
          has_tavily_key: !!search?.tavily_api_key,
          max_results: search?.max_results ?? 10,
        });
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { provider?: string; brave_api_key?: string; tavily_api_key?: string; max_results?: number };
          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();

          if (body.provider) freshConfig.search = { ...freshConfig.search, provider: body.provider as any };
          if (body.brave_api_key) freshConfig.search = { ...freshConfig.search, brave_api_key: body.brave_api_key };
          if (body.tavily_api_key) freshConfig.search = { ...freshConfig.search, tavily_api_key: body.tavily_api_key };
          if (body.max_results !== undefined) freshConfig.search = { ...freshConfig.search, max_results: body.max_results };

          await saveConfig(freshConfig);
          ctx.config.search = freshConfig.search;

          return json({ ok: true, message: 'Search config saved.' });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/config/search/test': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { provider?: string };
          const provider = body.provider || ctx.config.search?.provider || 'duckduckgo';

          if (provider === 'duckduckgo') {
            return json({ ok: true, message: 'DuckDuckGo is free and does not require API key validation.' });
          }

          if (provider === 'brave') {
            const apiKey = ctx.config.search?.brave_api_key;
            if (!apiKey) return error('Brave API key required', 400);

            const response = await fetch('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
              headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
              signal: AbortSignal.timeout(5000)
            }).catch(() => null);

            if (!response) return error('Failed to connect to Brave Search API', 500);
            if (response.status === 401) return error('Invalid API key', 401);
            if (response.ok) return json({ ok: true, message: 'Brave Search connection successful!' });
            return error(`Search test failed: ${response.status}`, 500);
          }

          if (provider === 'tavily') {
            const apiKey = ctx.config.search?.tavily_api_key;
            if (!apiKey) return error('Tavily API key required', 400);

            const response = await fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ api_key: apiKey, query: 'test', max_results: 1 }),
              signal: AbortSignal.timeout(5000)
            }).catch(() => null);

            if (!response) return error('Failed to connect to Tavily API', 500);
            if (response.status === 400) return error('Invalid API key', 401);
            const data = await response.json() as any;
            if (data.results) return json({ ok: true, message: 'Tavily connection successful!' });
            return error(`Search test failed: ${response.status}`, 500);
          }

          return error(`Unknown search provider: ${provider}`, 400);
        } catch (err) {
          return error(`Search test failed: ${err instanceof Error ? err.message : err}`, 500);
        }
      },
    },

    // --- System: Backup/Restore ---
    '/api/system/backup/export': {
      GET: async () => {
        try {
          const { loadConfig } = await import('../../config/loader.ts');
          const config = await loadConfig();

          // Remove sensitive data from export (API keys, tokens)
          const sanitizedConfig: Record<string, unknown> = {
            ...config,
            llm: {
              ...config.llm,
              anthropic: config.llm.anthropic ? { model: config.llm.anthropic.model } : null,
              openai: config.llm.openai ? { model: config.llm.openai.model } : null,
              groq: config.llm.groq ? { model: config.llm.groq.model } : null,
              gemini: config.llm.gemini ? { model: config.llm.gemini.model } : null,
              ollama: config.llm.ollama,
              openrouter: config.llm.openrouter ? { model: config.llm.openrouter.model } : null,
              litellm: config.llm.litellm,
            },
            channels: {
              telegram: config.channels?.telegram ? { enabled: config.channels.telegram.enabled, allowed_users: config.channels.telegram.allowed_users } : null,
              discord: config.channels?.discord ? { enabled: config.channels.discord.enabled, allowed_users: config.channels.discord.allowed_users, guild_id: config.channels.discord.guild_id } : null,
              whatsapp: config.channels?.whatsapp ? { enabled: config.channels.whatsapp.enabled, allowed_users: config.channels.whatsapp.allowed_users } : null,
              signal: config.channels?.signal ? { enabled: config.channels.signal.enabled, api_url: config.channels.signal.api_url, allowed_senders: config.channels.signal.allowed_senders } : null,
            },
            tts: config.tts ? { enabled: config.tts.enabled, provider: config.tts.provider, voice: config.tts.voice, rate: config.tts.rate } : null,
            stt: config.stt ? { provider: config.stt.provider } : null,
            exported_at: new Date().toISOString(),
            exported_version: 'jarvis-backup-v1',
          };

          return json(sanitizedConfig);
        } catch (err) {
          return error(`Failed to export config: ${err instanceof Error ? err.message : err}`, 500);
        }
      },
    },

    '/api/system/backup/import': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>;
          if (!body.exported_version) {
            return error('Invalid backup file format. Missing "exported_version" field.', 400);
          }

          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const currentConfig = await loadConfig();

          // Merge imported config with current (preserve API keys)
          const mergedConfig: Record<string, unknown> = {
            ...currentConfig,
            ...body,
            // Keep current sensitive data
            llm: currentConfig.llm,
            channels: currentConfig.channels,
            tts: currentConfig.tts,
            stt: currentConfig.stt,
            auth: currentConfig.auth,
          };

          // Remove metadata fields
          delete (mergedConfig as any).exported_at;
          delete (mergedConfig as any).exported_version;

          await saveConfig(mergedConfig as any);

          // Update runtime config
          Object.assign(ctx.config, mergedConfig);

          return json({ ok: true, message: 'Config imported successfully. Some settings require restart.' });
        } catch (err) {
          return error(`Failed to import config: ${err instanceof Error ? err.message : err}`, 500);
        }
      },
    },

    '/api/system/backup/reset': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { section?: string };
          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();

          if (body.section === 'all') {
            // Reset everything to defaults
            freshConfig.heartbeat = { interval_minutes: 15, active_hours: { start: 8, end: 23 }, aggressiveness: 'moderate' };
            freshConfig.tts = { enabled: false, provider: 'edge', voice: 'pt-PT-DuarteNeural', rate: '+0%', volume: '+0%' };
            freshConfig.stt = { provider: 'openai' };
            freshConfig.desktop = { enabled: true, sidecar_port: 9224, auto_launch: true, tree_depth: 5, snapshot_max_elements: 60 };
            freshConfig.awareness = { enabled: true, capture_interval_ms: 7000, min_change_threshold: 0.02, cloud_vision_enabled: true, cloud_vision_cooldown_ms: 30000, stuck_threshold_ms: 120000, struggle_grace_ms: 45000, struggle_cooldown_ms: 90000, suggestion_rate_limit_ms: 60000, overlay_autolaunch: true, retention: { full_hours: 1, key_moment_hours: 24 }, capture_dir: '~/.jarvis/captures' };
            freshConfig.authority = { default_level: 3, governed_categories: ['send_email', 'send_message', 'make_payment'], overrides: [], context_rules: [], learning: { enabled: true, suggest_threshold: 5 }, emergency_state: 'normal' };
          } else if (body.section === 'heartbeat') {
            freshConfig.heartbeat = { interval_minutes: 15, active_hours: { start: 8, end: 23 }, aggressiveness: 'moderate' };
          } else if (body.section === 'tts') {
            freshConfig.tts = { enabled: false, provider: 'edge', voice: 'pt-PT-DuarteNeural', rate: '+0%', volume: '+0%' };
          } else if (body.section === 'stt') {
            freshConfig.stt = { provider: 'openai' };
          } else {
            return error('Invalid section. Use "all", "heartbeat", "tts", or "stt".', 400);
          }

          await saveConfig(freshConfig);
          Object.assign(ctx.config, freshConfig);

          return json({ ok: true, message: `Config section "${body.section || 'all'}" reset to defaults.` });
        } catch (err) {
          return error(`Failed to reset config: ${err instanceof Error ? err.message : err}`, 500);
        }
      },
    },

    // --- LLM Configuration ---
    '/api/config/llm': {
      GET: async () => {
        const { getLLMSettings } = await import('../llm-settings.ts');
        return json(getLLMSettings(ctx.config));
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>;
          const { saveLLMSettings, hotReloadLLMProviders } = await import('../llm-settings.ts');

          saveLLMSettings(ctx.config, body as any);

          const llmManager = ctx.agentService.getLLMManager();
          hotReloadLLMProviders(ctx.config, llmManager);

          return json({ ok: true, message: 'LLM configuration saved and applied.' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return error(`Failed to save LLM config: ${msg}`);
        }
      },
    },

    '/api/config/llm/test': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { provider: string; api_key?: string; model?: string; base_url?: string };
          const { testLLMProvider } = await import('../llm-settings.ts');
          const result = await testLLMProvider(body, ctx.config);
          return json(result);
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    // --- Roles ---
    '/api/roles': {
      GET: () => {
        const orchestrator = ctx.agentService.getOrchestrator();
        const primary = orchestrator.getPrimary();
        return json({
          active_role: primary?.agent.role.name ?? ctx.config.active_role,
          role: primary?.agent.role ? {
            id: primary.agent.role.id,
            name: primary.agent.role.name,
            authority_level: primary.agent.role.authority_level,
            tools: primary.agent.role.tools,
            sub_roles: primary.agent.role.sub_roles,
          } : null,
        });
      },
    },

    // --- Personality ---
    '/api/personality': {
      GET: () => json(getPersonality()),
    },

    // --- User Profile Wizard ---
    '/api/user-profile': {
      GET: () => {
        const profile = getUserProfile();
        return json({
          questions: USER_PROFILE_QUESTIONS,
          profile,
          answered_count: countAnsweredUserProfileQuestions(profile),
          total_questions: USER_PROFILE_QUESTIONS.length,
          has_profile: hasUserProfile(profile),
        });
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { answers?: Record<string, unknown>; qualities?: string[] };
          const profile = saveUserProfile({ ...(body.answers ?? {}), qualities: body.qualities ?? [] });
          return json({
            ok: true,
            profile,
            answered_count: countAnsweredUserProfileQuestions(profile),
            total_questions: USER_PROFILE_QUESTIONS.length,
            message: 'User profile saved.',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return error(`Failed to save user profile: ${msg}`);
        }
      },
    },

    '/api/user-profile/clear': {
      POST: () => {
        clearUserProfile();
        return json({ ok: true, message: 'User profile cleared.' });
      },
    },

    '/api/user-profile/presets': {
      GET: () => {
        const presets = Object.entries(USER_PROFILE_PRESETS).map(([id, _data]) => ({
          id,
          name: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: getProfilePresetDescription(id),
        }));
        return json({ presets });
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { presetId: string };
          const preset = applyUserProfilePreset(body.presetId);
          if (!preset) {
            return error(`Unknown preset: ${body.presetId}`, 400);
          }
          const profile = saveUserProfile(preset);
          return json({
            ok: true,
            profile,
            answered_count: countAnsweredUserProfileQuestions(profile),
            total_questions: USER_PROFILE_QUESTIONS.length,
            message: `Profile preset "${body.presetId}" applied. You can edit any field.`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return error(`Failed to apply preset: ${msg}`);
        }
      },
    },

    // --- Google OAuth Callback ---
    '/api/auth/google/callback': {
      GET: async (req: Request) => {
        const params = getSearchParams(req);
        const code = params.get('code');
        const authError = params.get('error');

        if (authError) {
          return new Response(
            `<html><body><h1>Authorization Denied</h1><p>${escapeHtml(authError)}</p><p>You can close this tab.</p></body></html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        }

        if (!code) {
          return error('Missing authorization code', 400);
        }

        const googleConfig = ctx.config.google;
        if (!googleConfig?.client_id || !googleConfig?.client_secret) {
          return error('Google OAuth not configured in config.yaml', 500);
        }

        try {
          const { GoogleAuth } = await import('../../integrations/google-auth.ts');
          const auth = new GoogleAuth(googleConfig.client_id, googleConfig.client_secret);
          await auth.exchangeCode(code);

          return new Response(
            `<html><body style="font-family:system-ui;text-align:center;padding:60px">
              <h1>JARVIS Google Authorization Complete!</h1>
              <p>Tokens saved. This window will close automatically.</p>
              <script>
                if (window.opener) { window.opener.postMessage('google-auth-complete', window.location.origin); }
                setTimeout(function() { window.close(); }, 2000);
              </script>
            </body></html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(
            `<html><body><h1>Token Exchange Failed</h1><pre>${escapeHtml(msg)}</pre></body></html>`,
            { headers: { 'Content-Type': 'text/html' }, status: 500 }
          );
        }
      },
    },

    '/api/auth/google/status': {
      GET: async () => {
        const googleConfig = ctx.config.google;
        const hasCredentials = !!(googleConfig?.client_id && googleConfig?.client_secret);

        if (!hasCredentials) {
          return json({ status: 'not_configured', has_credentials: false, is_authenticated: false, scopes: [], token_expiry: null });
        }

        try {
          const { GoogleAuth } = await import('../../integrations/google-auth.ts');
          const auth = new GoogleAuth(googleConfig!.client_id, googleConfig!.client_secret);
          const authenticated = auth.isAuthenticated();
          const tokens = auth.loadTokens();

          return json({
            status: authenticated ? 'connected' : 'credentials_saved',
            has_credentials: true,
            is_authenticated: authenticated,
            scopes: ['gmail.readonly', 'calendar.readonly'],
            token_expiry: tokens?.expiry_date ?? null,
          });
        } catch {
          return json({ status: 'credentials_saved', has_credentials: true, is_authenticated: false, scopes: [], token_expiry: null });
        }
      },
    },

    '/api/config/google': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { client_id: string; client_secret: string };
          if (!body.client_id || !body.client_secret) {
            return error('Missing client_id or client_secret');
          }

          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();
          freshConfig.google = { client_id: body.client_id, client_secret: body.client_secret };
          await saveConfig(freshConfig);

          ctx.config.google = freshConfig.google;

          return json({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return error(`Failed to save Google config: ${msg}`, 500);
        }
      },
    },

    '/api/auth/google/init': {
      POST: async () => {
        const googleConfig = ctx.config.google;
        if (!googleConfig?.client_id || !googleConfig?.client_secret) {
          return error('Google credentials not configured. Save client_id and client_secret first.', 400);
        }

        try {
          const { GoogleAuth } = await import('../../integrations/google-auth.ts');
          const auth = new GoogleAuth(googleConfig.client_id, googleConfig.client_secret);
          const scopes = [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/calendar.readonly',
          ];
          const authUrl = auth.getAuthUrl(scopes);
          return json({ auth_url: authUrl });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return error(`Failed to generate auth URL: ${msg}`, 500);
        }
      },
    },

    '/api/auth/google/disconnect': {
      POST: async () => {
        try {
          const tokensPath = path.join(os.homedir(), '.jarvis', 'google-tokens.json');
          if (existsSync(tokensPath)) {
            const { unlinkSync } = await import('node:fs');
            unlinkSync(tokensPath);
          }
          return json({ ok: true, message: 'Disconnected. Restart JARVIS to deactivate observers.' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return error(`Failed to disconnect: ${msg}`, 500);
        }
      },
    },

    // --- Channels ---
    '/api/channels/status': {
      GET: () => {
        if (!ctx.channelService) return json({ channels: {}, stt: null });
        return json({
          channels: ctx.channelService.getChannelStatus(),
          stt: ctx.config.stt?.provider ?? null,
        });
      },
    },

    '/api/config/channels': {
      GET: () => {
        const cfg = ctx.config.channels;
        return json({
          telegram: cfg?.telegram ? {
            enabled: cfg.telegram.enabled,
            has_token: !!cfg.telegram.bot_token,
            allowed_users: cfg.telegram.allowed_users,
          } : { enabled: false, has_token: false, allowed_users: [] },
          discord: cfg?.discord ? {
            enabled: cfg.discord.enabled,
            has_token: !!cfg.discord.bot_token,
            allowed_users: cfg.discord.allowed_users,
            guild_id: cfg.discord.guild_id ?? null,
          } : { enabled: false, has_token: false, allowed_users: [], guild_id: null },
          whatsapp: cfg?.whatsapp ? {
            enabled: cfg.whatsapp.enabled,
            has_phone_number_id: !!cfg.whatsapp.phone_number_id,
            has_access_token: !!cfg.whatsapp.access_token,
            has_verify_token: !!cfg.whatsapp.webhook_verify_token,
            allowed_users: cfg.whatsapp.allowed_users ?? [],
          } : { enabled: false, has_phone_number_id: false, has_access_token: false, has_verify_token: false, allowed_users: [] },
          signal: cfg?.signal ? {
            enabled: cfg.signal.enabled,
            phone: cfg.signal.phone,
            api_url: cfg.signal.api_url ?? 'http://localhost:8080',
            allowed_senders: cfg.signal.allowed_senders ?? [],
          } : { enabled: false, phone: '', api_url: 'http://localhost:8080', allowed_senders: [] },
        });
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>;
          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();

          if (!freshConfig.channels) freshConfig.channels = {};

          if (body.telegram && typeof body.telegram === 'object') {
            freshConfig.channels.telegram = {
              ...freshConfig.channels.telegram,
              ...(body.telegram as Record<string, unknown>),
            } as any;
          }
          if (body.discord && typeof body.discord === 'object') {
            freshConfig.channels.discord = {
              ...freshConfig.channels.discord,
              ...(body.discord as Record<string, unknown>),
            } as any;
          }
          if (body.whatsapp && typeof body.whatsapp === 'object') {
            freshConfig.channels.whatsapp = {
              ...freshConfig.channels.whatsapp,
              ...(body.whatsapp as Record<string, unknown>),
            } as any;
          }
          if (body.signal && typeof body.signal === 'object') {
            freshConfig.channels.signal = {
              ...freshConfig.channels.signal,
              ...(body.signal as Record<string, unknown>),
            } as any;
          }

          await saveConfig(freshConfig);
          ctx.config.channels = freshConfig.channels;

          return json({ ok: true, message: 'Channel config saved. Restart JARVIS to apply changes.' });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/config/channels/test': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { channel: string; token?: string; phone_number_id?: string; access_token?: string };
          const channel = body.channel;

          if (!channel) return error('Channel name required (telegram, discord, whatsapp, signal)', 400);

          // Telegram: getMe API call
          if (channel === 'telegram') {
            const token = body.token || ctx.config.channels?.telegram?.bot_token;
            if (!token) return error('Telegram bot token required', 400);

            const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
              signal: AbortSignal.timeout(5000)
            }).catch(() => null);

            if (!response) return error('Failed to connect to Telegram API', 500);
            if (response.status === 401) return error('Invalid bot token', 401);
            const data = await response.json() as any;
            if (data.ok) return json({ ok: true, message: `Telegram bot connected: @${data.result.username || data.result.first_name}` });
            return error(`Telegram test failed: ${data.description || response.status}`, 500);
          }

          // Discord: get current application info
          if (channel === 'discord') {
            const token = body.token || ctx.config.channels?.discord?.bot_token;
            if (!token) return error('Discord bot token required', 400);

            const response = await fetch('https://discord.com/api/v10/users/@me', {
              headers: { 'Authorization': `Bot ${token}` },
              signal: AbortSignal.timeout(5000)
            }).catch(() => null);

            if (!response) return error('Failed to connect to Discord API', 500);
            if (response.status === 401) return error('Invalid bot token', 401);
            const data = await response.json() as any;
            if (data.id) return json({ ok: true, message: `Discord bot connected: ${data.username || data.global_name}` });
            return error(`Discord test failed: ${response.status}`, 500);
          }

          // WhatsApp: validate phone number ID and access token
          if (channel === 'whatsapp') {
            const phoneNumberId = body.phone_number_id || ctx.config.channels?.whatsapp?.phone_number_id;
            const accessToken = body.access_token || ctx.config.channels?.whatsapp?.access_token;
            if (!phoneNumberId || !accessToken) return error('WhatsApp phone number ID and access token required', 400);

            const response = await fetch(
              `https://graph.facebook.com/v17.0/${phoneNumberId}?fields=verified_name`,
              {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(5000)
              }
            ).catch(() => null);

            if (!response) return error('Failed to connect to WhatsApp Cloud API', 500);
            if (response.status === 401) return error('Invalid access token', 401);
            const data = await response.json() as any;
            if (data.id) return json({ ok: true, message: `WhatsApp connected: ${data.verified_name || data.id}` });
            return error(`WhatsApp test failed: ${data.error?.message || response.status}`, 500);
          }

          // Signal: check local daemon connection
          if (channel === 'signal') {
            const apiUrl = ctx.config.channels?.signal?.api_url || 'http://localhost:8080';
            const phone = body.phone || ctx.config.channels?.signal?.phone;
            if (!phone) return error('Signal phone number required', 400);

            try {
              const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/v1/accounts/${phone}`, {
                signal: AbortSignal.timeout(3000)
              }).catch(() => null);

              if (!response) return error(`Cannot connect to signal-cli at ${apiUrl}`, 500);
              if (response.ok) return json({ ok: true, message: `Signal connected: ${phone}` });
              return error(`Signal test failed: ${response.status}`, 500);
            } catch {
              return error(`Cannot connect to signal-cli at ${apiUrl}`, 500);
            }
          }

          return error(`Unknown channel: ${channel}`, 400);
        } catch (err) {
          return error(`Channel test failed: ${err instanceof Error ? err.message : err}`, 500);
        }
      },
    },

    '/api/config/stt': {
      GET: () => {
        const stt = ctx.config.stt;
        return json({
          provider: stt?.provider ?? 'openai',
          has_openai_key: !!stt?.openai?.api_key,
          has_groq_key: !!stt?.groq?.api_key,
          local_endpoint: stt?.local?.endpoint ?? null,
          local_server_type: stt?.local?.server_type ?? 'whisper_cpp',
        });
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>;
          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();
          freshConfig.stt = { ...freshConfig.stt, ...body } as any;
          await saveConfig(freshConfig);
          ctx.config.stt = freshConfig.stt;
          return json({ ok: true, message: 'STT config saved. Restart JARVIS to apply changes.' });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/config/stt/test': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { provider?: string; api_key?: string; endpoint?: string };
          const provider = body.provider || ctx.config.stt?.provider || 'openai';

          // Create a small test audio buffer (silence for validation)
          const testAudio = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);

          if (provider === 'openai') {
            const apiKey = body.api_key || ctx.config.stt?.openai?.api_key;
            if (!apiKey) return error('OpenAI API key required', 400);

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}` },
              body: (() => {
                const fd = new FormData();
                fd.append('file', new Blob([testAudio], { type: 'audio/webm' }), 'test.webm');
                fd.append('model', 'whisper-1');
                return fd;
              })(),
            }).catch(() => null);

            if (!response) return error('Failed to connect to OpenAI API', 500);
            if (response.status === 401) return error('Invalid API key', 401);
            if (response.ok) return json({ ok: true, message: 'OpenAI STT connection successful!' });
            return error(`STT test failed: ${response.status}`, 500);
          }

          if (provider === 'groq') {
            const apiKey = body.api_key || ctx.config.stt?.groq?.api_key;
            if (!apiKey) return error('Groq API key required', 400);

            const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}` },
              body: (() => {
                const fd = new FormData();
                fd.append('file', new Blob([testAudio], { type: 'audio/webm' }), 'test.webm');
                fd.append('model', 'whisper-large-v3-turbo');
                return fd;
              })(),
            }).catch(() => null);

            if (!response) return error('Failed to connect to Groq API', 500);
            if (response.status === 401) return error('Invalid API key', 401);
            if (response.ok) return json({ ok: true, message: 'Groq STT connection successful!' });
            return error(`STT test failed: ${response.status}`, 500);
          }

          if (provider === 'local') {
            const endpoint = body.endpoint || ctx.config.stt?.local?.endpoint || 'http://localhost:8080';
            try {
              const response = await fetch(`${endpoint.replace(/\/+$/, '')}/health`, {
                signal: AbortSignal.timeout(3000)
              }).catch(() => null);
              if (response?.ok) return json({ ok: true, message: `Local Whisper connected at ${endpoint}` });
              return error(`Local Whisper not responding at ${endpoint}`, 500);
            } catch {
              return error(`Cannot connect to local Whisper at ${endpoint}`, 500);
            }
          }

          return error(`Unknown STT provider: ${provider}`, 400);
        } catch (err) {
          return error(`STT test failed: ${err instanceof Error ? err.message : err}`, 500);
        }
      },
    },

    '/api/config/tts': {
      GET: () => {
        const tts = ctx.config.tts;
        return json({
          enabled: tts?.enabled ?? false,
          provider: tts?.provider ?? 'edge',
          voice: tts?.voice ?? 'en-US-AriaNeural',
          rate: tts?.rate ?? '+0%',
          volume: tts?.volume ?? '+0%',
          elevenlabs: tts?.elevenlabs ? {
            has_api_key: !!tts.elevenlabs.api_key,
            voice_id: tts.elevenlabs.voice_id ?? null,
            model: tts.elevenlabs.model ?? 'eleven_flash_v2_5',
            stability: tts.elevenlabs.stability ?? 0.5,
            similarity_boost: tts.elevenlabs.similarity_boost ?? 0.75,
          } : null,
          azure: tts?.azure ? {
            has_api_key: !!tts.azure.api_key,
            region: tts.azure.region ?? 'westeurope',
            output_format: tts.azure.output_format ?? 'audio-24khz-48kbitrate-mono-mp3',
          } : null,
          google: tts?.google ? {
            has_api_key: !!tts.google.api_key,
            language_code: tts.google.language_code ?? 'pt-PT',
          } : null,
          openai: tts?.openai ? {
            has_api_key: !!tts.openai.api_key,
            model: tts.openai.model ?? 'tts-1',
            voice: tts.openai.voice ?? 'alloy',
          } : null,
        });
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>;
          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();

          // Extract provider-specific configs to merge properly
          const incomingEl = body.elevenlabs as Record<string, unknown> | undefined;
          const existingEl = freshConfig.tts?.elevenlabs;
          delete body.elevenlabs;

          const incomingAzure = body.azure as Record<string, unknown> | undefined;
          const existingAzure = freshConfig.tts?.azure;
          delete body.azure;

          const incomingGoogle = body.google as Record<string, unknown> | undefined;
          const existingGoogle = freshConfig.tts?.google;
          delete body.google;

          const incomingOpenai = body.openai as Record<string, unknown> | undefined;
          const existingOpenai = freshConfig.tts?.openai;
          delete body.openai;

          freshConfig.tts = { ...freshConfig.tts, ...body } as any;

          if (incomingEl) {
            freshConfig.tts!.elevenlabs = {
              ...existingEl,
              ...incomingEl,
              api_key: (incomingEl.api_key as string) || existingEl?.api_key || '',
            } as any;
          }

          if (incomingAzure) {
            freshConfig.tts!.azure = {
              ...existingAzure,
              ...incomingAzure,
              api_key: (incomingAzure.api_key as string) || existingAzure?.api_key || '',
            } as any;
          }

          if (incomingGoogle) {
            freshConfig.tts!.google = {
              ...existingGoogle,
              ...incomingGoogle,
              api_key: (incomingGoogle.api_key as string) || existingGoogle?.api_key || '',
            } as any;
          }

          if (incomingOpenai) {
            freshConfig.tts!.openai = {
              ...existingOpenai,
              ...incomingOpenai,
              api_key: (incomingOpenai.api_key as string) || existingOpenai?.api_key || '',
            } as any;
          }

          await saveConfig(freshConfig);
          ctx.config.tts = freshConfig.tts;

          if (ctx.wsService && freshConfig.tts) {
            const { createTTSProvider } = await import('../../comms/voice.ts');
            const provider = createTTSProvider(freshConfig.tts);
            if (provider) {
              ctx.wsService.setTTSProvider(provider);
            }
          }

          return json({ ok: true, message: 'TTS config saved.' });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/config/tts/test': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { provider?: string; api_key?: string; region?: string; voice?: string };
          const provider = body.provider || ctx.config.tts?.provider || 'edge';
          const testText = 'Hello, this is a test.';

          if (provider === 'edge') {
            return json({ ok: true, message: 'Edge TTS is free and does not require API key validation.' });
          }

          if (provider === 'elevenlabs') {
            const apiKey = body.api_key || ctx.config.tts?.elevenlabs?.api_key;
            if (!apiKey) return error('ElevenLabs API key required', 400);

            const response = await fetch('https://api.elevenlabs.io/v1/voices', {
              headers: { 'xi-api-key': apiKey },
              signal: AbortSignal.timeout(5000)
            }).catch(() => null);

            if (!response) return error('Failed to connect to ElevenLabs API', 500);
            if (response.status === 401) return error('Invalid API key', 401);
            if (response.ok) return json({ ok: true, message: 'ElevenLabs connection successful!' });
            return error(`TTS test failed: ${response.status}`, 500);
          }

          if (provider === 'azure') {
            const apiKey = body.api_key || ctx.config.tts?.azure?.api_key;
            const region = body.region || ctx.config.tts?.azure?.region || 'westeurope';
            if (!apiKey) return error('Azure API key required', 400);

            const response = await fetch(
              `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
              {
                method: 'POST',
                headers: {
                  'Ocp-Apim-Subscription-Key': apiKey,
                  'Content-Type': 'application/ssml+xml',
                  'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
                },
                body: `<speak version="1.0" xml:lang="en-US"><voice xml:name="en-US-AriaNeural">${testText}</voice></speak>`,
                signal: AbortSignal.timeout(5000)
              }
            ).catch(() => null);

            if (!response) return error('Failed to connect to Azure Speech API', 500);
            if (response.status === 401) return error('Invalid API key', 401);
            if (response.ok) return json({ ok: true, message: 'Azure Speech connection successful!' });
            return error(`TTS test failed: ${response.status}`, 500);
          }

          if (provider === 'google') {
            const apiKey = body.api_key || ctx.config.tts?.google?.api_key;
            if (!apiKey) return error('Google Cloud API key required', 400);

            const response = await fetch(
              `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  input: { text: testText },
                  voice: { languageCode: 'pt-PT', name: 'pt-PT-Standard-C' },
                  audioConfig: { audioEncoding: 'MP3' },
                }),
                signal: AbortSignal.timeout(5000)
              }
            ).catch(() => null);

            if (!response) return error('Failed to connect to Google Cloud TTS API', 500);
            if (response.status === 401) return error('Invalid API key', 401);
            if (response.ok) return json({ ok: true, message: 'Google Cloud TTS connection successful!' });
            return error(`TTS test failed: ${response.status}`, 500);
          }

          if (provider === 'openai') {
            const apiKey = body.api_key || ctx.config.tts?.openai?.api_key;
            if (!apiKey) return error('OpenAI API key required', 400);

            const response = await fetch('https://api.openai.com/v1/audio/speech', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'tts-1',
                input: testText,
                voice: 'alloy',
              }),
              signal: AbortSignal.timeout(5000)
            }).catch(() => null);

            if (!response) return error('Failed to connect to OpenAI TTS API', 500);
            if (response.status === 401) return error('Invalid API key', 401);
            if (response.ok) return json({ ok: true, message: 'OpenAI TTS connection successful!' });
            return error(`TTS test failed: ${response.status}`, 500);
          }

          return error(`Unknown TTS provider: ${provider}`, 400);
        } catch (err) {
          return error(`TTS test failed: ${err instanceof Error ? err.message : err}`, 500);
        }
      },
    },

    // --- TTS Voices ---
    '/api/tts/voices': {
      GET: async (req: Request) => {
        const params = getSearchParams(req);
        const provider = params.get('provider') ?? 'edge';
        const lang = params.get('lang') ?? 'en';

        if (provider === 'elevenlabs') {
          const apiKey = ctx.config.tts?.elevenlabs?.api_key;
          if (!apiKey) return error('ElevenLabs API key not configured', 400);

          try {
            const { listElevenLabsVoices } = await import('../../comms/voice.ts');
            const voices = await listElevenLabsVoices(apiKey);
            return json(voices);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return error(`Failed to fetch ElevenLabs voices: ${msg}`, 500);
          }
        }

        if (provider === 'azure') {
          // Return predefined list of Azure Neural voices
          const azureVoices = [
            { voice_id: 'pt-PT-DuarteNeural', name: 'Duarte (Portuguese Male)', locale: 'pt-PT' },
            { voice_id: 'pt-PT-RaquelNeural', name: 'Raquel (Portuguese Female)', locale: 'pt-PT' },
            { voice_id: 'pt-BR-AntonioNeural', name: 'Antonio (Brazilian Male)', locale: 'pt-BR' },
            { voice_id: 'pt-BR-FranciscaNeural', name: 'Francisca (Brazilian Female)', locale: 'pt-BR' },
            { voice_id: 'en-US-AndrewNeural', name: 'Andrew (US Male)', locale: 'en-US' },
            { voice_id: 'en-US-AriaNeural', name: 'Aria (US Female)', locale: 'en-US' },
            { voice_id: 'en-US-GuyNeural', name: 'Guy (US Male)', locale: 'en-US' },
            { voice_id: 'en-US-JennyNeural', name: 'Jenny (US Female)', locale: 'en-US' },
            { voice_id: 'en-GB-RyanNeural', name: 'Ryan (UK Male)', locale: 'en-GB' },
            { voice_id: 'en-GB-SoniaNeural', name: 'Sonia (UK Female)', locale: 'en-GB' },
          ];
          return json(lang === 'all' ? azureVoices : azureVoices.filter(v => v.locale.startsWith(lang.split('-')[0])));
        }

        if (provider === 'google') {
          // Return predefined list of Google WaveNet voices
          const googleVoices = [
            { voice_id: 'pt-PT-Standard-C', name: 'Standard C (Portuguese Female)', locale: 'pt-PT' },
            { voice_id: 'pt-PT-Standard-D', name: 'Standard D (Portuguese Male)', locale: 'pt-PT' },
            { voice_id: 'pt-PT-Wavenet-C', name: 'WaveNet C (Portuguese Female)', locale: 'pt-PT' },
            { voice_id: 'pt-PT-Wavenet-D', name: 'WaveNet D (Portuguese Male)', locale: 'pt-PT' },
            { voice_id: 'pt-BR-Standard-A', name: 'Standard A (Brazilian Female)', locale: 'pt-BR' },
            { voice_id: 'pt-BR-Standard-B', name: 'Standard B (Brazilian Male)', locale: 'pt-BR' },
            { voice_id: 'pt-BR-Wavenet-A', name: 'WaveNet A (Brazilian Female)', locale: 'pt-BR' },
            { voice_id: 'pt-BR-Wavenet-B', name: 'WaveNet B (Brazilian Male)', locale: 'pt-BR' },
            { voice_id: 'en-US-Standard-A', name: 'Standard A (US Female)', locale: 'en-US' },
            { voice_id: 'en-US-Standard-B', name: 'Standard B (US Male)', locale: 'en-US' },
            { voice_id: 'en-US-Wavenet-A', name: 'WaveNet A (US Female)', locale: 'en-US' },
            { voice_id: 'en-US-Wavenet-B', name: 'WaveNet B (US Male)', locale: 'en-US' },
          ];
          return json(lang === 'all' ? googleVoices : googleVoices.filter(v => v.locale.startsWith(lang.split('-')[0])));
        }

        if (provider === 'openai') {
          // Return predefined list of OpenAI voices
          const openaiVoices = [
            { voice_id: 'alloy', name: 'Alloy (Neutral)', locale: 'en-US' },
            { voice_id: 'echo', name: 'Echo (Male)', locale: 'en-US' },
            { voice_id: 'fable', name: 'Fable (Male, British)', locale: 'en-GB' },
            { voice_id: 'onyx', name: 'Onyx (Male, Deep)', locale: 'en-US' },
            { voice_id: 'nova', name: 'Nova (Female, Warm)', locale: 'en-US' },
            { voice_id: 'shimmer', name: 'Shimmer (Female, Soft)', locale: 'en-US' },
          ];
          return json(openaiVoices);
        }

        // Default: Edge TTS
        const voices = await fetchEdgeTtsVoices(lang);
        return json(voices);
      },
    },

  };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Config routes — LLM, channels, STT, TTS, Google OAuth, roles, personality, user profile, system.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams } from './_shared.ts';
import { getPersonality } from '../../personality/model.ts';
import { getUserProfile, saveUserProfile, clearUserProfile } from '../../vault/user-profile.ts';
import { USER_PROFILE_QUESTIONS, countAnsweredUserProfileQuestions, hasUserProfile } from '../../user/profile.ts';
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

    // --- LLM Configuration ---
    '/api/config/llm': {
      GET: async () => {
        const { getLLMSettings } = await import('./llm-settings.ts');
        return json(getLLMSettings(ctx.config));
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>;
          const { saveLLMSettings, hotReloadLLMProviders } = await import('./llm-settings.ts');

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
          const { testLLMProvider } = await import('./llm-settings.ts');
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
          const body = await req.json() as { answers?: Record<string, unknown> };
          const profile = saveUserProfile(body.answers ?? {});
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
        });
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>;
          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const freshConfig = await loadConfig();

          const incomingEl = body.elevenlabs as Record<string, unknown> | undefined;
          const existingEl = freshConfig.tts?.elevenlabs;
          delete body.elevenlabs;

          freshConfig.tts = { ...freshConfig.tts, ...body } as any;

          if (incomingEl) {
            freshConfig.tts!.elevenlabs = {
              ...existingEl,
              ...incomingEl,
              api_key: (incomingEl.api_key as string) || existingEl?.api_key || '',
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

    // --- TTS Voices ---
    '/api/tts/voices': {
      GET: async (req: Request) => {
        const params = getSearchParams(req);
        const provider = params.get('provider') ?? 'edge';

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

        const lang = params.get('lang') ?? 'en';
        const voices = await fetchEdgeTtsVoices(lang);
        return json(voices);
      },
    },

  };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

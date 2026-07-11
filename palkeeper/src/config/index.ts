import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import type { AppConfig } from "./types.js";

export const DEFAULTS: AppConfig = {
  timezone: "Europe/Lisbon",
  logLevel: "info",
  database: { path: "data/palkeeper.db" },
  palworld: {
    restUrl: "http://127.0.0.1:8212",
    adminPassword: "",
    rcon: { enabled: true, host: "127.0.0.1", port: 25575 },
    savedPath: "/palworld/Saved",
    requestTimeoutMs: 10_000,
    maxRetries: 3,
    circuitBreaker: { failureThreshold: 5, cooldownSeconds: 30 },
  },
  pelican: { enabled: false, url: "", serverId: "", apiKey: "" },
  autosave: { enabled: true, intervalMinutes: 15 },
  backup: { enabled: true, path: "data/backups", keep: 48 },
  restart: {
    enabled: false,
    cron: "0 6 * * *",
    countdownMinutes: [10, 5, 2, 1],
    serverReturnTimeoutMinutes: 15,
  },
  sessions: { enabled: true, pollIntervalSeconds: 15 },
  welcome: { enabled: true, delaySeconds: 5, viaMod: false },
  watchdog: {
    enabled: false,
    checkIntervalSeconds: 60,
    memoryLimitMB: 28_000,
    fpsThreshold: 15,
    sustainedMinutes: 5,
    cooldownMinutes: 30,
    countdownMinutes: [5, 2, 1],
    processName: "PalServer",
    procPath: "/host/proc",
  },
  moderation: { whitelistEnabled: false },
  motd: { enabled: false, intervalMinutes: 30, onlyWhenPlayersOnline: true, messages: [] },
  leaderboard: { enabled: false, cron: "0 21 * * 0", top: 5, period: "weekly" },
  discord: {
    enabled: false,
    webhookUrl: "",
    dailySummaryCron: "59 23 * * *",
    notify: {
      joinLeave: true,
      backups: true,
      watchdog: true,
      serverStatus: true,
      restarts: true,
      dailySummary: true,
      events: true,
      chat: false,
    },
  },
  events: { enabled: true, countdownMinutes: [5, 2, 1], iniPath: "" },
  api: { port: 8300, host: "0.0.0.0", token: "" },
  messages: {
    restartWarning: "[PalKeeper] O servidor reinicia em {minutes} min!",
    restartNow: "[PalKeeper] O servidor vai reiniciar AGORA. Ate ja!",
    restartDone: "[PalKeeper] Servidor de volta. Bom jogo!",
    welcome: "Bem-vindo de volta, {name}!",
    welcomeFirst: "Bem-vindo ao servidor, {name}! Diverte-te!",
    kickNotWhitelisted: "Nao estas na whitelist deste servidor.",
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge profundo: valores do `override` ganham; objetos são fundidos, arrays substituídos. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || value === null) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(baseValue) && isPlainObject(value) ? deepMerge(baseValue, value) : value;
  }
  return out as T;
}

export class ConfigError extends Error {}

function applyEnvOverrides(config: AppConfig, env: NodeJS.ProcessEnv): void {
  if (env.PALWORLD_ADMIN_PASSWORD) config.palworld.adminPassword = env.PALWORLD_ADMIN_PASSWORD;
  if (env.PELICAN_API_KEY) config.pelican.apiKey = env.PELICAN_API_KEY;
  if (env.PALKEEPER_API_TOKEN) config.api.token = env.PALKEEPER_API_TOKEN;
  if (env.DISCORD_WEBHOOK_URL) config.discord.webhookUrl = env.DISCORD_WEBHOOK_URL;
  if (env.PALKEEPER_LOG_LEVEL) config.logLevel = env.PALKEEPER_LOG_LEVEL;
}

function validate(config: AppConfig): void {
  const errors: string[] = [];
  if (!config.palworld.adminPassword) {
    errors.push("palworld.adminPassword em falta — define a env PALWORLD_ADMIN_PASSWORD");
  }
  if (!/^https?:\/\//.test(config.palworld.restUrl)) {
    errors.push(`palworld.restUrl inválido: "${config.palworld.restUrl}"`);
  }
  if (config.autosave.intervalMinutes < 1) {
    errors.push("autosave.intervalMinutes tem de ser >= 1");
  }
  if (config.backup.keep < 1) {
    errors.push("backup.keep tem de ser >= 1");
  }
  if (config.restart.enabled) {
    if (!config.restart.cron.trim()) errors.push("restart.cron em falta");
    if (config.restart.countdownMinutes.some((m) => m < 1)) {
      errors.push("restart.countdownMinutes só aceita valores >= 1");
    }
  }
  if (config.pelican.enabled) {
    if (!config.pelican.url) errors.push("pelican.url em falta");
    if (!config.pelican.serverId) errors.push("pelican.serverId em falta");
    if (!config.pelican.apiKey) errors.push("pelican.apiKey em falta — define a env PELICAN_API_KEY");
  }
  if (!config.api.token) {
    errors.push("api.token em falta — define a env PALKEEPER_API_TOKEN");
  }
  if (config.discord.enabled && !config.discord.webhookUrl) {
    errors.push("discord.webhookUrl em falta — define a env DISCORD_WEBHOOK_URL");
  }
  if (config.motd.enabled && config.motd.messages.length === 0) {
    errors.push("motd.messages vazio com motd.enabled: true");
  }
  if (config.watchdog.enabled) {
    if (config.watchdog.sustainedMinutes < 1) errors.push("watchdog.sustainedMinutes tem de ser >= 1");
    if (config.watchdog.checkIntervalSeconds < 5) errors.push("watchdog.checkIntervalSeconds tem de ser >= 5");
  }
  if (config.leaderboard.enabled && !["weekly", "monthly"].includes(config.leaderboard.period)) {
    errors.push(`leaderboard.period inválido: "${config.leaderboard.period}" (weekly|monthly)`);
  }
  if (errors.length > 0) {
    throw new ConfigError(`Configuração inválida:\n  - ${errors.join("\n  - ")}`);
  }
}

export function loadConfig(
  path = process.env.PALKEEPER_CONFIG ?? "config.yaml",
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  let fileConfig: unknown = {};
  if (existsSync(path)) {
    try {
      fileConfig = parse(readFileSync(path, "utf8")) ?? {};
    } catch (err) {
      throw new ConfigError(`Erro ao ler ${path}: ${(err as Error).message}`);
    }
  }
  if (!isPlainObject(fileConfig)) {
    throw new ConfigError(`${path} não contém um mapa YAML válido`);
  }
  const config = deepMerge(structuredClone(DEFAULTS), fileConfig);
  // Ordena os avisos por ordem decrescente para a contagem fazer sentido
  config.restart.countdownMinutes = [...config.restart.countdownMinutes].sort((a, b) => b - a);
  config.watchdog.countdownMinutes = [...config.watchdog.countdownMinutes].sort((a, b) => b - a);
  config.events.countdownMinutes = [...config.events.countdownMinutes].sort((a, b) => b - a);
  if (!config.events.iniPath) {
    config.events.iniPath = `${config.palworld.savedPath}/Config/WindowsServer/PalWorldSettings.ini`;
  }
  applyEnvOverrides(config, env);
  validate(config);
  return config;
}

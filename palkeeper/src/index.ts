import { startApi } from "./api/index.js";
import { DiscordWebhookClient } from "./clients/discord-webhook.js";
import { PalworldRestClient } from "./clients/palworld-rest.js";
import { PelicanClient } from "./clients/pelican.js";
import { RconClient } from "./clients/rcon.js";
import { loadConfig } from "./config/index.js";
import { openDatabase } from "./core/db.js";
import { AppEvents } from "./core/events.js";
import { createLogger } from "./core/logger.js";
import { PlayerPoller } from "./core/player-poller.js";
import { RestartOrchestrator } from "./core/restart-orchestrator.js";
import { Scheduler } from "./core/scheduler.js";
import { ServerState } from "./core/server-state.js";
import { AutosaveModule } from "./modules/autosave/index.js";
import { BackupService } from "./modules/backup/index.js";
import { DiscordNotifyModule } from "./modules/discord-notify/index.js";
import { EventPlannerModule } from "./modules/events/index.js";
import { LeaderboardModule } from "./modules/leaderboard/index.js";
import { MetricsModule } from "./modules/metrics/index.js";
import { ModerationModule } from "./modules/moderation/index.js";
import { MotdModule } from "./modules/motd/index.js";
import { ScheduledRestartModule } from "./modules/scheduled-restart/index.js";
import { SessionsModule } from "./modules/sessions/index.js";
import { WatchdogModule } from "./modules/watchdog/index.js";
import { WelcomeModule } from "./modules/welcome/index.js";

const PROBE_INTERVAL_MS = 15_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info("PalKeeper a arrancar");

  const db = openDatabase(config.database.path);
  const serverState = new ServerState();
  const events = new AppEvents();
  const scheduler = new Scheduler(config.timezone, logger);

  // ponte ServerState → bus (módulos e Discord subscrevem o bus)
  serverState.on("online", () => {
    logger.info("servidor Palworld ONLINE");
    events.emit("serverOnline");
  });
  serverState.on("offline", () => {
    logger.warn("servidor Palworld OFFLINE — em modo de espera");
    events.emit("serverOffline");
  });

  const rest = new PalworldRestClient({
    baseUrl: config.palworld.restUrl,
    adminPassword: config.palworld.adminPassword,
    timeoutMs: config.palworld.requestTimeoutMs,
    maxRetries: config.palworld.maxRetries,
    failureThreshold: config.palworld.circuitBreaker.failureThreshold,
    cooldownMs: config.palworld.circuitBreaker.cooldownSeconds * 1000,
    logger: logger.child({ mod: "rest" }),
    serverState,
  });

  // RCON fica disponível como fallback manual/futuro; REST é o caminho principal.
  const rcon = config.palworld.rcon.enabled
    ? new RconClient({
        host: config.palworld.rcon.host,
        port: config.palworld.rcon.port,
        password: config.palworld.adminPassword,
        logger: logger.child({ mod: "rcon" }),
      })
    : null;
  void rcon;

  const pelican = config.pelican.enabled
    ? new PelicanClient({
        url: config.pelican.url,
        serverId: config.pelican.serverId,
        apiKey: config.pelican.apiKey,
        logger: logger.child({ mod: "pelican" }),
      })
    : null;

  const backup = config.backup.enabled
    ? new BackupService({
        db,
        logger: logger.child({ mod: "backup" }),
        savedPath: config.palworld.savedPath,
        backupPath: config.backup.path,
        keep: config.backup.keep,
        events,
      })
    : null;

  const orchestrator = new RestartOrchestrator({
    db,
    logger: logger.child({ mod: "restart" }),
    rest,
    pelican,
    backup,
    serverState,
    messages: config.messages,
    serverReturnTimeoutMinutes: config.restart.serverReturnTimeoutMinutes,
    events,
  });

  // ---- Sessões + poller de jogadores ----
  let sessions: SessionsModule | null = null;
  let poller: PlayerPoller | null = null;
  if (config.sessions.enabled) {
    sessions = new SessionsModule({ db, logger: logger.child({ mod: "sessions" }), events });
    sessions.start();
    poller = new PlayerPoller({
      rest,
      events,
      serverState,
      logger: logger.child({ mod: "players" }),
      pollIntervalSeconds: config.sessions.pollIntervalSeconds,
      isKnownPlayer: (uid) => sessions!.isKnownPlayer(uid),
    });
    poller.start();
    // marca de vida para fechar sessões órfãs após crash do daemon
    scheduler.scheduleEveryMinutes("sessions-touch", 1, () => sessions!.touch());
  }

  let welcome: WelcomeModule | null = null;
  if (config.welcome.enabled) {
    welcome = new WelcomeModule({
      events,
      rest,
      logger: logger.child({ mod: "welcome" }),
      messages: config.messages,
      delaySeconds: config.welcome.delaySeconds,
      viaMod: config.welcome.viaMod,
    });
    welcome.start();
  }

  let moderation: ModerationModule | null = null;
  moderation = new ModerationModule({
    db,
    logger: logger.child({ mod: "moderation" }),
    events,
    rest,
    messages: config.messages,
    whitelistEnabled: config.moderation.whitelistEnabled,
    onlinePlayers: () => poller?.onlinePlayers ?? [],
  });
  moderation.start();

  let watchdog: WatchdogModule | null = null;
  if (config.watchdog.enabled) {
    watchdog = new WatchdogModule({
      config: config.watchdog,
      db,
      logger: logger.child({ mod: "watchdog" }),
      events,
      rest,
      serverState,
      orchestrator,
    });
    watchdog.start();
  }

  let metrics: MetricsModule | null = null;
  metrics = new MetricsModule({
    db,
    logger: logger.child({ mod: "metrics" }),
    scheduler,
    rest,
    serverState,
    ramMB: () => watchdog?.status.lastRamMB ?? null,
  });
  metrics.start();

  if (config.motd.enabled) {
    new MotdModule({
      db,
      logger: logger.child({ mod: "motd" }),
      scheduler,
      rest,
      serverState,
      intervalMinutes: config.motd.intervalMinutes,
      onlyWhenPlayersOnline: config.motd.onlyWhenPlayersOnline,
      messages: config.motd.messages,
      onlineCount: () => poller?.onlinePlayers.length ?? 0,
    }).start();
  }

  const discord = config.discord.enabled
    ? new DiscordWebhookClient({
        webhookUrl: config.discord.webhookUrl,
        logger: logger.child({ mod: "discord" }),
      })
    : null;

  let leaderboard: LeaderboardModule | null = null;
  if (config.leaderboard.enabled && sessions) {
    leaderboard = new LeaderboardModule({
      logger: logger.child({ mod: "leaderboard" }),
      scheduler,
      rest,
      serverState,
      sessions,
      discord,
      cron: config.leaderboard.cron,
      top: config.leaderboard.top,
      period: config.leaderboard.period,
    });
    leaderboard.start();
  }

  if (discord) {
    new DiscordNotifyModule({
      config: config.discord,
      db,
      logger: logger.child({ mod: "discord-notify" }),
      events,
      scheduler,
      discord,
      sessions,
      metrics,
      onlineCount: () => poller?.onlinePlayers.length ?? 0,
    }).start();
  }

  let planner: EventPlannerModule | null = null;
  if (config.events.enabled) {
    planner = new EventPlannerModule({
      db,
      logger: logger.child({ mod: "events" }),
      events,
      scheduler,
      rest,
      orchestrator,
      serverState,
      iniPath: config.events.iniPath,
      defaultCountdownMinutes: config.events.countdownMinutes,
    });
    planner.start();
  }

  // Poller de disponibilidade: alimenta o circuit breaker e o ServerState,
  // e garante a reconexão automática quando o servidor volta.
  await rest.probe();
  const probeTimer = setInterval(() => {
    rest.probe().catch(() => {});
  }, PROBE_INTERVAL_MS);

  let autosave: AutosaveModule | null = null;
  if (config.autosave.enabled) {
    autosave = new AutosaveModule({
      db,
      logger: logger.child({ mod: "autosave" }),
      scheduler,
      rest,
      serverState,
      backup,
      intervalMinutes: config.autosave.intervalMinutes,
    });
    autosave.start();
  }

  if (config.restart.enabled) {
    new ScheduledRestartModule({
      logger: logger.child({ mod: "scheduled-restart" }),
      scheduler,
      orchestrator,
      cron: config.restart.cron,
      countdownMinutes: config.restart.countdownMinutes,
    }).start();
  }

  const apiServer = startApi({
    config: config.api,
    logger: logger.child({ mod: "api" }),
    serverState,
    rest,
    autosave,
    orchestrator,
    restartCron: config.restart.enabled ? config.restart.cron : null,
    poller,
    moderation,
    leaderboard,
    watchdog,
    metrics,
    planner,
    db,
    sessions,
    welcome,
    discord,
    discordChatRelay: config.discord.notify.chat,
    restartCountdownMinutes: config.restart.countdownMinutes,
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "PalKeeper a desligar");
    clearInterval(probeTimer);
    poller?.stop();
    watchdog?.stop();
    moderation?.stop();
    planner?.stop();
    scheduler.stopAll();
    apiServer.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info(
    {
      autosave: config.autosave.enabled ? `${config.autosave.intervalMinutes}min` : "off",
      backup: config.backup.enabled ? `${config.backup.path} (keep ${config.backup.keep})` : "off",
      restart: config.restart.enabled ? config.restart.cron : "off",
      pelican: config.pelican.enabled ? config.pelican.serverId : "off",
      sessions: config.sessions.enabled ? `${config.sessions.pollIntervalSeconds}s` : "off",
      watchdog: config.watchdog.enabled
        ? `${config.watchdog.memoryLimitMB}MB / ${config.watchdog.fpsThreshold}fps`
        : "off",
      whitelist: config.moderation.whitelistEnabled ? "on" : "off",
      motd: config.motd.enabled ? `${config.motd.intervalMinutes}min` : "off",
      leaderboard: config.leaderboard.enabled ? config.leaderboard.cron : "off",
      discord: config.discord.enabled ? "on" : "off",
      events: config.events.enabled ? config.events.iniPath : "off",
    },
    "PalKeeper pronto",
  );
}

// O daemon corre semanas sem supervisão: nada disto o pode derrubar em silêncio.
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  process.exit(1); // o Docker/systemd reinicia o daemon
});

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

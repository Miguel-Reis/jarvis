import { startApi } from "./api/index.js";
import { PalworldRestClient } from "./clients/palworld-rest.js";
import { PelicanClient } from "./clients/pelican.js";
import { RconClient } from "./clients/rcon.js";
import { loadConfig } from "./config/index.js";
import { openDatabase } from "./core/db.js";
import { createLogger } from "./core/logger.js";
import { RestartOrchestrator } from "./core/restart-orchestrator.js";
import { Scheduler } from "./core/scheduler.js";
import { ServerState } from "./core/server-state.js";
import { AutosaveModule } from "./modules/autosave/index.js";
import { BackupService } from "./modules/backup/index.js";
import { ScheduledRestartModule } from "./modules/scheduled-restart/index.js";

const PROBE_INTERVAL_MS = 15_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info("PalKeeper a arrancar");

  const db = openDatabase(config.database.path);
  const serverState = new ServerState();
  const scheduler = new Scheduler(config.timezone, logger);

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

  // RCON fica disponível como fallback manual/futuro; a Fase 1 usa só REST.
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
  });

  serverState.on("online", () => logger.info("servidor Palworld ONLINE"));
  serverState.on("offline", () => logger.warn("servidor Palworld OFFLINE — em modo de espera"));

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
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "PalKeeper a desligar");
    clearInterval(probeTimer);
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

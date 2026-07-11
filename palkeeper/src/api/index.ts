import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import type { PalworldRestClient } from "../clients/palworld-rest.js";
import type { ApiConfig } from "../config/types.js";
import type { Logger } from "../core/logger.js";
import type { PlayerPoller } from "../core/player-poller.js";
import type { RestartOrchestrator } from "../core/restart-orchestrator.js";
import type { ServerState } from "../core/server-state.js";
import type { AutosaveModule } from "../modules/autosave/index.js";
import type { LeaderboardModule } from "../modules/leaderboard/index.js";
import type { MetricsModule } from "../modules/metrics/index.js";
import type { ModerationModule } from "../modules/moderation/index.js";
import type { WatchdogModule } from "../modules/watchdog/index.js";

export interface ApiDeps {
  config: ApiConfig;
  logger: Logger;
  serverState: ServerState;
  rest: PalworldRestClient;
  autosave: AutosaveModule | null;
  orchestrator: RestartOrchestrator;
  restartCron: string | null;
  poller: PlayerPoller | null;
  moderation: ModerationModule | null;
  leaderboard: LeaderboardModule | null;
  watchdog: WatchdogModule | null;
  metrics: MetricsModule | null;
}

export function createApi(deps: ApiDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Auth por token em tudo o resto
  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.header("x-api-token");
    if (token !== deps.config.token) {
      res.status(401).json({ error: "token inválido" });
      return;
    }
    next();
  });

  app.get("/status", (_req, res) => {
    res.json({
      server: {
        status: deps.serverState.status,
        since: deps.serverState.since.toISOString(),
        circuit: deps.rest.circuitState,
        playersOnline: deps.poller?.onlinePlayers.length ?? null,
      },
      autosave: deps.autosave?.status ?? null,
      watchdog: deps.watchdog?.status ?? null,
      restart: {
        cron: deps.restartCron,
        inProgress: deps.orchestrator.inProgress,
        lastResult: deps.orchestrator.lastResult,
      },
    });
  });

  app.get("/players", (_req, res) => {
    res.json({ players: deps.poller?.onlinePlayers ?? [] });
  });

  app.get("/metrics/history", (req, res) => {
    const hours = Math.min(168, Number(req.query.hours) || 24);
    res.json({ points: deps.metrics?.history(hours) ?? [] });
  });

  app.get("/leaderboard", (req, res) => {
    const period = req.query.period === "monthly" ? "monthly" : "weekly";
    res.json({ period, entries: deps.leaderboard?.compute(period) ?? [] });
  });

  // ---- Moderação ----

  app.get("/whitelist", (_req, res) => {
    res.json({ whitelist: deps.moderation?.listWhitelist() ?? [] });
  });

  app.post("/whitelist", (req, res) => {
    const { steamId, name } = req.body as { steamId?: string; name?: string };
    if (!deps.moderation) return void res.status(503).json({ error: "moderação desativada" });
    if (!steamId) return void res.status(400).json({ error: "steamId em falta" });
    deps.moderation.addToWhitelist(steamId, name ?? null, "api");
    res.status(201).json({ ok: true });
  });

  app.delete("/whitelist/:steamId", (req, res) => {
    if (!deps.moderation) return void res.status(503).json({ error: "moderação desativada" });
    const removed = deps.moderation.removeFromWhitelist(req.params.steamId, "api");
    res.status(removed ? 200 : 404).json({ ok: removed });
  });

  app.get("/bans", (_req, res) => {
    res.json({ bans: deps.moderation?.listBans() ?? [] });
  });

  app.post("/bans", async (req, res) => {
    const { steamId, name, reason } = req.body as { steamId?: string; name?: string; reason?: string };
    if (!deps.moderation) return void res.status(503).json({ error: "moderação desativada" });
    if (!steamId) return void res.status(400).json({ error: "steamId em falta" });
    await deps.moderation.ban(steamId, name ?? null, reason ?? "Banido pelo administrador", "api");
    res.status(201).json({ ok: true });
  });

  app.delete("/bans/:steamId", async (req, res) => {
    if (!deps.moderation) return void res.status(503).json({ error: "moderação desativada" });
    const removed = await deps.moderation.unban(req.params.steamId, "api");
    res.status(removed ? 200 : 404).json({ ok: removed });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    deps.logger.error({ err }, "erro na API interna");
    res.status(500).json({ error: "erro interno" });
  });

  return app;
}

export function startApi(deps: ApiDeps): Server {
  const app = createApi(deps);
  const server = app.listen(deps.config.port, deps.config.host, () => {
    deps.logger.info({ port: deps.config.port, host: deps.config.host }, "API interna a escutar");
  });
  return server;
}

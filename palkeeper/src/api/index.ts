import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import type { DiscordWebhookClient } from "../clients/discord-webhook.js";
import type { PalworldRestClient } from "../clients/palworld-rest.js";
import type { ApiConfig } from "../config/types.js";
import { logAction, type Db } from "../core/db.js";
import type { Logger } from "../core/logger.js";
import type { PlayerPoller } from "../core/player-poller.js";
import type { RestartOrchestrator } from "../core/restart-orchestrator.js";
import type { ServerState } from "../core/server-state.js";
import type { AutosaveModule } from "../modules/autosave/index.js";
import { validateEvent, type EventPlannerModule } from "../modules/events/index.js";
import type { NewEvent } from "../modules/events/store.js";
import type { LeaderboardModule } from "../modules/leaderboard/index.js";
import type { MetricsModule } from "../modules/metrics/index.js";
import type { ModerationModule } from "../modules/moderation/index.js";
import type { SessionsModule } from "../modules/sessions/index.js";
import type { WatchdogModule } from "../modules/watchdog/index.js";
import type { WelcomeModule } from "../modules/welcome/index.js";

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
  planner: EventPlannerModule | null;
  db: Db;
  sessions: SessionsModule | null;
  welcome: WelcomeModule | null;
  discord: DiscordWebhookClient | null;
  /** relay do chat in-game para o Discord (config discord.notify.chat) */
  discordChatRelay: boolean;
  restartCountdownMinutes: number[];
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

  // ---- Ações administrativas (usadas pelo PalKeeperMod e pelo dashboard) ----

  app.post("/actions/announce", async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message?.trim()) return void res.status(400).json({ error: "message em falta" });
    try {
      await deps.rest.announce(message);
      logAction(deps.db, "api", "announce", { message });
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: "servidor indisponível" });
    }
  });

  app.post("/actions/save", async (_req, res) => {
    try {
      await deps.rest.save();
      logAction(deps.db, "api", "save", { source: "api" });
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: "servidor indisponível" });
    }
  });

  app.post("/actions/kick", async (req, res) => {
    const { steamId, message } = req.body as { steamId?: string; message?: string };
    if (!steamId) return void res.status(400).json({ error: "steamId em falta" });
    try {
      await deps.rest.kick(steamId, message ?? "Kicked");
      logAction(deps.db, "api", "kick", { steamId });
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: "servidor indisponível" });
    }
  });

  app.post("/actions/restart", (req, res) => {
    if (deps.orchestrator.inProgress) return void res.status(409).json({ error: "restart já em curso" });
    const { countdownMinutes } = req.body as { countdownMinutes?: number[] };
    const countdown =
      Array.isArray(countdownMinutes) && countdownMinutes.length > 0
        ? countdownMinutes
        : deps.restartCountdownMinutes;
    void deps.orchestrator.execute("pedido pela API", countdown);
    res.status(202).json({ ok: true, countdown });
  });

  // ---- Integração com o PalKeeperMod (mod C++ in-game) ----

  app.get("/mod/playtime/:uid", (req, res) => {
    const row = deps.db
      .prepare(
        `SELECT last_name AS name, steam_id AS steamId, total_playtime_seconds AS playtimeSeconds,
                first_seen_at AS firstSeenAt
         FROM players WHERE player_uid = ?`,
      )
      .get(req.params.uid) as { name: string; steamId: string; playtimeSeconds: number } | undefined;
    if (!row) return void res.status(404).json({ error: "jogador desconhecido" });
    res.json(row);
  });

  app.get("/mod/leaderboard", (_req, res) => {
    if (!deps.sessions) return void res.status(503).json({ error: "sessões desativadas" });
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    res.json({ entries: deps.sessions.topPlaytime(from, to, 5) });
  });

  app.get("/mod/events/active", (_req, res) => {
    const active = deps.planner?.store.list().filter((event) => event.status === "active") ?? [];
    res.json({ events: active.map((event) => ({ id: event.id, name: event.name, type: event.type })) });
  });

  app.get("/mod/pending-welcomes", (_req, res) => {
    res.json({ welcomes: deps.welcome?.drainPending() ?? [] });
  });

  app.post("/mod/chat", (req, res) => {
    const { sender, playerUid, steamId, message } = req.body as {
      sender?: string;
      playerUid?: string;
      steamId?: string;
      message?: string;
    };
    if (!message) return void res.status(400).json({ error: "message em falta" });
    logAction(deps.db, "mod", "chat", { sender, playerUid, steamId, message });
    if (deps.discord && deps.discordChatRelay) {
      void deps.discord.send({ content: `💬 **${sender ?? "?"}**: ${message.slice(0, 1500)}` });
    }
    res.json({ ok: true });
  });

  // ---- Event planner ----

  app.get("/events", (_req, res) => {
    res.json({ events: deps.planner?.store.list() ?? [] });
  });

  app.get("/events/:id", (req, res) => {
    const event = deps.planner?.store.get(Number(req.params.id));
    if (!event) return void res.status(404).json({ error: "evento não encontrado" });
    res.json({ event, runs: deps.planner!.store.listRuns(event.id) });
  });

  app.post("/events", (req, res) => {
    if (!deps.planner) return void res.status(503).json({ error: "event planner desativado" });
    const body = req.body as NewEvent;
    const errors = validateEvent(body);
    if (errors.length > 0) return void res.status(400).json({ errors });
    const event = deps.planner.store.create(body);
    deps.planner.refreshSchedules();
    res.status(201).json({ event });
  });

  app.put("/events/:id", (req, res) => {
    if (!deps.planner) return void res.status(503).json({ error: "event planner desativado" });
    const current = deps.planner.store.get(Number(req.params.id));
    if (!current) return void res.status(404).json({ error: "evento não encontrado" });
    const patch = req.body as Partial<NewEvent>;
    const merged: NewEvent = {
      name: patch.name ?? current.name,
      type: current.type, // o tipo não muda depois de criado
      cronExpression: patch.cronExpression !== undefined ? patch.cronExpression : current.cronExpression,
      startAt: patch.startAt !== undefined ? patch.startAt : current.startAt,
      durationMinutes: patch.durationMinutes !== undefined ? patch.durationMinutes : current.durationMinutes,
      payload: patch.payload ?? current.payload,
      enabled: patch.enabled ?? current.enabled,
    };
    const errors = validateEvent(merged);
    if (errors.length > 0) return void res.status(400).json({ errors });
    const event = deps.planner.store.update(current.id, merged);
    deps.planner.refreshSchedules();
    res.json({ event });
  });

  app.delete("/events/:id", (req, res) => {
    if (!deps.planner) return void res.status(503).json({ error: "event planner desativado" });
    const removed = deps.planner.store.delete(Number(req.params.id));
    deps.planner.refreshSchedules();
    res.status(removed ? 200 : 404).json({ ok: removed });
  });

  app.post("/events/:id/trigger", async (req, res) => {
    if (!deps.planner) return void res.status(503).json({ error: "event planner desativado" });
    const event = deps.planner.store.get(Number(req.params.id));
    if (!event) return void res.status(404).json({ error: "evento não encontrado" });
    const ok = await deps.planner.trigger(event.id);
    res.status(ok ? 200 : 409).json({ ok });
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

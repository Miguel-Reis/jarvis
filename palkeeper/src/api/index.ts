import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import type { PalworldRestClient } from "../clients/palworld-rest.js";
import type { ApiConfig } from "../config/types.js";
import type { Logger } from "../core/logger.js";
import type { RestartOrchestrator } from "../core/restart-orchestrator.js";
import type { ServerState } from "../core/server-state.js";
import type { AutosaveModule } from "../modules/autosave/index.js";

export interface ApiDeps {
  config: ApiConfig;
  logger: Logger;
  serverState: ServerState;
  rest: PalworldRestClient;
  autosave: AutosaveModule | null;
  orchestrator: RestartOrchestrator;
  restartCron: string | null;
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
      },
      autosave: deps.autosave?.status ?? null,
      restart: {
        cron: deps.restartCron,
        inProgress: deps.orchestrator.inProgress,
        lastResult: deps.orchestrator.lastResult,
      },
    });
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

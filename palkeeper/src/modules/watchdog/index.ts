import type { PalworldRestClient } from "../../clients/palworld-rest.js";
import type { WatchdogConfig } from "../../config/types.js";
import { logAction, type Db } from "../../core/db.js";
import type { AppEvents } from "../../core/events.js";
import type { Logger } from "../../core/logger.js";
import { readProcessRssBytes } from "../../core/proc-stats.js";
import type { RestartOrchestrator } from "../../core/restart-orchestrator.js";
import type { ServerState } from "../../core/server-state.js";
import { WatchdogEvaluator } from "./evaluator.js";

export interface WatchdogOptions {
  config: WatchdogConfig;
  db: Db;
  logger: Logger;
  events: AppEvents;
  rest: PalworldRestClient;
  serverState: ServerState;
  orchestrator: RestartOrchestrator;
  readRss?: (procPath: string, processName: string) => number | null;
}

export interface WatchdogStatus {
  lastRamMB: number | null;
  lastFps: number | null;
  breaching: boolean;
}

/**
 * Watchdog do memory leak do Palworld: vigia RAM do processo (via /proc do
 * host) e FPS do servidor; condição sustentada dispara a sequência de
 * restart com avisos (reutiliza o RestartOrchestrator).
 */
export class WatchdogModule {
  private readonly evaluator: WatchdogEvaluator;
  private readonly readRss: (procPath: string, processName: string) => number | null;
  private timer: NodeJS.Timeout | null = null;
  private warnedNoProc = false;
  private _status: WatchdogStatus = { lastRamMB: null, lastFps: null, breaching: false };

  constructor(private readonly opts: WatchdogOptions) {
    this.evaluator = new WatchdogEvaluator(opts.config);
    this.readRss = opts.readRss ?? readProcessRssBytes;
    // restarts de outras origens também contam para o cooldown
    opts.events.on("restartFinished", () => this.evaluator.noteRestart(Date.now()));
  }

  get status(): WatchdogStatus {
    return this._status;
  }

  start(): void {
    this.timer = setInterval(() => void this.check(), this.opts.config.checkIntervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Um ciclo de verificação. Nunca lança. */
  async check(): Promise<void> {
    const { config, logger, serverState, orchestrator } = this.opts;
    if (!serverState.isOnline || orchestrator.inProgress) return;
    try {
      let fps: number | null = null;
      try {
        fps = (await this.opts.rest.metrics()).serverfps;
      } catch {
        // métricas indisponíveis neste ciclo — avalia só a RAM
      }
      const ramBytes = this.readRss(config.procPath, config.processName);
      if (ramBytes === null && !this.warnedNoProc) {
        this.warnedNoProc = true;
        logger.warn(
          { procPath: config.procPath, processName: config.processName },
          "RAM do processo indisponível (monta /proc do host em procPath) — watchdog só vigia FPS",
        );
      }

      this._status = {
        lastRamMB: ramBytes === null ? null : Math.round(ramBytes / 1024 / 1024),
        lastFps: fps,
        breaching: false,
      };

      const decision = this.evaluator.evaluate({ ramBytes, fps, timestamp: Date.now() });
      if (decision.kind === "breaching") {
        this._status.breaching = true;
        logger.warn({ reason: decision.reason, sinceMs: decision.sinceMs }, "watchdog: condição de restart ativa");
      } else if (decision.kind === "restart") {
        logger.error({ reason: decision.reason }, "watchdog: a iniciar restart");
        logAction(this.opts.db, "watchdog", "watchdog_triggered", { reason: decision.reason });
        this.opts.events.emit("watchdogAlert", {
          reason: decision.reason,
          ramMB: this._status.lastRamMB,
          fps,
        });
        void orchestrator.execute(`watchdog: ${decision.reason}`, config.countdownMinutes);
      }
    } catch (err) {
      logger.warn({ err }, "ciclo do watchdog falhou");
    }
  }
}

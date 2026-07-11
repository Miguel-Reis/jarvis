import type { PalworldRestClient } from "../clients/palworld-rest.js";
import type { PelicanClient } from "../clients/pelican.js";
import type { MessagesConfig } from "../config/types.js";
import type { BackupService } from "../modules/backup/index.js";
import { Mutex, sleep } from "../utils/async.js";
import { logAction, type Db } from "./db.js";
import type { AppEvents } from "./events.js";
import type { Logger } from "./logger.js";
import type { ServerState } from "./server-state.js";

export interface RestartOrchestratorOptions {
  db: Db;
  logger: Logger;
  rest: PalworldRestClient;
  pelican: PelicanClient | null;
  backup: BackupService | null;
  serverState: ServerState;
  messages: MessagesConfig;
  /** Minutos à espera que o servidor volte após o start */
  serverReturnTimeoutMinutes: number;
  events?: AppEvents;
  /** Injetáveis para testes */
  sleepFn?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  shutdownTimeoutMs?: number;
}

/**
 * Sequência única de restart, protegida por mutex — usada pelo restart
 * agendado (Fase 1) e reutilizada pelo watchdog (Fase 2) e pelos
 * settings-events (Fase 3):
 *   countdown → save+backup → shutdown gracioso → Pelican start → esperar online
 */
export class RestartOrchestrator {
  private readonly mutex = new Mutex();
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly shutdownTimeoutMs: number;
  private _lastResult: { at: string; reason: string; ok: boolean } | null = null;

  constructor(private readonly opts: RestartOrchestratorOptions) {
    this.sleepFn = opts.sleepFn ?? sleep;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5000;
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? 180_000;
  }

  get inProgress(): boolean {
    return this.mutex.isLocked;
  }

  get lastResult() {
    return this._lastResult;
  }

  /**
   * Executa a sequência completa. Devolve false se já houver um restart em
   * curso ou se o servidor não voltar dentro do timeout. Nunca lança.
   */
  async execute(reason: string, countdownMinutes: number[]): Promise<boolean> {
    if (this.mutex.isLocked) {
      this.opts.logger.warn({ reason }, "restart ignorado — já existe um em curso");
      return false;
    }
    return this.mutex.runExclusive(async () => {
      const { db, logger } = this.opts;
      logger.info({ reason, countdownMinutes }, "sequência de restart iniciada");
      logAction(db, "system", "restart_started", { reason, countdownMinutes });
      this.opts.events?.emit("restartStarted", { reason });
      try {
        if (this.opts.serverState.isOnline) {
          await this.countdown(countdownMinutes);
          await this.saveAndBackup();
          await this.gracefulShutdown();
        } else {
          logger.warn("servidor já offline — a saltar countdown/save/shutdown");
        }
        await this.startViaPelican();
        const backOnline = await this.waitForOnline();
        if (backOnline) {
          await this.tryAnnounce(this.opts.messages.restartDone);
          logAction(db, "system", "restart_completed", { reason });
          logger.info({ reason }, "restart concluído — servidor online");
        } else {
          logAction(db, "system", "restart_failed", { reason, cause: "timeout à espera do servidor" });
          logger.error({ reason }, "restart falhou — servidor não voltou dentro do timeout");
        }
        this._lastResult = { at: new Date().toISOString(), reason, ok: backOnline };
        this.opts.events?.emit("restartFinished", { reason, ok: backOnline });
        return backOnline;
      } catch (err) {
        logger.error({ err, reason }, "erro inesperado na sequência de restart");
        logAction(db, "system", "restart_failed", { reason, cause: String(err) });
        this._lastResult = { at: new Date().toISOString(), reason, ok: false };
        this.opts.events?.emit("restartFinished", { reason, ok: false });
        return false;
      }
    });
  }

  private async countdown(marks: number[]): Promise<void> {
    const sorted = [...marks].sort((a, b) => b - a);
    for (let i = 0; i < sorted.length; i++) {
      const minutes = sorted[i]!;
      if (!this.opts.serverState.isOnline) {
        this.opts.logger.warn("servidor caiu durante o countdown — a abortar avisos");
        return;
      }
      await this.tryAnnounce(this.opts.messages.restartWarning.replaceAll("{minutes}", String(minutes)));
      const next = sorted[i + 1] ?? 0;
      await this.sleepFn((minutes - next) * 60_000);
    }
  }

  private async saveAndBackup(): Promise<void> {
    try {
      await this.opts.rest.save();
      this.opts.logger.info("save final antes do restart concluído");
    } catch (err) {
      this.opts.logger.warn({ err }, "save final falhou — a continuar o restart");
    }
    if (this.opts.backup) await this.opts.backup.run("pre-restart");
  }

  private async gracefulShutdown(): Promise<void> {
    const { rest, logger } = this.opts;
    try {
      await rest.shutdown(10, this.opts.messages.restartNow);
    } catch (err) {
      logger.warn({ err }, "POST /shutdown falhou — a tentar /stop");
      await rest.stop().catch((stopErr) => logger.warn({ err: stopErr }, "POST /stop também falhou"));
    }
    const wentDown = await this.waitForOffline(this.shutdownTimeoutMs);
    if (!wentDown) {
      logger.warn("servidor ainda responde após o shutdown — a forçar /stop");
      await rest.stop().catch(() => {});
      await this.waitForOffline(this.shutdownTimeoutMs);
    }
  }

  private async startViaPelican(): Promise<void> {
    if (!this.opts.pelican) {
      this.opts.logger.info("Pelican desativado — à espera que o painel reinicie o servidor sozinho");
      return;
    }
    try {
      await this.opts.pelican.power("start");
    } catch (err) {
      // Se o Pelican já tiver reiniciado o servidor (crash detection), o start
      // pode falhar por já estar a correr — o waitForOnline decide o desfecho.
      this.opts.logger.warn({ err }, "power start no Pelican falhou — a verificar se o servidor volta na mesma");
    }
  }

  private async waitForOffline(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.opts.rest.probe())) return true;
      await this.sleepFn(this.pollIntervalMs);
    }
    return false;
  }

  private async waitForOnline(): Promise<boolean> {
    const deadline = Date.now() + this.opts.serverReturnTimeoutMinutes * 60_000;
    while (Date.now() < deadline) {
      if (await this.opts.rest.probe()) return true;
      await this.sleepFn(this.pollIntervalMs);
    }
    return false;
  }

  private async tryAnnounce(message: string): Promise<void> {
    try {
      await this.opts.rest.announce(message);
    } catch (err) {
      this.opts.logger.warn({ err }, "announce falhou");
    }
  }
}

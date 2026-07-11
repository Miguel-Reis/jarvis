import type { PalworldRestClient } from "../../clients/palworld-rest.js";
import { logAction, type Db } from "../../core/db.js";
import type { Logger } from "../../core/logger.js";
import type { Scheduler } from "../../core/scheduler.js";
import type { ServerState } from "../../core/server-state.js";
import type { BackupService } from "../backup/index.js";

export interface AutosaveOptions {
  db: Db;
  logger: Logger;
  scheduler: Scheduler;
  rest: PalworldRestClient;
  serverState: ServerState;
  backup: BackupService | null;
  intervalMinutes: number;
}

export interface AutosaveStatus {
  lastSaveAt: string | null;
  lastBackupAt: string | null;
}

export class AutosaveModule {
  private lastSaveAt: string | null = null;
  private lastBackupAt: string | null = null;

  constructor(private readonly opts: AutosaveOptions) {}

  get status(): AutosaveStatus {
    return { lastSaveAt: this.lastSaveAt, lastBackupAt: this.lastBackupAt };
  }

  start(): void {
    this.opts.scheduler.scheduleEveryMinutes("autosave", this.opts.intervalMinutes, () => this.tick());
  }

  /** Um ciclo de save+backup. Nunca lança. */
  async tick(): Promise<void> {
    const { logger, serverState } = this.opts;
    if (!serverState.isOnline) {
      logger.debug("autosave saltado — servidor offline");
      return;
    }
    const saved = await this.save();
    if (saved && this.opts.backup) {
      const result = await this.opts.backup.run("scheduled");
      if (result) this.lastBackupAt = new Date().toISOString();
    }
  }

  async save(): Promise<boolean> {
    const { rest, db, logger } = this.opts;
    try {
      await rest.save();
      this.lastSaveAt = new Date().toISOString();
      logAction(db, "system", "save", { source: "autosave" });
      logger.info("world save pedido ao servidor");
      return true;
    } catch (err) {
      logger.warn({ err }, "autosave falhou — nova tentativa no próximo ciclo");
      return false;
    }
  }
}

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { logAction, type Db } from "../../core/db.js";
import type { AppEvents } from "../../core/events.js";
import type { Logger } from "../../core/logger.js";

const execFileAsync = promisify(execFile);

export type BackupTrigger = "scheduled" | "manual" | "pre-restart" | "pre-event";

export interface BackupResult {
  id: number;
  filePath: string;
  sizeBytes: number;
  valid: boolean;
}

export interface BackupServiceOptions {
  db: Db;
  logger: Logger;
  /** Pasta Pal/Saved do servidor (contém SaveGames/) */
  savedPath: string;
  /** Pasta de destino dos tar.gz */
  backupPath: string;
  /** Quantos backups válidos manter */
  keep: number;
  events?: AppEvents;
}

/** Procura Level.sav dentro de SaveGames/ (fica em SaveGames/0/<world-guid>/Level.sav). */
export function findLevelSav(saveGamesPath: string): string | null {
  if (!existsSync(saveGamesPath)) return null;
  const entries = readdirSync(saveGamesPath, { recursive: true, encoding: "utf8" });
  for (const entry of entries) {
    if (entry === "Level.sav" || entry.endsWith("/Level.sav") || entry.endsWith("\\Level.sav")) {
      return join(saveGamesPath, entry);
    }
  }
  return null;
}

export class BackupService {
  constructor(private readonly opts: BackupServiceOptions) {}

  /**
   * Cria um tar.gz de SaveGames/, valida a integridade (Level.sav presente
   * e com tamanho > 0 na origem E dentro do arquivo), regista em SQLite
   * e aplica a rotação. Nunca lança — devolve null em caso de falha.
   */
  async run(trigger: BackupTrigger): Promise<BackupResult | null> {
    const { db, logger, savedPath, backupPath } = this.opts;
    try {
      const saveGames = join(savedPath, "SaveGames");
      if (!existsSync(saveGames)) {
        logger.error({ saveGames }, "pasta SaveGames não encontrada — backup abortado");
        return null;
      }

      const levelSav = findLevelSav(saveGames);
      const sourceOk = levelSav !== null && statSync(levelSav).size > 0;
      if (!sourceOk) {
        logger.error({ saveGames }, "Level.sav em falta ou vazio na origem — backup marcado inválido");
      }

      mkdirSync(backupPath, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.T]/g, "-").replace(/Z$/, "");
      const filePath = join(backupPath, `palworld-${stamp}.tar.gz`);

      await execFileAsync("tar", ["-czf", filePath, "-C", savedPath, "SaveGames"], {
        maxBuffer: 16 * 1024 * 1024,
      });

      const archiveOk = sourceOk && (await this.archiveContainsLevelSav(filePath));
      const sizeBytes = statSync(filePath).size;
      const valid = archiveOk && sizeBytes > 0;

      const inserted = db
        .prepare(
          "INSERT INTO backups (file_path, size_bytes, created_at, valid, trigger) VALUES (?, ?, ?, ?, ?)",
        )
        .run(filePath, sizeBytes, new Date().toISOString(), valid ? 1 : 0, trigger);
      logAction(db, "system", "backup", { filePath, sizeBytes, valid, trigger });

      if (valid) {
        logger.info({ filePath, sizeBytes, trigger }, "backup criado e validado");
      } else {
        logger.error({ filePath, trigger }, "backup criado mas INVÁLIDO");
      }

      this.rotate();
      this.opts.events?.emit("backupFinished", { filePath, sizeBytes, valid, trigger });
      return { id: Number(inserted.lastInsertRowid), filePath, sizeBytes, valid };
    } catch (err) {
      logger.error({ err, trigger }, "falha ao criar backup");
      return null;
    }
  }

  private async archiveContainsLevelSav(filePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("tar", ["-tzf", filePath], {
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout.split("\n").some((line) => line.trim().endsWith("Level.sav"));
    } catch {
      return false;
    }
  }

  /**
   * Mantém os `keep` backups válidos mais recentes; apaga os válidos mais
   * antigos e todos os inválidos (não contam para a quota).
   */
  rotate(): void {
    const { db, logger, keep } = this.opts;
    const rows = db
      .prepare(
        "SELECT id, file_path AS filePath, valid FROM backups WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC",
      )
      .all() as { id: number; filePath: string; valid: number }[];

    let validKept = 0;
    const markDeleted = db.prepare("UPDATE backups SET deleted_at = ? WHERE id = ?");
    for (const row of rows) {
      if (row.valid === 1 && validKept < keep) {
        validKept += 1;
        continue;
      }
      try {
        if (existsSync(row.filePath)) unlinkSync(row.filePath);
        markDeleted.run(new Date().toISOString(), row.id);
        logger.debug({ filePath: row.filePath }, "backup removido pela rotação");
      } catch (err) {
        logger.warn({ err, filePath: row.filePath }, "falha a remover backup na rotação");
      }
    }
  }
}

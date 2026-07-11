import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDatabase, type Db } from "../src/core/db.js";
import { BackupService, findLevelSav } from "../src/modules/backup/index.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

let root: string;
let savedPath: string;
let backupPath: string;
let db: Db;

function makeService(keep = 48): BackupService {
  return new BackupService({ db, logger: silentLogger, savedPath, backupPath, keep });
}

function writeSave(levelSavContent = "dados-do-mundo"): void {
  const world = join(savedPath, "SaveGames", "0", "ABCDEF0123456789");
  mkdirSync(world, { recursive: true });
  writeFileSync(join(world, "Level.sav"), levelSavContent);
  writeFileSync(join(world, "LevelMeta.sav"), "meta");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "palkeeper-backup-"));
  savedPath = join(root, "Saved");
  backupPath = join(root, "backups");
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("findLevelSav", () => {
  test("encontra Level.sav dentro da árvore SaveGames", () => {
    writeSave();
    expect(findLevelSav(join(savedPath, "SaveGames"))).toMatch(/Level\.sav$/);
  });

  test("devolve null quando não existe", () => {
    mkdirSync(join(savedPath, "SaveGames"), { recursive: true });
    expect(findLevelSav(join(savedPath, "SaveGames"))).toBeNull();
  });
});

describe("BackupService.run", () => {
  test("cria tar.gz válido quando Level.sav existe com conteúdo", async () => {
    writeSave();
    const result = await makeService().run("scheduled");
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(existsSync(result!.filePath)).toBe(true);
    expect(result!.sizeBytes).toBeGreaterThan(0);
    const row = db.prepare("SELECT valid, trigger FROM backups WHERE id = ?").get(result!.id) as {
      valid: number;
      trigger: string;
    };
    expect(row.valid).toBe(1);
    expect(row.trigger).toBe("scheduled");
  });

  test("marca inválido quando Level.sav está vazio", async () => {
    writeSave("");
    const result = await makeService().run("manual");
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });

  test("marca inválido quando Level.sav não existe", async () => {
    mkdirSync(join(savedPath, "SaveGames", "0"), { recursive: true });
    const result = await makeService().run("manual");
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });

  test("devolve null (sem lançar) quando SaveGames não existe", async () => {
    const result = await makeService().run("scheduled");
    expect(result).toBeNull();
  });
});

describe("rotação de backups", () => {
  test("mantém apenas os N válidos mais recentes e apaga os ficheiros antigos", async () => {
    writeSave();
    const service = makeService(3);
    const results = [];
    for (let i = 0; i < 5; i++) {
      // created_at distinto para uma ordenação estável
      const r = await service.run("scheduled");
      db.prepare("UPDATE backups SET created_at = ? WHERE id = ?").run(`2026-07-0${i + 1}T00:00:00Z`, r!.id);
      service.rotate();
      results.push(r!);
    }
    const kept = db.prepare("SELECT id FROM backups WHERE deleted_at IS NULL ORDER BY id").all() as {
      id: number;
    }[];
    expect(kept.map((r) => r.id)).toEqual([results[2]!.id, results[3]!.id, results[4]!.id]);
    expect(existsSync(results[0]!.filePath)).toBe(false);
    expect(existsSync(results[1]!.filePath)).toBe(false);
    expect(existsSync(results[4]!.filePath)).toBe(true);
  });

  test("backups inválidos não contam para a quota e são removidos", async () => {
    const service = makeService(2);
    writeSave(""); // inválido
    const bad = await service.run("scheduled");
    writeSave("mundo"); // válidos a partir daqui
    const good1 = await service.run("scheduled");
    const good2 = await service.run("scheduled");
    service.rotate();
    const rows = db
      .prepare("SELECT id, deleted_at FROM backups ORDER BY id")
      .all() as { id: number; deleted_at: string | null }[];
    expect(rows.find((r) => r.id === bad!.id)!.deleted_at).not.toBeNull();
    expect(rows.find((r) => r.id === good1!.id)!.deleted_at).toBeNull();
    expect(rows.find((r) => r.id === good2!.id)!.deleted_at).toBeNull();
    expect(existsSync(bad!.filePath)).toBe(false);
  });
});

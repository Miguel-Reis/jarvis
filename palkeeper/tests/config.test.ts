import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ConfigError, deepMerge, loadConfig } from "../src/config/index.js";

const BASE_ENV = {
  PALWORLD_ADMIN_PASSWORD: "segredo",
  PALKEEPER_API_TOKEN: "token123",
} as NodeJS.ProcessEnv;

function writeYaml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "palkeeper-config-"));
  const path = join(dir, "config.yaml");
  writeFileSync(path, content);
  return path;
}

describe("loadConfig", () => {
  test("aplica defaults quando o ficheiro não existe", () => {
    const config = loadConfig("/nao/existe/config.yaml", BASE_ENV);
    expect(config.autosave.intervalMinutes).toBe(15);
    expect(config.backup.keep).toBe(48);
    expect(config.timezone).toBe("Europe/Lisbon");
    expect(config.palworld.restUrl).toBe("http://127.0.0.1:8212");
  });

  test("valores do YAML sobrepõem-se aos defaults sem apagar o resto", () => {
    const path = writeYaml("autosave:\n  intervalMinutes: 30\n");
    const config = loadConfig(path, BASE_ENV);
    expect(config.autosave.intervalMinutes).toBe(30);
    expect(config.autosave.enabled).toBe(true); // default preservado
    expect(config.backup.keep).toBe(48);
  });

  test("secrets vêm das variáveis de ambiente", () => {
    const config = loadConfig("/nao/existe.yaml", BASE_ENV);
    expect(config.palworld.adminPassword).toBe("segredo");
    expect(config.api.token).toBe("token123");
  });

  test("falha com mensagem clara sem PALWORLD_ADMIN_PASSWORD", () => {
    expect(() => loadConfig("/nao/existe.yaml", { PALKEEPER_API_TOKEN: "t" } as NodeJS.ProcessEnv)).toThrow(
      /PALWORLD_ADMIN_PASSWORD/,
    );
  });

  test("valida pelican quando ativado", () => {
    const path = writeYaml("pelican:\n  enabled: true\n  url: https://painel.example.com\n");
    expect(() => loadConfig(path, BASE_ENV)).toThrow(ConfigError);
    expect(() => loadConfig(path, BASE_ENV)).toThrow(/pelican\.serverId/);
  });

  test("rejeita valores sem sentido", () => {
    const path = writeYaml("autosave:\n  intervalMinutes: 0\nbackup:\n  keep: 0\n");
    expect(() => loadConfig(path, BASE_ENV)).toThrow(/intervalMinutes/);
  });

  test("ordena countdownMinutes por ordem decrescente", () => {
    const path = writeYaml("restart:\n  enabled: true\n  countdownMinutes: [1, 10, 5]\n");
    const config = loadConfig(path, BASE_ENV);
    expect(config.restart.countdownMinutes).toEqual([10, 5, 1]);
  });
});

describe("deepMerge", () => {
  test("funde objetos aninhados e substitui arrays", () => {
    const base = { a: { b: 1, c: 2 }, list: [1, 2, 3] };
    const merged = deepMerge(base, { a: { b: 9 }, list: [7] });
    expect(merged).toEqual({ a: { b: 9, c: 2 }, list: [7] });
  });

  test("ignora null/undefined no override", () => {
    const merged = deepMerge({ a: 1, b: 2 }, { a: null, b: undefined });
    expect(merged).toEqual({ a: 1, b: 2 });
  });
});

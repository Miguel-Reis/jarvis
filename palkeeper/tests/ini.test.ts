import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  IniError,
  applySettings,
  formatValue,
  getSetting,
  updateIniFile,
} from "../src/modules/events/ini.js";

const INI = `[/Script/Pal.PalGameWorldSettings]
OptionSettings=(Difficulty=None,DayTimeSpeedRate=1.000000,ExpRate=1.000000,PalCaptureRate=1.000000,ServerName="O meu servidor, sim",ServerDescription="",AdminPassword="secreta",RESTAPIEnabled=True,RESTAPIPort=8212,bIsUseBackupSaveData=True)
`;

describe("getSetting", () => {
  test("lê valores simples e com aspas", () => {
    expect(getSetting(INI, "ExpRate")).toBe("1.000000");
    expect(getSetting(INI, "Difficulty")).toBe("None");
    expect(getSetting(INI, "ServerName")).toBe('"O meu servidor, sim"');
    expect(getSetting(INI, "NaoExiste")).toBeNull();
  });
});

describe("applySettings", () => {
  test("altera apenas as chaves pedidas, byte a byte", () => {
    const { content, original } = applySettings(INI, { ExpRate: "2.000000", PalCaptureRate: 3 });
    expect(original).toEqual({ ExpRate: "1.000000", PalCaptureRate: "1.000000" });
    expect(getSetting(content, "ExpRate")).toBe("2.000000");
    expect(getSetting(content, "PalCaptureRate")).toBe("3.000000"); // casas decimais preservadas
    // tudo o resto exatamente igual
    const expected = INI.replace("ExpRate=1.000000", "ExpRate=2.000000").replace(
      "PalCaptureRate=1.000000",
      "PalCaptureRate=3.000000",
    );
    expect(content).toBe(expected);
  });

  test("valores com vírgulas dentro de aspas não confundem o parser", () => {
    const { content } = applySettings(INI, { ServerName: '"Novo nome, também com vírgula"' });
    expect(getSetting(content, "ServerName")).toBe('"Novo nome, também com vírgula"');
    expect(getSetting(content, "ServerDescription")).toBe('""');
    expect(getSetting(content, "AdminPassword")).toBe('"secreta"');
  });

  test("booleanos viram True/False", () => {
    const { content } = applySettings(INI, { bIsUseBackupSaveData: false });
    expect(getSetting(content, "bIsUseBackupSaveData")).toBe("False");
  });

  test("chave inexistente é adicionada e a reversão remove-a", () => {
    const applied = applySettings(INI, { EnemyDropItemRate: "2.000000" });
    expect(applied.original).toEqual({ EnemyDropItemRate: null });
    expect(getSetting(applied.content, "EnemyDropItemRate")).toBe("2.000000");
    // reverter: null remove
    const reverted = applySettings(applied.content, { EnemyDropItemRate: null });
    expect(reverted.content).toBe(INI); // byte-igual ao original
  });

  test("ida e volta restaura o ficheiro byte a byte", () => {
    const applied = applySettings(INI, {
      ExpRate: "3.000000",
      PalCaptureRate: "2.500000",
      EnemyDropItemRate: "2.000000", // nova
    });
    const reverted = applySettings(applied.content, applied.original);
    expect(reverted.content).toBe(INI);
  });

  test("preserva CRLF", () => {
    const crlf = INI.replaceAll("\n", "\r\n");
    const { content } = applySettings(crlf, { ExpRate: "2.000000" });
    expect(content.includes("\r\n")).toBe(true);
    expect(content).toBe(crlf.replace("ExpRate=1.000000", "ExpRate=2.000000"));
  });

  test("ficheiro sem OptionSettings lança IniError", () => {
    expect(() => applySettings("[Secao]\noutra=coisa\n", { ExpRate: 1 })).toThrow(IniError);
  });
});

describe("formatValue", () => {
  test("números seguem as casas decimais do original", () => {
    expect(formatValue(2, "1.000000")).toBe("2.000000");
    expect(formatValue(2.5, "1.000000")).toBe("2.500000");
    expect(formatValue(8212, "8211")).toBe("8212");
    expect(formatValue(2, null)).toBe("2");
  });
});

describe("updateIniFile", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("faz backup antes de escrever e devolve os originais", () => {
    dir = mkdtempSync(join(tmpdir(), "palkeeper-ini-"));
    const path = join(dir, "PalWorldSettings.ini");
    writeFileSync(path, INI);
    const result = updateIniFile(path, { ExpRate: "2.000000" });
    expect(existsSync(result.backupPath)).toBe(true);
    expect(readFileSync(result.backupPath, "utf8")).toBe(INI);
    expect(getSetting(readFileSync(path, "utf8"), "ExpRate")).toBe("2.000000");
    expect(result.original.ExpRate).toBe("1.000000");
  });
});

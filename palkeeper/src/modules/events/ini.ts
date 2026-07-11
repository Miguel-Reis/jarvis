import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Parser/writer do PalWorldSettings.ini.
 *
 * O ficheiro tem uma única linha relevante:
 *   OptionSettings=(Difficulty=None,DayTimeSpeedRate=1.000000,ServerName="Nome, com vírgulas",...)
 *
 * Regras: alterar APENAS as chaves pedidas e preservar tudo o resto byte a
 * byte (espaçamento, ordem, line endings, chaves desconhecidas). Valores
 * entre aspas podem conter vírgulas — o scanner respeita aspas.
 */

export class IniError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IniError";
  }
}

interface OptionEntry {
  key: string;
  /** offsets absolutos no conteúdo do ficheiro */
  entryStart: number; // início da chave
  valueStart: number;
  valueEnd: number; // exclusivo
}

interface OptionBlock {
  open: number; // índice do "("
  close: number; // índice do ")"
  entries: OptionEntry[];
}

const MARKER = "OptionSettings=(";

export function findOptionBlock(content: string): OptionBlock {
  const markerIndex = content.indexOf(MARKER);
  if (markerIndex === -1) throw new IniError("linha OptionSettings=(...) não encontrada");
  const open = markerIndex + MARKER.length - 1;

  const entries: OptionEntry[] = [];
  let inQuotes = false;
  let depth = 1;
  let entryStart = open + 1;
  let equalsAt = -1;
  let close = -1;

  for (let i = open + 1; i < content.length; i++) {
    const ch = content[i]!;
    if (inQuotes) {
      if (ch === '"' && content[i - 1] !== "\\") inQuotes = false;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === "(") {
      depth++;
    } else if (ch === "=" && depth === 1 && equalsAt === -1) {
      equalsAt = i;
    } else if ((ch === "," && depth === 1) || (ch === ")" && depth === 1)) {
      if (equalsAt !== -1) {
        entries.push({
          key: content.slice(entryStart, equalsAt).trim(),
          entryStart,
          valueStart: equalsAt + 1,
          valueEnd: i,
        });
      }
      if (ch === ")") {
        close = i;
        break;
      }
      entryStart = i + 1;
      equalsAt = -1;
    } else if (ch === ")") {
      depth--;
    } else if (ch === "\n" || ch === "\r") {
      throw new IniError("OptionSettings=(...) termina sem fechar o parêntese");
    }
  }
  if (close === -1) throw new IniError("OptionSettings=(...) termina sem fechar o parêntese");
  return { open, close, entries };
}

/** Lê o valor atual (raw) de uma chave, ou null se não existir. */
export function getSetting(content: string, key: string): string | null {
  const block = findOptionBlock(content);
  const entry = block.entries.find((e) => e.key === key);
  return entry ? content.slice(entry.valueStart, entry.valueEnd) : null;
}

/**
 * Formata um valor novo respeitando o estilo do valor original:
 * números mantêm as casas decimais (1.000000 → 2.000000), booleanos viram
 * True/False, strings passadas pelo utilizador vão verbatim (incluir aspas
 * se a chave for textual).
 */
export function formatValue(value: string | number | boolean, originalRaw: string | null): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    const decimals = originalRaw && /^-?\d+\.(\d+)$/.exec(originalRaw.trim());
    return decimals ? value.toFixed(decimals[1]!.length) : String(value);
  }
  return value;
}

export interface ApplyResult {
  content: string;
  /** valores raw ANTES da alteração; null = a chave não existia (foi adicionada) */
  original: Record<string, string | null>;
}

/**
 * Aplica alterações às chaves pedidas. `null` remove a chave (usado na
 * reversão de chaves que foram adicionadas). Tudo o resto fica intacto.
 */
export function applySettings(
  content: string,
  changes: Record<string, string | number | boolean | null>,
): ApplyResult {
  const block = findOptionBlock(content);
  const byKey = new Map(block.entries.map((e) => [e.key, e]));
  const original: Record<string, string | null> = {};
  const replacements: { start: number; end: number; text: string }[] = [];
  const additions: string[] = [];

  for (const [key, value] of Object.entries(changes)) {
    const entry = byKey.get(key);
    if (entry) {
      const originalRaw = content.slice(entry.valueStart, entry.valueEnd);
      original[key] = originalRaw;
      if (value === null) {
        // remover a entrada inteira, incluindo a vírgula separadora
        const removeStart =
          content[entry.entryStart - 1] === "," ? entry.entryStart - 1 : entry.entryStart;
        const removeEnd = content[entry.entryStart - 1] === "," ? entry.valueEnd : entry.valueEnd + 1;
        replacements.push({ start: removeStart, end: Math.min(removeEnd, block.close), text: "" });
      } else {
        replacements.push({
          start: entry.valueStart,
          end: entry.valueEnd,
          text: formatValue(value, originalRaw),
        });
      }
    } else {
      original[key] = null;
      if (value !== null) additions.push(`${key}=${formatValue(value, null)}`);
    }
  }

  if (additions.length > 0) {
    const prefix = block.close > block.open + 1 ? "," : "";
    replacements.push({ start: block.close, end: block.close, text: prefix + additions.join(",") });
  }

  replacements.sort((a, b) => b.start - a.start);
  let result = content;
  for (const r of replacements) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  return { content: result, original };
}

export interface IniFileResult extends ApplyResult {
  backupPath: string;
}

/**
 * Altera o ficheiro no disco: valida, faz backup (.palkeeper-<ts>.bak ao
 * lado do original) e escreve. Devolve os valores originais para reversão.
 */
export function updateIniFile(
  iniPath: string,
  changes: Record<string, string | number | boolean | null>,
): IniFileResult {
  if (!existsSync(iniPath)) throw new IniError(`ficheiro não encontrado: ${iniPath}`);
  const content = readFileSync(iniPath, "utf8");
  const result = applySettings(content, changes); // valida antes de tocar no disco
  const backupPath = `${iniPath}.palkeeper-${Date.now()}.bak`;
  copyFileSync(iniPath, backupPath);
  writeFileSync(iniPath, result.content);
  return { ...result, backupPath };
}

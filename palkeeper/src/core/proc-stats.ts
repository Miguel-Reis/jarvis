import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * RAM (RSS) total, em bytes, dos processos cujo nome/cmdline contém `processName`,
 * lida do /proc do host (montado read-only no container, ex.: /host/proc).
 * Devolve null se o /proc não estiver acessível ou o processo não existir.
 * O PalServer corre sob Proton: somamos todos os processos que correspondem
 * (wine/PalServer.exe aparece no cmdline).
 */
export function readProcessRssBytes(procPath: string, processName: string): number | null {
  if (!procPath || !existsSync(procPath)) return null;
  let total = 0;
  let found = false;
  let entries: string[];
  try {
    entries = readdirSync(procPath);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const base = join(procPath, entry);
      const cmdline = readFileSync(join(base, "cmdline"), "utf8").replaceAll("\0", " ");
      const comm = readFileSync(join(base, "comm"), "utf8").trim();
      if (!cmdline.includes(processName) && !comm.includes(processName)) continue;
      const status = readFileSync(join(base, "status"), "utf8");
      const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
      if (match) {
        total += Number(match[1]) * 1024;
        found = true;
      }
    } catch {
      // processo desapareceu a meio do scan — ignorar
    }
  }
  return found ? total : null;
}

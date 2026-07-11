import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level = "info"): Logger {
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

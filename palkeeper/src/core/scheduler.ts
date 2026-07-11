import cron, { type ScheduledTask } from "node-cron";
import type { Logger } from "./logger.js";

/**
 * Wrapper fino sobre node-cron: aplica a timezone configurada,
 * apanha exceções dos handlers (o daemon nunca cai por causa de um job)
 * e permite parar tudo no shutdown.
 */
export interface ScheduledJob {
  stop(): void;
}

export class Scheduler {
  private tasks: ScheduledTask[] = [];

  constructor(
    private readonly timezone: string,
    private readonly logger: Logger,
  ) {}

  static validate(expression: string): boolean {
    return cron.validate(expression);
  }

  schedule(name: string, expression: string, handler: () => Promise<void> | void): ScheduledJob {
    if (!cron.validate(expression)) {
      throw new Error(`Expressão cron inválida para "${name}": ${expression}`);
    }
    const task = cron.schedule(
      expression,
      async () => {
        try {
          await handler();
        } catch (err) {
          this.logger.error({ job: name, err }, "erro num job agendado");
        }
      },
      { timezone: this.timezone },
    );
    this.tasks.push(task);
    this.logger.info({ job: name, cron: expression, timezone: this.timezone }, "job agendado");
    return {
      stop: () => {
        task.stop();
        this.tasks = this.tasks.filter((t) => t !== task);
      },
    };
  }

  /** Intervalo em minutos expresso como cron (ex.: 15 → em 0,15,30,45). */
  scheduleEveryMinutes(name: string, minutes: number, handler: () => Promise<void> | void): ScheduledJob {
    return this.schedule(name, `*/${Math.max(1, Math.floor(minutes))} * * * *`, handler);
  }

  stopAll(): void {
    for (const task of this.tasks) task.stop();
    this.tasks = [];
  }
}

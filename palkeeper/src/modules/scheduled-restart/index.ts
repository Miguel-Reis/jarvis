import type { RestartOrchestrator } from "../../core/restart-orchestrator.js";
import type { Logger } from "../../core/logger.js";
import type { Scheduler } from "../../core/scheduler.js";

export interface ScheduledRestartOptions {
  logger: Logger;
  scheduler: Scheduler;
  orchestrator: RestartOrchestrator;
  cron: string;
  countdownMinutes: number[];
}

/**
 * Restart diário/periódico. O cron dispara o INÍCIO da contagem decrescente:
 * com cron "0 6 * * *" e countdown [10,5,2,1], os avisos começam às 06:00
 * e o shutdown acontece às 06:10.
 */
export class ScheduledRestartModule {
  constructor(private readonly opts: ScheduledRestartOptions) {}

  start(): void {
    this.opts.scheduler.schedule("scheduled-restart", this.opts.cron, async () => {
      await this.opts.orchestrator.execute("restart agendado", this.opts.countdownMinutes);
    });
  }
}

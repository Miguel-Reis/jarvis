import type { PalworldRestClient } from "../../clients/palworld-rest.js";
import { logAction, type Db } from "../../core/db.js";
import type { AppEvents } from "../../core/events.js";
import type { Logger } from "../../core/logger.js";
import type { RestartOrchestrator } from "../../core/restart-orchestrator.js";
import { Scheduler, type ScheduledJob } from "../../core/scheduler.js";
import type { ServerState } from "../../core/server-state.js";
import { sleep } from "../../utils/async.js";
import { updateIniFile } from "./ini.js";
import {
  EventStore,
  type BroadcastPayload,
  type EventRun,
  type GameEvent,
  type NewEvent,
  type SettingsPayload,
} from "./store.js";

export interface EventPlannerOptions {
  db: Db;
  logger: Logger;
  events: AppEvents;
  scheduler: Scheduler;
  rest: PalworldRestClient;
  orchestrator: RestartOrchestrator;
  serverState: ServerState;
  /** Caminho do PalWorldSettings.ini */
  iniPath: string;
  defaultCountdownMinutes: number[];
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Valida um evento vindo da API. Devolve a lista de problemas (vazia = ok). */
export function validateEvent(event: NewEvent): string[] {
  const errors: string[] = [];
  if (!event.name?.trim()) errors.push("name em falta");
  if (event.type !== "broadcast" && event.type !== "settings-event") {
    errors.push("type tem de ser 'broadcast' ou 'settings-event'");
  }
  const hasCron = !!event.cronExpression;
  const hasStart = !!event.startAt;
  if (hasCron === hasStart) errors.push("define exatamente um de cronExpression (recorrente) ou startAt (único)");
  if (hasCron && !Scheduler.validate(event.cronExpression!)) {
    errors.push(`cronExpression inválida: ${event.cronExpression}`);
  }
  if (hasStart && Number.isNaN(Date.parse(event.startAt!))) {
    errors.push(`startAt inválido (usa ISO 8601): ${event.startAt}`);
  }
  if (event.type === "settings-event") {
    const payload = event.payload as SettingsPayload | undefined;
    if (!payload?.settings || Object.keys(payload.settings).length === 0) {
      errors.push("payload.settings em falta ou vazio");
    }
    if (!event.durationMinutes || event.durationMinutes < 1) {
      errors.push("durationMinutes tem de ser >= 1 num settings-event");
    }
  }
  if (event.type === "broadcast") {
    const payload = event.payload as BroadcastPayload | undefined;
    if (!payload?.messages?.length || payload.messages.some((m) => !m.text?.trim())) {
      errors.push("payload.messages em falta, vazio ou com mensagens sem texto");
    }
  }
  return errors;
}

/**
 * Event planner: eventos broadcast e settings-event agendados (cron ou
 * one-shot). Um settings-event altera o PalWorldSettings.ini (backup +
 * byte-preserving), reinicia com avisos e reverte automaticamente no fim —
 * a reversão fica persistida em event_runs e sobrevive a crashes do daemon.
 */
export class EventPlannerModule {
  readonly store: EventStore;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private cronJobs = new Map<number, ScheduledJob>();
  private tickJob: ScheduledJob | null = null;

  constructor(private readonly opts: EventPlannerOptions) {
    this.store = new EventStore(opts.db);
    this.sleepFn = opts.sleepFn ?? sleep;
    this.now = opts.now ?? (() => new Date());
  }

  start(): void {
    this.refreshSchedules();
    // tick por minuto: one-shots vencidos + reversões pendentes (inclui as
    // que ficaram por fazer se o daemon crashou a meio de um evento)
    this.tickJob = this.opts.scheduler.scheduleEveryMinutes("events-tick", 1, () => this.tick());
    void this.tick();
  }

  stop(): void {
    for (const job of this.cronJobs.values()) job.stop();
    this.cronJobs.clear();
    this.tickJob?.stop();
  }

  /** (Re)regista os cron jobs dos eventos recorrentes ativos. Chamado após CRUD. */
  refreshSchedules(): void {
    for (const job of this.cronJobs.values()) job.stop();
    this.cronJobs.clear();
    for (const event of this.store.list()) {
      if (!event.enabled || !event.cronExpression || event.status === "cancelled") continue;
      const job = this.opts.scheduler.schedule(`event:${event.id}:${event.name}`, event.cronExpression, async () => {
        await this.trigger(event.id);
      });
      this.cronJobs.set(event.id, job);
    }
  }

  async tick(): Promise<void> {
    const now = this.now();
    for (const event of this.store.dueOneShots(now)) {
      await this.trigger(event.id);
    }
    for (const run of this.store.dueReverts(now)) {
      await this.revertRun(run);
    }
  }

  /** Dispara um evento agora. Nunca lança. */
  async trigger(eventId: number): Promise<boolean> {
    const event = this.store.get(eventId);
    if (!event || !event.enabled) return false;
    try {
      if (event.type === "broadcast") return await this.runBroadcast(event);
      return await this.runSettingsEvent(event);
    } catch (err) {
      this.opts.logger.error({ err, eventId, name: event.name }, "evento falhou");
      return false;
    }
  }

  private async runBroadcast(event: GameEvent): Promise<boolean> {
    const { logger, rest, serverState } = this.opts;
    if (!serverState.isOnline) {
      logger.warn({ name: event.name }, "broadcast saltado — servidor offline");
      return false;
    }
    const payload = event.payload as BroadcastPayload;
    const run = this.store.createRun(event.id, null, null);
    this.store.setStatus(event.id, "active");
    this.opts.events.emit("eventStarted", { eventId: event.id, name: event.name, type: event.type });
    logAction(this.opts.db, `event:${event.id}`, "event_broadcast_started", { name: event.name });
    for (const message of payload.messages) {
      try {
        await rest.announce(message.text);
      } catch (err) {
        logger.warn({ err, name: event.name }, "announce do evento falhou");
      }
      if (message.delaySeconds) await this.sleepFn(message.delaySeconds * 1000);
    }
    this.store.finishRun(run.id, "finished");
    this.store.setStatus(event.id, event.cronExpression ? "scheduled" : "finished");
    this.opts.events.emit("eventFinished", { eventId: event.id, name: event.name, type: event.type });
    return true;
  }

  private async runSettingsEvent(event: GameEvent): Promise<boolean> {
    const { logger, orchestrator } = this.opts;
    const payload = event.payload as SettingsPayload;
    if (this.store.hasRunningRun(event.id)) {
      logger.warn({ name: event.name }, "settings-event já ativo — disparo ignorado");
      return false;
    }
    if (orchestrator.inProgress) {
      // one-shot fica 'scheduled' e o próximo tick volta a tentar; cron perde este disparo
      logger.warn({ name: event.name }, "restart em curso — settings-event adiado");
      return false;
    }

    // 1) alterar o INI (com backup); os valores originais ficam no run para reverter
    const result = updateIniFile(this.opts.iniPath, payload.settings);
    const revertAt = new Date(this.now().getTime() + (event.durationMinutes ?? 60) * 60_000);
    const run = this.store.createRun(event.id, revertAt, result.original);
    this.store.setStatus(event.id, "active");
    logAction(this.opts.db, `event:${event.id}`, "event_settings_applied", {
      name: event.name,
      settings: payload.settings,
      revertAt: revertAt.toISOString(),
      iniBackup: result.backupPath,
    });
    this.opts.events.emit("eventStarted", { eventId: event.id, name: event.name, type: event.type });
    logger.info({ name: event.name, revertAt: revertAt.toISOString() }, "settings-event aplicado — a reiniciar");

    // 2) restart para as settings entrarem em vigor
    const countdown = payload.countdownMinutes ?? this.opts.defaultCountdownMinutes;
    const ok = await orchestrator.execute(`evento "${event.name}"`, countdown);

    // 3) anunciar o início (se o servidor voltou)
    if (ok && payload.startMessage) {
      await this.opts.rest.announce(payload.startMessage).catch(() => {});
    }
    if (!ok) {
      logger.error({ name: event.name, runId: run.id }, "restart do evento não confirmou — a reversão agendada mantém-se");
    }
    return ok;
  }

  /** Reverte um settings-event: repõe o INI (backup incluído) e reinicia. */
  async revertRun(run: EventRun): Promise<void> {
    const { logger, orchestrator } = this.opts;
    const event = this.store.get(run.eventId);
    const name = event?.name ?? `#${run.eventId}`;
    if (orchestrator.inProgress) {
      logger.warn({ name }, "restart em curso — reversão adiada para o próximo tick");
      return;
    }
    try {
      if (run.originalSettings && Object.keys(run.originalSettings).length > 0) {
        const result = updateIniFile(this.opts.iniPath, run.originalSettings);
        logAction(this.opts.db, `event:${run.eventId}`, "event_settings_reverted", {
          name,
          iniBackup: result.backupPath,
        });
      }
    } catch (err) {
      logger.error({ err, name, runId: run.id }, "reversão do INI falhou — run marcado como failed");
      this.store.finishRun(run.id, "failed");
      if (event) this.store.setStatus(event.id, event.cronExpression ? "scheduled" : "finished");
      return;
    }
    this.store.finishRun(run.id, "reverted");
    if (event) this.store.setStatus(event.id, event.cronExpression ? "scheduled" : "finished");
    logger.info({ name }, "settings-event revertido — a reiniciar para aplicar");

    const payload = (event?.payload ?? {}) as SettingsPayload;
    const countdown = payload.countdownMinutes ?? this.opts.defaultCountdownMinutes;
    const ok = await orchestrator.execute(`fim do evento "${name}"`, countdown);
    if (ok && payload.endMessage) {
      await this.opts.rest.announce(payload.endMessage).catch(() => {});
    }
    this.opts.events.emit("eventFinished", {
      eventId: run.eventId,
      name,
      type: event?.type ?? "settings-event",
    });
  }
}

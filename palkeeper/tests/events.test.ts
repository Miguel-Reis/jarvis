import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDatabase, type Db } from "../src/core/db.js";
import { AppEvents } from "../src/core/events.js";
import { Scheduler } from "../src/core/scheduler.js";
import { ServerState } from "../src/core/server-state.js";
import { EventPlannerModule, validateEvent } from "../src/modules/events/index.js";
import { getSetting } from "../src/modules/events/ini.js";
import type { NewEvent } from "../src/modules/events/store.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const INI = `[/Script/Pal.PalGameWorldSettings]
OptionSettings=(Difficulty=None,ExpRate=1.000000,PalCaptureRate=1.000000,ServerName="Servidor")
`;

let db: Db;
let dir: string;
let iniPath: string;
let clock: Date;
let bus: AppEvents;
let serverState: ServerState;
let announces: string[];
let restartCalls: { reason: string; countdown: number[] }[];
let restartResult: boolean;

function makePlanner(): EventPlannerModule {
  const orchestrator = {
    inProgress: false,
    execute: async (reason: string, countdown: number[]) => {
      restartCalls.push({ reason, countdown });
      return restartResult;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const rest = {
    announce: async (message: string) => {
      announces.push(message);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return new EventPlannerModule({
    db,
    logger: silentLogger,
    events: bus,
    scheduler: new Scheduler("UTC", silentLogger),
    rest,
    orchestrator,
    serverState,
    iniPath,
    defaultCountdownMinutes: [5, 2, 1],
    sleepFn: async () => {},
    now: () => clock,
  });
}

beforeEach(() => {
  db = openDatabase(":memory:");
  dir = mkdtempSync(join(tmpdir(), "palkeeper-events-"));
  iniPath = join(dir, "PalWorldSettings.ini");
  writeFileSync(iniPath, INI);
  clock = new Date("2026-07-11T12:00:00.000Z");
  bus = new AppEvents();
  serverState = new ServerState();
  serverState.markOnline();
  announces = [];
  restartCalls = [];
  restartResult = true;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("validateEvent", () => {
  test("broadcast válido passa", () => {
    const event: NewEvent = {
      name: "Quiz",
      type: "broadcast",
      cronExpression: "0 21 * * 6",
      payload: { messages: [{ text: "olá" }] },
    };
    expect(validateEvent(event)).toEqual([]);
  });

  test("rejeita cron E startAt em simultâneo, cron inválido e payloads vazios", () => {
    expect(
      validateEvent({
        name: "x",
        type: "broadcast",
        cronExpression: "0 21 * * 6",
        startAt: "2026-08-01T20:00:00Z",
        payload: { messages: [{ text: "a" }] },
      }),
    ).toHaveLength(1);
    expect(
      validateEvent({ name: "x", type: "broadcast", cronExpression: "99 99 * * *", payload: { messages: [{ text: "a" }] } }),
    ).toHaveLength(1);
    expect(
      validateEvent({ name: "x", type: "settings-event", startAt: "2026-08-01T20:00:00Z", payload: { settings: {} } }),
    ).toHaveLength(2); // settings vazio + sem durationMinutes
  });
});

describe("broadcast", () => {
  test("envia as mensagens em sequência e termina o run", async () => {
    const planner = makePlanner();
    const event = planner.store.create({
      name: "Quiz",
      type: "broadcast",
      startAt: clock.toISOString(),
      payload: { messages: [{ text: "Pergunta 1", delaySeconds: 1 }, { text: "Pergunta 2" }] },
    });
    await planner.trigger(event.id);
    expect(announces).toEqual(["Pergunta 1", "Pergunta 2"]);
    expect(planner.store.get(event.id)!.status).toBe("finished"); // one-shot
    expect(planner.store.listRuns(event.id)[0]!.status).toBe("finished");
  });

  test("evento recorrente volta a scheduled", async () => {
    const planner = makePlanner();
    const event = planner.store.create({
      name: "MOTD especial",
      type: "broadcast",
      cronExpression: "0 20 * * *",
      payload: { messages: [{ text: "olá" }] },
    });
    await planner.trigger(event.id);
    expect(planner.store.get(event.id)!.status).toBe("scheduled");
  });

  test("tick dispara one-shots vencidos e ignora futuros", async () => {
    const planner = makePlanner();
    const due = planner.store.create({
      name: "vencido",
      type: "broadcast",
      startAt: "2026-07-11T11:59:00.000Z",
      payload: { messages: [{ text: "agora" }] },
    });
    const future = planner.store.create({
      name: "futuro",
      type: "broadcast",
      startAt: "2026-07-11T13:00:00.000Z",
      payload: { messages: [{ text: "depois" }] },
    });
    await planner.tick();
    expect(announces).toEqual(["agora"]);
    expect(planner.store.get(due.id)!.status).toBe("finished");
    expect(planner.store.get(future.id)!.status).toBe("scheduled");
  });
});

describe("settings-event", () => {
  test("aplica o INI, reinicia, e o tick reverte no fim (byte-igual)", async () => {
    const planner = makePlanner();
    const event = planner.store.create({
      name: "XP x2",
      type: "settings-event",
      startAt: clock.toISOString(),
      durationMinutes: 60,
      payload: {
        settings: { ExpRate: "2.000000", EnemyDropItemRate: "2.000000" },
        startMessage: "XP x2 ativo!",
        endMessage: "XP x2 terminou.",
      },
    });
    const started: string[] = [];
    const finished: string[] = [];
    bus.on("eventStarted", (e) => started.push(e.name));
    bus.on("eventFinished", (e) => finished.push(e.name));

    await planner.trigger(event.id);
    const changed = readFileSync(iniPath, "utf8");
    expect(getSetting(changed, "ExpRate")).toBe("2.000000");
    expect(getSetting(changed, "EnemyDropItemRate")).toBe("2.000000"); // chave adicionada
    expect(restartCalls).toHaveLength(1);
    expect(restartCalls[0]!.reason).toContain("XP x2");
    expect(announces).toContain("XP x2 ativo!");
    expect(planner.store.get(event.id)!.status).toBe("active");
    const run = planner.store.listRuns(event.id)[0]!;
    expect(run.status).toBe("running");
    expect(run.originalSettings).toEqual({ ExpRate: "1.000000", EnemyDropItemRate: null });
    expect(started).toEqual(["XP x2"]);

    // ainda não é hora de reverter
    clock = new Date("2026-07-11T12:30:00.000Z");
    await planner.tick();
    expect(planner.store.listRuns(event.id)[0]!.status).toBe("running");

    // passa a hora → reverte
    clock = new Date("2026-07-11T13:01:00.000Z");
    await planner.tick();
    expect(readFileSync(iniPath, "utf8")).toBe(INI); // byte-igual ao original
    expect(planner.store.listRuns(event.id)[0]!.status).toBe("reverted");
    expect(planner.store.get(event.id)!.status).toBe("finished");
    expect(restartCalls).toHaveLength(2);
    expect(announces).toContain("XP x2 terminou.");
    expect(finished).toEqual(["XP x2"]);
  });

  test("reversão pendente sobrevive a um novo arranque do daemon", async () => {
    const planner = makePlanner();
    const event = planner.store.create({
      name: "Captura x3",
      type: "settings-event",
      startAt: clock.toISOString(),
      durationMinutes: 30,
      payload: { settings: { PalCaptureRate: "3.000000" } },
    });
    await planner.trigger(event.id);
    expect(getSetting(readFileSync(iniPath, "utf8"), "PalCaptureRate")).toBe("3.000000");

    // "crash" do daemon: nova instância, hora de reverter já passou
    clock = new Date("2026-07-11T14:00:00.000Z");
    const restarted = makePlanner();
    await restarted.tick();
    expect(readFileSync(iniPath, "utf8")).toBe(INI);
    expect(restarted.store.listRuns(event.id)[0]!.status).toBe("reverted");
  });

  test("não dispara em duplicado enquanto um run está ativo", async () => {
    const planner = makePlanner();
    const event = planner.store.create({
      name: "XP x2",
      type: "settings-event",
      startAt: clock.toISOString(),
      durationMinutes: 60,
      payload: { settings: { ExpRate: "2.000000" } },
    });
    expect(await planner.trigger(event.id)).toBe(true);
    expect(await planner.trigger(event.id)).toBe(false);
    expect(planner.store.listRuns(event.id)).toHaveLength(1);
    expect(restartCalls).toHaveLength(1);
  });

  test("countdown do payload sobrepõe-se ao default", async () => {
    const planner = makePlanner();
    const event = planner.store.create({
      name: "Rápido",
      type: "settings-event",
      startAt: clock.toISOString(),
      durationMinutes: 10,
      payload: { settings: { ExpRate: "2.000000" }, countdownMinutes: [1] },
    });
    await planner.trigger(event.id);
    expect(restartCalls[0]!.countdown).toEqual([1]);
  });
});

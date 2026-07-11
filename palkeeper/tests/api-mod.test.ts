import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApi, type ApiDeps } from "../src/api/index.js";
import { openDatabase, type Db } from "../src/core/db.js";
import { AppEvents } from "../src/core/events.js";
import { ServerState } from "../src/core/server-state.js";
import { SessionsModule } from "../src/modules/sessions/index.js";
import { WelcomeModule } from "../src/modules/welcome/index.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

let db: Db;
let server: Server;
let base: string;
let bus: AppEvents;
let welcome: WelcomeModule;
let announces: string[];
let kicks: string[];
let saves: number;

beforeEach(async () => {
  db = openDatabase(":memory:");
  bus = new AppEvents();
  announces = [];
  kicks = [];
  saves = 0;

  const sessions = new SessionsModule({ db, logger: silentLogger, events: bus });
  sessions.start();
  const rest = {
    circuitState: "closed",
    announce: async (m: string) => void announces.push(m),
    kick: async (id: string) => void kicks.push(id),
    save: async () => void saves++,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  welcome = new WelcomeModule({
    events: bus,
    rest,
    logger: silentLogger,
    messages: { restartWarning: "", restartNow: "", restartDone: "" },
    delaySeconds: 0,
    viaMod: true,
  });
  welcome.start();

  const serverState = new ServerState();
  serverState.markOnline();
  const deps: ApiDeps = {
    config: { port: 0, host: "127.0.0.1", token: "tok" },
    logger: silentLogger,
    serverState,
    rest,
    autosave: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orchestrator: { inProgress: false, lastResult: null, execute: async () => true } as any,
    restartCron: null,
    poller: null,
    moderation: null,
    leaderboard: null,
    watchdog: null,
    metrics: null,
    planner: null,
    db,
    sessions,
    welcome,
    discord: null,
    discordChatRelay: false,
    restartCountdownMinutes: [10, 5, 2, 1],
  };
  await new Promise<void>((resolve) => {
    server = createApi(deps).listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

const AUTH = { Authorization: "Bearer tok" };

function player(playerId: string, name: string) {
  return { playerId, name, userId: `steam_${playerId}` };
}

describe("API do mod", () => {
  test("exige token", async () => {
    const response = await fetch(`${base}/mod/leaderboard`);
    expect(response.status).toBe(401);
  });

  test("/mod/playtime devolve os dados do jogador", async () => {
    bus.emit("playerJoined", player("AA11", "Alice"), { firstVisit: true });
    const response = await fetch(`${base}/mod/playtime/AA11`, { headers: AUTH });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; steamId: string };
    expect(body.name).toBe("Alice");
    expect(body.steamId).toBe("steam_AA11");

    const missing = await fetch(`${base}/mod/playtime/NOPE`, { headers: AUTH });
    expect(missing.status).toBe(404);
  });

  test("/mod/pending-welcomes drena a fila (viaMod)", async () => {
    bus.emit("playerJoined", player("AA11", "Alice"), { firstVisit: true });
    const first = await fetch(`${base}/mod/pending-welcomes`, { headers: AUTH });
    const body = (await first.json()) as { welcomes: { name: string; firstVisit: boolean }[] };
    expect(body.welcomes).toEqual([{ playerUid: "AA11", name: "Alice", firstVisit: true }]);
    // e não foi feito announce global
    expect(announces).toEqual([]);

    const second = await fetch(`${base}/mod/pending-welcomes`, { headers: AUTH });
    expect(((await second.json()) as { welcomes: unknown[] }).welcomes).toEqual([]);
  });

  test("/mod/chat regista no action_log", async () => {
    const response = await fetch(`${base}/mod/chat`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "Alice", playerUid: "AA11", steamId: "steam_AA11", message: "olá!" }),
    });
    expect(response.status).toBe(200);
    const row = db.prepare("SELECT details FROM action_log WHERE action = 'chat'").get() as {
      details: string;
    };
    expect(JSON.parse(row.details).message).toBe("olá!");
  });

  test("/actions/announce, /actions/save e /actions/kick chamam o servidor", async () => {
    const headers = { ...AUTH, "Content-Type": "application/json" };
    await fetch(`${base}/actions/announce`, { method: "POST", headers, body: JSON.stringify({ message: "oi" }) });
    await fetch(`${base}/actions/save`, { method: "POST", headers, body: "{}" });
    await fetch(`${base}/actions/kick`, { method: "POST", headers, body: JSON.stringify({ steamId: "steam_X" }) });
    expect(announces).toEqual(["oi"]);
    expect(saves).toBe(1);
    expect(kicks).toEqual(["steam_X"]);
  });

  test("/actions/restart aceita e usa o countdown default", async () => {
    const response = await fetch(`${base}/actions/restart`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { countdown: number[] };
    expect(body.countdown).toEqual([10, 5, 2, 1]);
  });
});

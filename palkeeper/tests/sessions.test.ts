import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PalworldPlayer } from "../src/clients/palworld-rest.js";
import { openDatabase, type Db } from "../src/core/db.js";
import { AppEvents } from "../src/core/events.js";
import { SessionsModule } from "../src/modules/sessions/index.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function player(playerId: string, name = playerId): PalworldPlayer {
  return { playerId, name, userId: `steam_${playerId}` };
}

let db: Db;
let events: AppEvents;
let clock: Date;
let sessions: SessionsModule;

beforeEach(() => {
  db = openDatabase(":memory:");
  events = new AppEvents();
  clock = new Date("2026-07-11T10:00:00.000Z");
  sessions = new SessionsModule({ db, logger: silentLogger, events, now: () => clock });
  sessions.start();
});

afterEach(() => db.close());

function advanceMinutes(minutes: number): void {
  clock = new Date(clock.getTime() + minutes * 60_000);
}

describe("SessionsModule", () => {
  test("join cria jogador e sessão aberta; leave fecha e acumula playtime", () => {
    events.emit("playerJoined", player("a", "Alice"), { firstVisit: true });
    advanceMinutes(30);
    events.emit("playerLeft", player("a", "Alice"));

    const row = db
      .prepare("SELECT last_name, total_playtime_seconds FROM players WHERE player_uid = 'a'")
      .get() as { last_name: string; total_playtime_seconds: number };
    expect(row.last_name).toBe("Alice");
    expect(row.total_playtime_seconds).toBe(30 * 60);

    const session = db.prepare("SELECT left_at, duration_seconds FROM sessions").get() as {
      left_at: string | null;
      duration_seconds: number;
    };
    expect(session.left_at).not.toBeNull();
    expect(session.duration_seconds).toBe(30 * 60);
  });

  test("múltiplas sessões acumulam", () => {
    events.emit("playerJoined", player("a"), { firstVisit: true });
    advanceMinutes(10);
    events.emit("playerLeft", player("a"));
    advanceMinutes(60);
    events.emit("playerJoined", player("a"), { firstVisit: false });
    advanceMinutes(20);
    events.emit("playerLeft", player("a"));

    const row = db.prepare("SELECT total_playtime_seconds FROM players WHERE player_uid = 'a'").get() as {
      total_playtime_seconds: number;
    };
    expect(row.total_playtime_seconds).toBe(30 * 60);
  });

  test("join duplicado não abre segunda sessão", () => {
    events.emit("playerJoined", player("a"), { firstVisit: true });
    events.emit("playerJoined", player("a"), { firstVisit: false });
    const count = db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    expect(count.c).toBe(1);
  });

  test("isKnownPlayer distingue primeira visita", () => {
    expect(sessions.isKnownPlayer("a")).toBe(false);
    events.emit("playerJoined", player("a"), { firstVisit: true });
    expect(sessions.isKnownPlayer("a")).toBe(true);
  });

  test("sessões órfãs são fechadas no arranque com a hora do último poll", () => {
    events.emit("playerJoined", player("a"), { firstVisit: true });
    advanceMinutes(15);
    sessions.touch(); // último sinal de vida do daemon
    advanceMinutes(120); // daemon esteve morto 2h

    // novo arranque
    const restarted = new SessionsModule({ db, logger: silentLogger, events: new AppEvents(), now: () => clock });
    restarted.start();

    const row = db.prepare("SELECT total_playtime_seconds FROM players WHERE player_uid = 'a'").get() as {
      total_playtime_seconds: number;
    };
    // conta só até ao último poll (15 min), não as 2h de daemon morto
    expect(row.total_playtime_seconds).toBe(15 * 60);
    const open = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE left_at IS NULL").get() as { c: number };
    expect(open.c).toBe(0);
  });

  test("topPlaytime agrega e corta ao intervalo", () => {
    events.emit("playerJoined", player("a", "Alice"), { firstVisit: true });
    events.emit("playerJoined", player("b", "Bob"), { firstVisit: true });
    advanceMinutes(60);
    events.emit("playerLeft", player("b"));
    advanceMinutes(60);
    events.emit("playerLeft", player("a"));

    const from = new Date("2026-07-11T09:00:00.000Z");
    const to = new Date("2026-07-11T13:00:00.000Z");
    const top = sessions.topPlaytime(from, to, 5);
    expect(top).toHaveLength(2);
    expect(top[0]!.name).toBe("Alice");
    expect(top[0]!.playtimeSeconds).toBe(120 * 60);
    expect(top[1]!.name).toBe("Bob");
    expect(top[1]!.playtimeSeconds).toBe(60 * 60);
  });

  test("dayStats conta jogadores únicos e playtime", () => {
    events.emit("playerJoined", player("a"), { firstVisit: true });
    advanceMinutes(30);
    events.emit("playerLeft", player("a"));
    const stats = sessions.dayStats(new Date("2026-07-11T00:00:00Z"), new Date("2026-07-12T00:00:00Z"));
    expect(stats.uniquePlayers).toBe(1);
    expect(stats.totalPlaytimeSeconds).toBe(30 * 60);
  });
});

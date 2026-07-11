import { describe, expect, test } from "vitest";
import type { PalworldPlayer } from "../src/clients/palworld-rest.js";
import { diffPlayers, isValidPlayer } from "../src/core/player-poller.js";

function player(playerId: string, name = playerId): PalworldPlayer {
  return { playerId, name, userId: `steam_${playerId}` };
}

function snapshot(...players: PalworldPlayer[]): Map<string, PalworldPlayer> {
  return new Map(players.map((p) => [p.playerId, p]));
}

describe("diffPlayers", () => {
  test("deteta joins", () => {
    const { joined, left } = diffPlayers(snapshot(player("a")), [player("a"), player("b")]);
    expect(joined.map((p) => p.playerId)).toEqual(["b"]);
    expect(left).toEqual([]);
  });

  test("deteta leaves", () => {
    const { joined, left } = diffPlayers(snapshot(player("a"), player("b")), [player("a")]);
    expect(joined).toEqual([]);
    expect(left.map((p) => p.playerId)).toEqual(["b"]);
  });

  test("sem alterações → diffs vazios", () => {
    const { joined, left } = diffPlayers(snapshot(player("a")), [player("a")]);
    expect(joined).toEqual([]);
    expect(left).toEqual([]);
  });

  test("join e leave simultâneos", () => {
    const { joined, left } = diffPlayers(snapshot(player("a")), [player("b")]);
    expect(joined.map((p) => p.playerId)).toEqual(["b"]);
    expect(left.map((p) => p.playerId)).toEqual(["a"]);
  });

  test("servidor vazio → todos saem", () => {
    const { joined, left } = diffPlayers(snapshot(player("a"), player("b")), []);
    expect(joined).toEqual([]);
    expect(left).toHaveLength(2);
  });

  test("ignora jogadores com playerId inválido (ainda a carregar)", () => {
    const loading = { playerId: "None", name: "A carregar", userId: "" };
    const zeros = { playerId: "00000000000000000000000000000000", name: "Zero", userId: "" };
    const { joined, left } = diffPlayers(snapshot(), [loading, zeros, player("c")]);
    expect(joined.map((p) => p.playerId)).toEqual(["c"]);
    expect(left).toEqual([]);
  });
});

describe("isValidPlayer", () => {
  test("aceita ids normais e rejeita vazios/None/zeros", () => {
    expect(isValidPlayer(player("abc123"))).toBe(true);
    expect(isValidPlayer({ playerId: "", name: "x", userId: "" })).toBe(false);
    expect(isValidPlayer({ playerId: "none", name: "x", userId: "" })).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import { formatDuration } from "../src/modules/leaderboard/index.js";

describe("formatDuration", () => {
  test("formata horas e minutos", () => {
    expect(formatDuration(0)).toBe("0min");
    expect(formatDuration(59)).toBe("0min");
    expect(formatDuration(60)).toBe("1min");
    expect(formatDuration(3600)).toBe("1h00");
    expect(formatDuration(5400)).toBe("1h30");
    expect(formatDuration(36 * 3600 + 5 * 60)).toBe("36h05");
  });
});

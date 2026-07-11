import { describe, expect, test } from "vitest";
import { WatchdogEvaluator } from "../src/modules/watchdog/evaluator.js";

const MIN = 60_000;

function makeEvaluator() {
  return new WatchdogEvaluator({
    memoryLimitMB: 1000,
    fpsThreshold: 20,
    sustainedMinutes: 5,
    cooldownMinutes: 30,
  });
}

const GB = 1024 * 1024 * 1024;

describe("WatchdogEvaluator", () => {
  test("valores saudáveis → ok", () => {
    const ev = makeEvaluator();
    expect(ev.evaluate({ ramBytes: 0.5 * GB, fps: 60, timestamp: 0 }).kind).toBe("ok");
  });

  test("RAM acima do limite sustentada dispara restart", () => {
    const ev = makeEvaluator();
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 0 }).kind).toBe("breaching");
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 3 * MIN }).kind).toBe("breaching");
    const decision = ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 5 * MIN });
    expect(decision.kind).toBe("restart");
    expect(decision.kind === "restart" && decision.reason).toMatch(/RAM/);
  });

  test("pico curto de RAM não dispara (a condição limpa-se)", () => {
    const ev = makeEvaluator();
    ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 0 });
    expect(ev.evaluate({ ramBytes: 0.5 * GB, fps: 60, timestamp: 2 * MIN }).kind).toBe("ok");
    // nova violação recomeça a contagem do zero
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 4 * MIN }).kind).toBe("breaching");
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 8 * MIN }).kind).toBe("breaching");
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 9 * MIN }).kind).toBe("restart");
  });

  test("FPS baixo sustentado dispara restart", () => {
    const ev = makeEvaluator();
    ev.evaluate({ ramBytes: 0.5 * GB, fps: 10, timestamp: 0 });
    const decision = ev.evaluate({ ramBytes: 0.5 * GB, fps: 12, timestamp: 6 * MIN });
    expect(decision.kind).toBe("restart");
    expect(decision.kind === "restart" && decision.reason).toMatch(/FPS/);
  });

  test("cooldown bloqueia um segundo restart imediato", () => {
    const ev = makeEvaluator();
    ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 0 });
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 5 * MIN }).kind).toBe("restart");
    // continua acima do limite, mas dentro do cooldown → ok (sem loop de restarts)
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 10 * MIN }).kind).toBe("ok");
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 34 * MIN }).kind).toBe("ok");
    // cooldown passou (35 > 5+30): recomeça a acumular breach
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 36 * MIN }).kind).toBe("breaching");
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 41 * MIN }).kind).toBe("restart");
  });

  test("noteRestart (restart externo) também ativa o cooldown", () => {
    const ev = makeEvaluator();
    ev.noteRestart(0);
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 10 * MIN }).kind).toBe("ok");
    expect(ev.evaluate({ ramBytes: 2 * GB, fps: 60, timestamp: 31 * MIN }).kind).toBe("breaching");
  });

  test("métricas indisponíveis (null) não disparam", () => {
    const ev = makeEvaluator();
    expect(ev.evaluate({ ramBytes: null, fps: null, timestamp: 0 }).kind).toBe("ok");
    expect(ev.evaluate({ ramBytes: null, fps: null, timestamp: 10 * MIN }).kind).toBe("ok");
  });
});

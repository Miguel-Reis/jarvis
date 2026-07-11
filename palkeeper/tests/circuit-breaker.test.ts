import { describe, expect, test } from "vitest";
import { CircuitBreaker } from "../src/clients/circuit-breaker.js";

function makeBreaker(overrides: Partial<ConstructorParameters<typeof CircuitBreaker>[0]> = {}) {
  let now = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 1000,
    now: () => now,
    ...overrides,
  });
  return { breaker, advance: (ms: number) => (now += ms) };
}

describe("CircuitBreaker", () => {
  test("mantém-se fechado abaixo do threshold e reseta com sucesso", () => {
    const { breaker } = makeBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
  });

  test("abre após N falhas consecutivas e bloqueia pedidos", () => {
    const { breaker } = makeBreaker();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    expect(breaker.state).toBe("open");
    expect(breaker.canRequest()).toBe(false);
  });

  test("após o cooldown permite UM probe (half-open)", () => {
    const { breaker, advance } = makeBreaker();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(999);
    expect(breaker.canRequest()).toBe(false);
    advance(1);
    expect(breaker.canRequest()).toBe(true); // half-open
    expect(breaker.state).toBe("half-open");
    expect(breaker.canRequest()).toBe(false); // só um probe de cada vez
  });

  test("sucesso em half-open fecha o circuito", () => {
    const { breaker, advance } = makeBreaker();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    breaker.canRequest();
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
    expect(breaker.canRequest()).toBe(true);
  });

  test("falha em half-open reabre e reinicia o cooldown", () => {
    const { breaker, advance } = makeBreaker();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    breaker.canRequest();
    breaker.recordFailure();
    expect(breaker.state).toBe("open");
    advance(999);
    expect(breaker.canRequest()).toBe(false);
    advance(1);
    expect(breaker.canRequest()).toBe(true);
  });

  test("dispara onOpen/onClose nas transições", () => {
    let opened = 0;
    let closed = 0;
    const { breaker, advance } = makeBreaker({ onOpen: () => opened++, onClose: () => closed++ });
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    expect(opened).toBe(1);
    advance(1000);
    breaker.canRequest();
    breaker.recordSuccess();
    expect(closed).toBe(1);
  });
});

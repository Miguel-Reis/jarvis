import { afterEach, describe, expect, test, vi } from "vitest";
import {
  PalworldApiError,
  PalworldRestClient,
  ServerUnavailableError,
} from "../src/clients/palworld-rest.js";
import { ServerState } from "../src/core/server-state.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeClient(overrides: { maxRetries?: number; failureThreshold?: number } = {}) {
  const serverState = new ServerState();
  const client = new PalworldRestClient({
    baseUrl: "http://palworld.test:8212",
    adminPassword: "pw",
    timeoutMs: 500,
    maxRetries: overrides.maxRetries ?? 2,
    failureThreshold: overrides.failureThreshold ?? 3,
    cooldownMs: 60_000,
    logger: silentLogger,
    serverState,
    retryBaseMs: 1, // testes rápidos
  });
  return { client, serverState };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PalworldRestClient", () => {
  test("faz retry exponencial em falhas de rede e recupera", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse({ version: "v1.0", servername: "s", description: "" }));
    vi.stubGlobal("fetch", fetchMock);

    const { client, serverState } = makeClient();
    const info = await client.info();
    expect(info.version).toBe("v1.0");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(serverState.status).toBe("online");
  });

  test("abre o circuito após falhas consecutivas e marca offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { client, serverState } = makeClient({ maxRetries: 5, failureThreshold: 3 });

    await expect(client.info()).rejects.toBeInstanceOf(ServerUnavailableError);
    expect(client.circuitState).toBe("open");
    expect(serverState.status).toBe("offline");
  });

  test("com o circuito aberto rejeita imediatamente sem tocar na rede", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    const { client } = makeClient({ maxRetries: 5, failureThreshold: 3 });

    await expect(client.info()).rejects.toBeInstanceOf(ServerUnavailableError);
    const callsAfterOpen = fetchMock.mock.calls.length;
    await expect(client.save()).rejects.toBeInstanceOf(ServerUnavailableError);
    expect(fetchMock.mock.calls.length).toBe(callsAfterOpen); // nenhum pedido extra
  });

  test("erro HTTP 401 não abre o circuito (o servidor está vivo)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
    const { client, serverState } = makeClient();

    await expect(client.info()).rejects.toBeInstanceOf(PalworldApiError);
    expect(client.circuitState).toBe("closed");
    expect(serverState.status).toBe("online");
  });

  test("4xx não beneficia de retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Bad Request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { client } = makeClient({ maxRetries: 3 });

    await expect(client.save()).rejects.toBeInstanceOf(PalworldApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("aceita respostas em texto simples (POST /save devolve 'OK')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("OK", { status: 200 })));
    const { client } = makeClient();
    await expect(client.save()).resolves.toBeUndefined();
  });

  test("probe devolve false offline e true quando o servidor volta", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(jsonResponse({ version: "v1.0", servername: "s", description: "" }));
    vi.stubGlobal("fetch", fetchMock);
    const { client, serverState } = makeClient();

    expect(await client.probe()).toBe(false);
    expect(await client.probe()).toBe(true);
    expect(serverState.status).toBe("online");
  });

  test("players devolve lista vazia quando não há jogadores", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ players: [] })));
    const { client } = makeClient();
    expect(await client.players()).toEqual([]);
  });
});

import { afterEach, describe, expect, test, vi } from "vitest";
import { DiscordWebhookClient } from "../src/clients/discord-webhook.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeClient() {
  return new DiscordWebhookClient({
    webhookUrl: "https://discord.test/webhook",
    logger: silentLogger,
    sleepFn: async () => {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("DiscordWebhookClient", () => {
  test("envia o payload com o username", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await makeClient().send({ content: "olá" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({ username: "PalKeeper", content: "olá" });
  });

  test("faz retry em 429 respeitando retry_after", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await makeClient().send({ content: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("nunca lança: erro de rede é engolido e registado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    await expect(makeClient().send({ content: "x" })).resolves.toBeUndefined();
  });

  test("fila serializada: as mensagens saem por ordem", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        bodies.push((JSON.parse(init.body as string) as { content: string }).content);
        return new Response(null, { status: 204 });
      }),
    );
    const client = makeClient();
    void client.send({ content: "1" });
    void client.send({ content: "2" });
    await client.send({ content: "3" });
    expect(bodies).toEqual(["1", "2", "3"]);
  });
});

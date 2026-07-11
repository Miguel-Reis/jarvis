// Mock do servidor Palworld (REST API oficial) + Pelican Panel, para
// desenvolvimento e verificação end-to-end do PalKeeper sem um servidor real.
//
//   node tests/mock-server.mjs [porta] [password]
//
// Simula: /v1/api/info|players|metrics|settings|announce|save|shutdown|stop
// e o endpoint de power do Pelican (/api/client/servers/:id/power).
// Quando "offline", as ligações são destruídas para imitar um processo morto.
// GET /__state (sem auth) expõe o estado interno para asserções.

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 18212);
const password = process.argv[3] ?? "pw";
const basicAuth = "Basic " + Buffer.from(`admin:${password}`).toString("base64");

const state = {
  online: true,
  saves: 0,
  announces: [],
  powerSignals: [],
  shutdowns: 0,
  stops: 0,
  startedAt: Date.now(),
  players: [],
  kicks: [],
  fps: 60,
  discord: [],
};

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = req.url ?? "";

    if (url === "/__state") return json(res, state);
    if (url === "/__set-online") {
      state.online = true;
      return json(res, { ok: true });
    }
    // Controlo do cenário de teste: jogadores, fps
    if (url.startsWith("/__join")) {
      const params = new URL(url, "http://x").searchParams;
      const id = params.get("id") ?? "p1";
      state.players.push({
        name: params.get("name") ?? id,
        accountName: params.get("name") ?? id,
        playerId: id,
        userId: `steam_${id}`,
        ip: "127.0.0.1",
        ping: 20,
        level: 1,
      });
      console.log(`[mock] jogador ${id} entrou`);
      return json(res, { ok: true });
    }
    if (url.startsWith("/__leave")) {
      const params = new URL(url, "http://x").searchParams;
      const id = params.get("id");
      state.players = state.players.filter((p) => p.playerId !== id);
      console.log(`[mock] jogador ${id} saiu`);
      return json(res, { ok: true });
    }
    if (url.startsWith("/__set-fps")) {
      const params = new URL(url, "http://x").searchParams;
      state.fps = Number(params.get("fps") ?? 60);
      console.log(`[mock] fps = ${state.fps}`);
      return json(res, { ok: true });
    }
    // Webhook Discord mock
    if (url === "/discord-webhook") {
      try {
        state.discord.push(JSON.parse(body || "{}"));
      } catch {
        state.discord.push({ raw: body });
      }
      res.writeHead(204);
      return res.end();
    }

    // Pelican Client API (Bearer)
    if (url.startsWith("/api/client/servers/") && url.endsWith("/power")) {
      if (!(req.headers.authorization ?? "").startsWith("Bearer ")) {
        return json(res, { error: "unauthenticated" }, 401);
      }
      const { signal } = JSON.parse(body || "{}");
      state.powerSignals.push(signal);
      if (signal === "start" || signal === "restart") {
        setTimeout(() => {
          state.online = true;
          console.log("[mock] servidor ONLINE (via Pelican)");
        }, 3000);
      }
      if (signal === "stop" || signal === "kill") state.online = false;
      res.writeHead(204);
      return res.end();
    }

    // REST API do Palworld — offline = ligação morta
    if (!state.online) {
      req.socket.destroy();
      return;
    }
    if (req.headers.authorization !== basicAuth) {
      return json(res, { error: "unauthorized" }, 401);
    }

    switch (url) {
      case "/v1/api/info":
        return json(res, { version: "v1.0.0", servername: "Mock Palworld", description: "mock" });
      case "/v1/api/players":
        return json(res, { players: state.players });
      case "/v1/api/kick": {
        const { userid, message } = JSON.parse(body || "{}");
        state.kicks.push({ userid, message });
        state.players = state.players.filter((p) => p.userId !== userid);
        console.log(`[mock] kick ${userid}: ${message}`);
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("OK");
      }
      case "/v1/api/metrics":
        return json(res, {
          serverfps: state.fps,
          currentplayernum: 0,
          serverframetime: 16.6,
          maxplayernum: 32,
          uptime: Math.floor((Date.now() - state.startedAt) / 1000),
        });
      case "/v1/api/settings":
        return json(res, { ServerName: "Mock Palworld", ExpRate: 1 });
      case "/v1/api/announce": {
        const { message } = JSON.parse(body || "{}");
        state.announces.push(message);
        console.log(`[mock] announce: ${message}`);
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("OK");
      }
      case "/v1/api/save":
        state.saves += 1;
        console.log("[mock] world save");
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("OK");
      case "/v1/api/shutdown": {
        const { waittime } = JSON.parse(body || "{}");
        state.shutdowns += 1;
        setTimeout(() => {
          state.online = false;
          console.log("[mock] servidor OFFLINE (shutdown)");
        }, (waittime ?? 1) * 1000);
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("OK");
      }
      case "/v1/api/stop":
        state.stops += 1;
        state.online = false;
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("OK");
      default:
        return json(res, { error: "not found" }, 404);
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[mock] Palworld+Pelican mock em http://127.0.0.1:${port} (password: ${password})`);
});

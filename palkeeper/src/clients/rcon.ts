import { Socket } from "node:net";
import type { Logger } from "../core/logger.js";

const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;

export interface RconOptions {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
  logger: Logger;
}

export class RconError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RconError";
  }
}

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "ascii");
  const packet = Buffer.alloc(14 + bodyBuf.length);
  packet.writeInt32LE(10 + bodyBuf.length, 0); // tamanho sem o próprio campo
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  bodyBuf.copy(packet, 12);
  // dois NUL finais (fim do body + fim do packet)
  return packet;
}

interface RconPacket {
  id: number;
  type: number;
  body: string;
}

function tryDecodePacket(buffer: Buffer): { packet: RconPacket; rest: Buffer } | null {
  if (buffer.length < 4) return null;
  const size = buffer.readInt32LE(0);
  if (size < 10 || buffer.length < 4 + size) return null;
  return {
    packet: {
      id: buffer.readInt32LE(4),
      type: buffer.readInt32LE(8),
      body: buffer.subarray(12, 4 + size - 2).toString("ascii"),
    },
    rest: buffer.subarray(4 + size),
  };
}

/**
 * Cliente Source RCON mínimo, uma ligação por comando.
 * O RCON do Palworld é limitado (sem multi-packet, ASCII apenas), por isso
 * mantemos o protocolo no mínimo e usamos REST como caminho principal.
 */
export class RconClient {
  constructor(private readonly opts: RconOptions) {}

  exec(command: string): Promise<string> {
    const timeoutMs = this.opts.timeoutMs ?? 5000;
    return new Promise<string>((resolve, reject) => {
      const socket = new Socket();
      let buffer: Buffer = Buffer.alloc(0);
      let authenticated = false;
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };
      const succeed = (body: string) => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve(body);
      };

      socket.setTimeout(timeoutMs, () => fail(new RconError("timeout RCON")));
      socket.on("error", (err) => fail(new RconError(`ligação RCON falhou: ${err.message}`)));

      socket.connect(this.opts.port, this.opts.host, () => {
        socket.write(encodePacket(1, SERVERDATA_AUTH, this.opts.password));
      });

      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        let decoded = tryDecodePacket(buffer);
        while (decoded) {
          const { packet, rest } = decoded;
          buffer = rest;
          if (!authenticated) {
            if (packet.type === SERVERDATA_AUTH_RESPONSE) {
              if (packet.id === -1) return fail(new RconError("password RCON incorreta"));
              authenticated = true;
              socket.write(encodePacket(2, SERVERDATA_EXECCOMMAND, command));
            }
          } else {
            return succeed(packet.body.trim());
          }
          decoded = tryDecodePacket(buffer);
        }
      });

      socket.on("close", () => fail(new RconError("ligação RCON fechada sem resposta")));
    });
  }

  /** Broadcast via RCON — fallback quando a REST API não responde. */
  async broadcast(message: string): Promise<void> {
    // O RCON do Palworld não suporta espaços de forma fiável no Broadcast.
    await this.exec(`Broadcast ${message.replace(/\s+/g, "_")}`);
  }
}

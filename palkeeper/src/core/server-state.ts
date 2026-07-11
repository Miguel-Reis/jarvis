import { EventEmitter } from "node:events";

export type ServerStatus = "unknown" | "online" | "offline";

export interface ServerStateEvents {
  online: [];
  offline: [];
}

/**
 * Estado observado do servidor Palworld. Alimentado pelo circuit breaker
 * do cliente REST; os módulos subscrevem para pausar/retomar trabalho.
 */
export class ServerState extends EventEmitter<ServerStateEvents> {
  private _status: ServerStatus = "unknown";
  private _since: Date = new Date();

  get status(): ServerStatus {
    return this._status;
  }

  get since(): Date {
    return this._since;
  }

  get isOnline(): boolean {
    return this._status === "online";
  }

  markOnline(): void {
    if (this._status === "online") return;
    this._status = "online";
    this._since = new Date();
    this.emit("online");
  }

  markOffline(): void {
    if (this._status === "offline") return;
    this._status = "offline";
    this._since = new Date();
    this.emit("offline");
  }
}

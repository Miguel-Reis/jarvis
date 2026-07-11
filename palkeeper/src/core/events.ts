import { EventEmitter } from "node:events";
import type { PalworldPlayer } from "../clients/palworld-rest.js";

export interface BackupFinishedEvent {
  filePath: string;
  sizeBytes: number;
  valid: boolean;
  trigger: string;
}

export interface WatchdogAlertEvent {
  reason: string;
  ramMB: number | null;
  fps: number | null;
}

export interface RestartEvent {
  reason: string;
  ok?: boolean;
}

export interface GameEventLifecycle {
  eventId: number;
  name: string;
  type: string;
}

export interface AppEventMap {
  eventStarted: [event: GameEventLifecycle];
  eventFinished: [event: GameEventLifecycle];
  playerJoined: [player: PalworldPlayer, meta: { firstVisit: boolean }];
  playerLeft: [player: PalworldPlayer];
  backupFinished: [event: BackupFinishedEvent];
  watchdogAlert: [event: WatchdogAlertEvent];
  restartStarted: [event: RestartEvent];
  restartFinished: [event: RestartEvent];
  serverOnline: [];
  serverOffline: [];
}

/**
 * Bus de eventos cross-módulo: quem produz (poller, backup, orchestrator,
 * watchdog) não sabe quem consome (sessões, welcome, moderação, Discord).
 */
export class AppEvents extends EventEmitter<AppEventMap> {}

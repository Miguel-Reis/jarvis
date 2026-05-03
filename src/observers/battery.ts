/**
 * BatteryMonitor — Battery Level Observer
 *
 * Monitors battery level and power state.
 * Emits events on low battery, charging state changes, or critical levels.
 *
 * Supports:
 * - Linux: /sys/class/power_supply/BAT0/*
 * - WSL2: Falls back to no-op (no battery access)
 * - Browser API: When available via client
 */

import type { Observer, ObserverEventHandler } from './index';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const POLL_INTERVAL_MS = 60_000;      // 1 minute
const LOW_BATTERY_THRESHOLD = 20;     // Low battery warning
const CRITICAL_BATTERY_THRESHOLD = 10; // Critical battery warning

type BatteryStatus = {
  level: number;           // 0-100
  charging: boolean;
  timeToFull?: number;     // minutes
  timeToEmpty?: number;    // minutes
  status: 'full' | 'charging' | 'discharging' | 'unknown';
};

export class BatteryMonitor implements Observer {
  name = 'battery-monitor';
  private running = false;
  private handler: ObserverEventHandler | null = null;
  private pollTimer: Timer | null = null;
  private lastStatus: BatteryStatus | null = null;
  private batteryPath = '/sys/class/power_supply/BAT0';
  private hasBattery = false;

  async start(): Promise<void> {
    this.running = true;

    // Check if battery interface exists
    this.hasBattery = existsSync(this.batteryPath);

    if (!this.hasBattery) {
      console.log('[battery-monitor] No battery interface found — monitoring disabled (WSL2 or desktop)');
      return;
    }

    console.log('[battery-monitor] Observer started — polling every 60s');

    // Initial poll
    this.poll();

    // Set up recurring poll
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    console.log('[battery-monitor] Observer stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(handler: ObserverEventHandler): void {
    this.handler = handler;
  }

  getStatus(): BatteryStatus | null {
    return this.lastStatus;
  }

  private async poll(): Promise<void> {
    if (!this.handler || !this.hasBattery) return;

    try {
      const status = await this.readBatteryStatus();

      // Emit event on significant changes
      if (this.shouldEmitEvent(status)) {
        this.handler({
          type: 'battery',
          data: {
            level: status.level,
            charging: status.charging,
            status: status.status,
            timeToEmpty: status.timeToEmpty,
            timeToFull: status.timeToFull,
            alert: this.getAlertLevel(status),
          },
          timestamp: Date.now(),
        });
      }

      this.lastStatus = status;
    } catch (err) {
      console.error('[battery-monitor] Poll error:', err);
    }
  }

  private shouldEmitEvent(status: BatteryStatus): boolean {
    if (!this.lastStatus) return true;

    // Emit on charging state change
    if (status.charging !== this.lastStatus.charging) return true;

    // Emit on low/critical battery
    if (status.level <= CRITICAL_BATTERY_THRESHOLD) return true;
    if (status.level <= LOW_BATTERY_THRESHOLD && this.lastStatus.level > LOW_BATTERY_THRESHOLD) return true;

    // Emit on significant level change (> 10%)
    if (Math.abs(status.level - this.lastStatus.level) >= 10) return true;

    return false;
  }

  private getAlertLevel(status: BatteryStatus): string | null {
    if (status.level <= CRITICAL_BATTERY_THRESHOLD) {
      return 'critical';
    }
    if (status.level <= LOW_BATTERY_THRESHOLD && !status.charging) {
      return 'low';
    }
    if (status.level === 100 && status.charging) {
      return 'full';
    }
    return null;
  }

  private async readBatteryStatus(): Promise<BatteryStatus> {
    const [capacity, status, present] = await Promise.all([
      this.readFile('capacity'),
      this.readFile('status'),
      this.readFile('present'),
    ]);

    const level = parseInt(capacity, 10) || 0;
    const isPresent = present.trim() === '1';
    const charging = status.trim() === 'Charging';
    const full = status.trim() === 'Full';

    let batteryStatus: BatteryStatus['status'] = 'unknown';
    if (full) batteryStatus = 'full';
    else if (charging) batteryStatus = 'charging';
    else if (isPresent && !charging) batteryStatus = 'discharging';

    // Estimate time (simplified)
    let timeToEmpty: number | undefined;
    let timeToFull: number | undefined;

    const energyNow = await this.readFile('energy_now', true);
    const powerNow = await this.readFile('power_now', true);

    if (energyNow && powerNow) {
      const energy = parseFloat(energyNow);
      const power = parseFloat(powerNow);
      if (power > 0) {
        const hours = (energy / power);
        if (charging) {
          timeToFull = Math.round(hours * 60);
        } else {
          timeToEmpty = Math.round(hours * 60);
        }
      }
    }

    return {
      level,
      charging,
      status: batteryStatus,
      timeToEmpty,
      timeToFull,
    };
  }

  private async readFile(filename: string, optional = false): Promise<string> {
    try {
      const content = await readFile(`${this.batteryPath}/${filename}`, 'utf-8');
      return content.trim();
    } catch (err) {
      if (optional) return '';
      throw err;
    }
  }
}

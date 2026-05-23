/**
 * Bootstrap Phase 5 — Event pipeline wiring and heartbeat timer.
 *
 * Wires sidecar events into the event reactor/coalescer, starts health
 * monitoring, and sets up the periodic heartbeat.
 */

import type { CoreServices } from './services.ts';
import type { JarvisConfig } from '../../config/types.ts';
import type { BackgroundAgentService } from '../background-agent-service.ts';
import type { HealthMonitor } from '../health.ts';

export function bootstrapEventPipeline(
  services: CoreServices,
  awarenessService: unknown,
): void {
  const { classifyEvent } = require('../event-classifier.ts');
  const { reactSafe, coalescer, wsService, sidecarManager } = services;
  const awarenessEventTypes = ['screen_capture', 'context_changed', 'idle_detected'];

  sidecarManager.onEvent((sidecarId: string, event: any) => {
    if (awarenessService && awarenessEventTypes.includes(event.event_type)) return;

    const classified = classifyEvent({
      type: `sidecar_${event.event_type}`,
      data: {
        sidecar_id: sidecarId,
        ...(typeof event.payload === 'object' && event.payload !== null
          ? event.payload as Record<string, unknown>
          : { payload: event.payload }),
      },
      timestamp: event.timestamp ?? Date.now(),
    });

    if (classified.priority === 'critical' || classified.priority === 'high') {
      reactSafe(classified);
    } else {
      coalescer.addEvent(classified);
    }

    wsService.broadcastSidecarEvent(sidecarId, {
      type: `sidecar_${event.event_type}`,
      data: classified.event.data,
      timestamp: event.timestamp ?? Date.now(),
    });
  });
}

export function bootstrapHeartbeat(
  jarvisConfig: JarvisConfig,
  services: CoreServices,
  bgAgent: BackgroundAgentService,
  healthMonitor: HealthMonitor,
  healthCheckInterval: number,
): Timer {
  const { checkCommitments } = require('../event-classifier.ts');
  const { reactSafe, coalescer, wsService } = services;
  const heartbeatConfig = jarvisConfig.heartbeat;
  const heartbeatIntervalMs = (heartbeatConfig?.interval_minutes ?? 15) * 60 * 1000;
  const activeHours = heartbeatConfig?.active_hours ?? { start: 8, end: 23 };
  const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;

  console.log(`[Daemon] Heartbeat interval: ${heartbeatConfig?.interval_minutes ?? 15} min, active hours: ${activeHours.start}:00-${activeHours.end}:00`);

  healthMonitor.start(healthCheckInterval);

  let heartbeatBusy = false;
  return setInterval(async () => {
    if (heartbeatBusy) {
      console.log('[Daemon] Skipping heartbeat — previous still running');
      return;
    }
    const currentHour = new Date().getHours();
    if (currentHour < activeHours.start || currentHour >= activeHours.end) {
      console.log(`[Daemon] Outside active hours (${activeHours.start}-${activeHours.end}), skipping heartbeat`);
      return;
    }

    heartbeatBusy = true;
    console.log('[Daemon] Heartbeat starting...');

    const heartbeatPromise = (async () => {
      const commitmentEvents = checkCommitments();
      for (const evt of commitmentEvents) {
        if (evt.priority === 'critical' || evt.priority === 'high') {
          reactSafe(evt);
        } else {
          coalescer.addEvent(evt);
        }
      }
      const coalescedSummary = coalescer.flush();
      return bgAgent.handleHeartbeat(coalescedSummary || undefined);
    })();

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => {
        console.error('[Daemon] Heartbeat timed out after 5 minutes');
        resolve(null);
      }, HEARTBEAT_TIMEOUT_MS),
    );

    heartbeatPromise
      .then((response) => {
        if (response) {
          console.log('[Daemon] Heartbeat response:', response.slice(0, 200));
          wsService.broadcastHeartbeat(response);
        } else {
          console.log('[Daemon] Heartbeat returned no response');
        }
      })
      .catch((err) => console.error('[Daemon] Heartbeat error:', err))
      .finally(() => { heartbeatBusy = false; });

    await Promise.race([heartbeatPromise, timeoutPromise]).catch(() => {});
  }, heartbeatIntervalMs);
}

/**
 * Bootstrap Phase 2 — Core service instantiation and wiring.
 *
 * Creates: EventReactor, EventCoalescer, GoogleAuth, ResearchQueue,
 * AgentService, ObserverService, WebSocketService, ChannelService,
 * CommitmentExecutor, SidecarManager.
 */

import os from 'node:os';
import { AgentService } from '../agent-service.ts';
import { ObserverService } from '../observer-service.ts';
import { WebSocketService } from '../ws-service.ts';
import { ChannelService } from '../channel-service.ts';
import { EventReactor } from '../event-reactor.ts';
import { EventCoalescer } from '../event-coalescer.ts';
import { CommitmentExecutor } from '../commitment-executor.ts';
import { classifyEvent } from '../event-classifier.ts';
import { GoogleAuth } from '../../integrations/google-auth.ts';
import { ResearchQueue } from '../research-queue.ts';
import { setResearchQueueRef } from '../../actions/tools/research.ts';
import { SidecarManager } from '../../sidecar/manager.ts';
import type { ServiceRegistry } from '../services.ts';
import type { DaemonConfig } from '../index.ts';
import type { JarvisConfig } from '../../config/types.ts';

const MAX_REACTOR_INFLIGHT = 8;

export type ClassifiedEvent = ReturnType<typeof classifyEvent>;

export type CoreServices = {
  reactor: EventReactor;
  coalescer: EventCoalescer;
  reactSafe: (event: ClassifiedEvent) => void;
  agentService: AgentService;
  wsService: WebSocketService;
  channelService: ChannelService;
  sidecarManager: SidecarManager;
  observerService: ObserverService | null;
  executor: CommitmentExecutor;
  googleAuth: GoogleAuth | null;
  researchQueue: ResearchQueue;
};

export function bootstrapCoreServices(
  config: DaemonConfig,
  jarvisConfig: JarvisConfig,
  registry: ServiceRegistry,
): CoreServices {
  const reactor = new EventReactor();
  const coalescer = new EventCoalescer();
  let reactorInFlight = 0;

  const reactSafe = (event: ClassifiedEvent) => {
    if (reactorInFlight >= MAX_REACTOR_INFLIGHT) {
      console.warn('[Daemon] Reactor saturated — dropping low-priority event:', event.event.type);
      return;
    }
    reactorInFlight++;
    reactor.react(event)
      .catch(err => console.error('[Daemon] Reactor error:', err))
      .finally(() => { reactorInFlight--; });
  };

  let googleAuth: GoogleAuth | null = null;
  if (jarvisConfig.google?.client_id && jarvisConfig.google?.client_secret) {
    googleAuth = new GoogleAuth(jarvisConfig.google.client_id, jarvisConfig.google.client_secret);
    if (googleAuth.isAuthenticated()) {
      console.log('[Daemon] Google OAuth: authenticated (Gmail + Calendar observers enabled)');
    } else {
      console.log('[Daemon] Google OAuth: credentials found but not authenticated');
      console.log('[Daemon] Run: bun run src/scripts/google-setup.ts to authorize');
    }
  }

  const researchQueue = new ResearchQueue();
  setResearchQueueRef(researchQueue);

  const heartbeatConfig = jarvisConfig.heartbeat;
  const aggressiveness = heartbeatConfig?.aggressiveness ?? 'moderate';

  const agentService = new AgentService(jarvisConfig);
  agentService.setResearchQueue(researchQueue);

  const observerService = config.noLocalTools
    ? null
    : new ObserverService(reactor, coalescer, googleAuth ?? undefined);

  const wsService = new WebSocketService(config.port, agentService);
  const channelService = new ChannelService(jarvisConfig, agentService);
  const executor = new CommitmentExecutor(aggressiveness as any);

  // Wire reactor notification callback
  reactor.setReactionCallback((text, priority) => {
    wsService.broadcastNotification(text, priority);
  });

  // Wire delegation progress to WebSocket
  agentService.setDelegationProgressCallback((event) => {
    wsService.broadcastSubAgentProgress(event);
  });

  // Create and wire sidecar manager
  const sidecarManager = new SidecarManager(
    jarvisConfig.daemon.data_dir.replace('~', os.homedir()),
  );
  const brainDomain = jarvisConfig.daemon.brain_domain ?? `localhost:${config.port}`;
  sidecarManager.setBrainUrl(brainDomain);
  wsService.getServer().setSidecarManager(sidecarManager);

  // Register services in startup order
  registry.register(agentService);
  if (observerService) registry.register(observerService);
  registry.register(channelService);
  registry.register(sidecarManager);
  registry.register(wsService);

  return { reactor, coalescer, reactSafe, agentService, wsService, channelService, sidecarManager, observerService, executor, googleAuth, researchQueue };
}

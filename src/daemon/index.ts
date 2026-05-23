/**
 * J.A.R.V.I.S. Daemon
 *
 * Main entry point for the JARVIS daemon process.
 * Initializes database, registers real services (Agent, Observer, WebSocket),
 * starts health monitoring, and handles graceful shutdown.
 */

import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { closeDb } from "../vault/schema.ts";
import { ServiceRegistry } from "./services.ts";
import { HealthMonitor } from "./health.ts";
import { loadConfig } from "../config/loader.ts";
import { CommitmentExecutor } from "./commitment-executor.ts";
import { createApiRoutes, setCorsOrigin } from "./api-routes.ts";
import { BackgroundAgentService } from "./background-agent-service.ts";
import { bootstrapDatabase } from "./bootstrap/database.ts";
import { bootstrapCoreServices } from "./bootstrap/services.ts";
import { bootstrapAuthority } from "./bootstrap/authority.ts";
import { bootstrapAwareness } from "./bootstrap/awareness.ts";
import { bootstrapEventPipeline, bootstrapHeartbeat } from "./bootstrap/events.ts";

// Constants
const DEFAULT_PORT = 3142;  // JARVIS port
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.jarvis');

export interface DaemonConfig {
  port: number;
  dbPath: string;
  dataDir: string;
  healthCheckInterval?: number;  // ms
  noLocalTools?: boolean;        // disable local tool execution
}

let shutdownInProgress = false;
let registry: ServiceRegistry | null = null;
let healthMonitor: HealthMonitor | null = null;
let heartbeatTimer: Timer | null = null;
let commitmentExecutor: CommitmentExecutor | null = null;
let bgAgent: BackgroundAgentService | null = null;
let awarenessService: import('../awareness/service.ts').AwarenessService | null = null;
let goalService: import('../goals/service.ts').GoalService | null = null;

function parseArgs(): Partial<DaemonConfig> {
  const args = process.argv.slice(2);
  const config: Partial<DaemonConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--port':
        config.port = parseInt(args[++i]!, 10);
        break;
      case '--db-path':
        config.dbPath = args[++i]!;
        break;
      case '--data-dir':
        config.dataDir = args[++i]!;
        break;
      case '--health-interval':
        config.healthCheckInterval = parseInt(args[++i]!, 10);
        break;
      case '--no-local-tools':
        config.noLocalTools = true;
        break;
      case '--help':
      case '-h':
        console.log(`
J.A.R.V.I.S. Daemon

Usage:
  bun run src/daemon/index.ts [options]

Options:
  --port <number>          WebSocket server port (default: ${DEFAULT_PORT})
  --db-path <path>         Database file path (default: ~/.jarvis/jarvis.db)
  --data-dir <path>        Data directory (default: ~/.jarvis)
  --health-interval <ms>   Health check interval in ms (default: 30000)
  --no-local-tools         Disable local tool execution (run_command, read_file, etc).
                           Tools will only work when routed to a sidecar via target param.
  --help, -h               Show this help message

Example:
  bun run src/daemon/index.ts --port 3142 --data-dir ~/.jarvis
        `);
        process.exit(0);
    }
  }

  return config;
}

function ensureDataDir(dataDir: string): void {
  if (!existsSync(dataDir)) {
    console.log(`[Daemon] Creating data directory: ${dataDir}`);
    mkdirSync(dataDir, { recursive: true });
  }
}

function logWithTimestamp(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

async function handleShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) {
    console.log('\n[Daemon] Force shutdown requested, exiting immediately');
    process.exit(1);
  }

  shutdownInProgress = true;
  console.log(`\n[Daemon] Received ${signal}, shutting down gracefully...`);

  try {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (commitmentExecutor) { commitmentExecutor.stop(); commitmentExecutor = null; }
    if (goalService) { await goalService.stop(); goalService = null; }
    if (awarenessService) { await awarenessService.stop(); awarenessService = null; }
    if (bgAgent) { await bgAgent.stop(); bgAgent = null; }
    if (healthMonitor) { healthMonitor.stop(); }
    if (registry) { await registry.stopAll(); }
    closeDb();
    console.log('[Daemon] Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[Daemon] Error during shutdown:', error);
    process.exit(1);
  }
}

function printBanner(config: DaemonConfig): void {
  console.log(`
     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
     ██║███████║██████╔╝██║   ██║██║███████╗
██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
 ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝

Just A Rather Very Intelligent System
  `);
  console.log('[Daemon] Configuration:');
  console.log(`  Port:      ${config.port}`);
  console.log(`  Data Dir:  ${config.dataDir}`);
  console.log(`  DB Path:   ${config.dbPath}`);
  console.log('');
}

/**
 * Start the JARVIS daemon.
 *
 * Orchestrates bootstrap phases:
 *   1. Database init
 *   2. Core services (reactor, WS, channels, sidecar)
 *   3. Authority engine
 *   4. API routes
 *   5. Service startup
 *   6. Optional services (awareness, sites, workflows, goals)
 *   7. Event pipeline + heartbeat
 */
export async function startDaemon(userConfig?: Partial<DaemonConfig>): Promise<void> {
  let jarvisConfig: Awaited<ReturnType<typeof loadConfig>>;
  try {
    jarvisConfig = await loadConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n[Daemon] Failed to parse config file: ${message}`);
    console.error('[Daemon] Fix the YAML syntax in ~/.jarvis/config.yaml or delete it to use defaults.\n');
    process.exit(1);
  }

  const dataDir = userConfig?.dataDir ?? jarvisConfig.daemon.data_dir ?? DEFAULT_DATA_DIR;
  const dbPath = userConfig?.dbPath ?? jarvisConfig.daemon.db_path ?? path.join(dataDir, 'jarvis.db');
  const port = userConfig?.port ?? jarvisConfig.daemon.port ?? DEFAULT_PORT;
  const config: DaemonConfig = {
    port,
    dataDir,
    dbPath: path.isAbsolute(dbPath) ? dbPath : path.join(dataDir, dbPath),
    healthCheckInterval: userConfig?.healthCheckInterval ?? 30000,
    noLocalTools: userConfig?.noLocalTools ?? false,
  };

  printBanner(config);

  try {
    // Phase 1 — Data directory + database
    ensureDataDir(config.dataDir);
    logWithTimestamp(`Initializing database at ${config.dbPath}`);
    await bootstrapDatabase(config, jarvisConfig);
    logWithTimestamp('Database initialized');

    // Phase 2 — Core services
    registry = new ServiceRegistry();
    const services = bootstrapCoreServices(config, jarvisConfig, registry);
    const { agentService, wsService, channelService, sidecarManager, executor } = services;

    // Phase 3 — Health monitor + TTS/STT
    healthMonitor = new HealthMonitor(registry, config.dbPath);
    wsService.setChannelService(channelService);

    if (jarvisConfig.tts?.enabled) {
      const { createTTSProvider } = await import('../comms/voice.ts');
      const ttsProvider = createTTSProvider(jarvisConfig.tts);
      if (ttsProvider) {
        wsService.setTTSProvider(ttsProvider);
        console.log(`[Daemon] TTS enabled: ${jarvisConfig.tts.voice ?? 'en-US-AriaNeural'}`);
      }
    }

    if (jarvisConfig.stt) {
      const { createSTTProvider } = await import('../comms/voice.ts');
      const sttProvider = createSTTProvider(jarvisConfig.stt);
      if (sttProvider) {
        wsService.setSTTProvider(sttProvider);
        console.log(`[Daemon] STT for voice input: ${jarvisConfig.stt.provider}`);
      }
    }

    // Phase 4 — Authority engine
    const authority = bootstrapAuthority(jarvisConfig, services);
    const { authorityEngine, approvalManager, auditTrail, learner, emergencyController, approvalDelivery, deferredExecutor } = authority;

    // Phase 5 — UI build + API routes
    const uiDistDir = path.join(import.meta.dir, '../../ui/dist');
    const uiIndexPath = path.join(uiDistDir, 'index.html');
    if (!existsSync(uiIndexPath)) {
      logWithTimestamp('Dashboard UI not built — building automatically...');
      const buildResult = Bun.spawnSync(['bun', 'run', 'build:ui'], {
        cwd: path.join(import.meta.dir, '../..'),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
      });
      if (buildResult.exitCode === 0) {
        logWithTimestamp('Dashboard UI built successfully');
      } else {
        const stderr = buildResult.stderr.toString().trim();
        console.warn(`[Daemon] UI build failed (dashboard may not load): ${stderr.slice(0, 200)}`);
      }
    }

    const apiContext: import('./api-routes.ts').ApiContext & Record<string, unknown> = {
      healthMonitor,
      agentService,
      config: jarvisConfig,
      wsService,
      channelService,
      authorityEngine,
      approvalManager,
      auditTrail,
      learner,
      emergencyController,
      deferredExecutor,
      awarenessService: null as any,
      goalService: undefined,
      sidecarManager,
    };
    setCorsOrigin(jarvisConfig.daemon.port);
    const apiRoutes = createApiRoutes(apiContext);
    wsService.setApiRoutes(apiRoutes as Record<string, Record<string, (req: Request) => Response | Promise<Response>>>);
    wsService.setStaticDir(uiDistDir);
    wsService.setPublicDir(path.join(import.meta.dir, '../../ui/public'));

    const authToken = jarvisConfig.auth?.token;
    if (authToken) {
      wsService.setAuthToken(authToken);
      console.log('[Daemon] Auth token configured');
    } else {
      console.warn('[Daemon] No auth token configured — dashboard is open to anyone on the network');
    }

    if (config.noLocalTools) {
      const { setNoLocalTools } = await import('../actions/tools/builtin.ts');
      setNoLocalTools(true);
    }

    // Phase 6 — Start all services
    await registry.startAll();

    // Wire authority post-start
    const orchestrator = agentService.getOrchestrator();
    const toolRegistry = orchestrator.getToolRegistry();
    if (toolRegistry) deferredExecutor.setToolRegistry(toolRegistry);
    approvalDelivery.setBroadcaster(wsService);
    approvalDelivery.setChannelSender(channelService);
    deferredExecutor.setResultCallback((requestId, request, result) => {
      wsService.broadcastNotification(`[EXECUTED] ${request.tool_name}: ${result.slice(0, 200)}`, 'normal');
    });

    // Start background agent
    const bgAgentService = new BackgroundAgentService(jarvisConfig, agentService.getLLMManager());
    bgAgentService.setResearchQueue(services.researchQueue);
    await bgAgentService.start();
    bgAgent = bgAgentService;
    console.log('[Daemon] Background agent started');

    services.reactor.setAgentService(bgAgentService);
    executor.setAgentService(bgAgentService);
    executor.setBroadcast((msg) => wsService.getServer().broadcast(msg));
    wsService.setCommitmentExecutor(executor);
    executor.start();
    commitmentExecutor = executor;

    // Phase 7 — Awareness service
    awarenessService = await bootstrapAwareness(config, jarvisConfig, services, bgAgentService, goalService);
    if (awarenessService) apiContext.awarenessService = awarenessService;

    // Phase 8 — Optional: Site Builder
    if (jarvisConfig.sites?.enabled !== false) {
      try {
        const { SiteBuilderService } = await import('../sites/service.ts');
        const sitesConfig = jarvisConfig.sites ?? { enabled: true, projects_dir: '~/.jarvis/projects', port_range_start: 4000, port_range_end: 4999, auto_commit: true, max_concurrent_servers: 3 };
        const siteBuilderService = new SiteBuilderService(sitesConfig);
        await siteBuilderService.start();
        apiContext.siteBuilderService = siteBuilderService;
        registry.register(siteBuilderService);
        wsService.getServer().setSiteProxy(siteBuilderService.proxy);
        const { createSiteBuilderTools } = await import('../sites/builder-tools.ts');
        const builderTools = createSiteBuilderTools(siteBuilderService.projectManager, siteBuilderService.gitManager, siteBuilderService.githubManager);
        if (toolRegistry) {
          for (const tool of builderTools) toolRegistry.register(tool);
          console.log(`[Daemon] Registered ${builderTools.length} site builder tools`);
        }
        wsService.setSiteBuilderService(siteBuilderService);
        console.log('[Daemon] Site builder service started');
      } catch (err) {
        console.error('[Daemon] Site builder failed to start:', err instanceof Error ? err.message : err);
      }
    }

    // Phase 8b — Optional: Workflow Engine
    if (jarvisConfig.workflows?.enabled !== false) {
      try {
        const { NodeRegistry } = await import('../workflows/nodes/registry.ts');
        const { registerBuiltinNodes } = await import('../workflows/nodes/builtin.ts');
        const { WorkflowEngine } = await import('../workflows/engine.ts');
        const { TriggerManager } = await import('../workflows/triggers/manager.ts');
        const { NLWorkflowBuilder } = await import('../workflows/nl-builder.ts');
        const { WorkflowAutoSuggest } = await import('../workflows/auto-suggest.ts');

        const nodeRegistry = new NodeRegistry();
        registerBuiltinNodes(nodeRegistry);
        console.log(`[Daemon] Node registry: ${nodeRegistry.count()} nodes registered`);

        const wfToolRegistry = orchestrator.getToolRegistry();
        const workflowEngine = new WorkflowEngine(
          nodeRegistry,
          wfToolRegistry ?? new (await import('../actions/tools/registry.ts')).ToolRegistry(),
          agentService.getLLMManager(),
        );
        workflowEngine.setEventCallback((event) => { wsService.broadcastWorkflowEvent(event); });
        await workflowEngine.start();

        const triggerManager = new TriggerManager(workflowEngine);
        await triggerManager.start();

        const nlBuilder = new NLWorkflowBuilder(nodeRegistry, agentService.getLLMManager());
        const autoSuggest = new WorkflowAutoSuggest(nodeRegistry, agentService.getLLMManager());

        const { createManageWorkflowTool } = await import('../actions/tools/workflows.ts');
        const manageWorkflowTool = createManageWorkflowTool({ workflowEngine, nlBuilder, triggerManager });
        if (wfToolRegistry) {
          wfToolRegistry.register(manageWorkflowTool);
          console.log('[Daemon] manage_workflow tool registered');
        }

        apiContext.workflowEngine = workflowEngine;
        apiContext.triggerManager = triggerManager;
        apiContext.webhookManager = triggerManager.getWebhookManager();
        apiContext.nodeRegistry = nodeRegistry;
        apiContext.nlBuilder = nlBuilder;
        apiContext.autoSuggest = autoSuggest;

        console.log('[Daemon] Workflow engine started');
      } catch (err) {
        console.error('[Daemon] Workflow engine failed to start:', err instanceof Error ? err.message : err);
      }
    }

    // Phase 8c — Optional: Goal Service
    if (jarvisConfig.goals?.enabled !== false) {
      try {
        const { GoalService } = await import('../goals/service.ts');
        const goalsConfig = jarvisConfig.goals;
        const defaultGoalConfig = { enabled: true, morning_window: { start: 7, end: 9 }, evening_window: { start: 20, end: 22 }, accountability_style: 'drill_sergeant' as const, escalation_weeks: { pressure: 1, root_cause: 3, suggest_kill: 4 }, auto_decompose: true, calendar_ownership: false };
        const goalSvc = new GoalService(goalsConfig ?? defaultGoalConfig);
        goalSvc.setEventCallback((event) => { wsService.broadcastGoalEvent(event); });
        await goalSvc.start();
        goalService = goalSvc;
        apiContext.goalService = goalSvc;

        try {
          const { generateRhythmWorkflows, registerGoalWorkflows } = await import('../goals/workflow-bridge.ts');
          const rhythmWorkflows = generateRhythmWorkflows(goalsConfig ?? defaultGoalConfig);
          if (apiContext.triggerManager) registerGoalWorkflows(rhythmWorkflows, apiContext.triggerManager as any);
        } catch { /* optional */ }

        try {
          const goalToolReg = orchestrator.getToolRegistry();
          if (goalToolReg) {
            const { createManageGoalsTool } = await import('../actions/tools/goals.ts');
            const { NLGoalBuilder } = await import('../goals/nl-builder.ts');
            const { GoalEstimator } = await import('../goals/estimator.ts');
            const { DailyRhythm } = await import('../goals/rhythm.ts');
            const { AccountabilityEngine } = await import('../goals/accountability.ts');
            const llm = agentService.getLLMManager();
            const style = goalsConfig?.accountability_style ?? 'drill_sergeant';
            const escWeeks = goalsConfig?.escalation_weeks ?? { pressure: 1, root_cause: 3, suggest_kill: 4 };
            const goalNlBuilder = new NLGoalBuilder(llm);
            const goalEstimator = new GoalEstimator(llm);
            const goalRhythm = new DailyRhythm(llm, style);
            const goalAccountability = new AccountabilityEngine(llm, style, escWeeks);
            const manageGoalsTool = createManageGoalsTool({ goalService: goalSvc, nlBuilder: goalNlBuilder, estimator: goalEstimator, rhythm: goalRhythm, accountability: goalAccountability });
            goalToolReg.register(manageGoalsTool);
            goalRhythm.setEventCallback((event) => wsService.broadcastGoalEvent(event));
            goalSvc.setRhythm(goalRhythm);
            goalSvc.setChatCallback((text) => wsService.broadcastHeartbeat(text));
            console.log('[Daemon] manage_goals tool registered');
          }
        } catch (err) {
          console.error('[Daemon] Failed to register manage_goals tool:', err instanceof Error ? err.message : err);
        }

        console.log('[Daemon] Goal service started');
      } catch (err) {
        console.error('[Daemon] Goal service failed to start:', err instanceof Error ? err.message : err);
      }
    }

    // Phase 9 — Sidecar routing + event pipeline + heartbeat
    const { setSidecarManagerRef } = await import('../actions/tools/sidecar-route.ts');
    setSidecarManagerRef(sidecarManager);
    console.log('[Daemon] Sidecar routing enabled');

    bootstrapEventPipeline(services, awarenessService);
    heartbeatTimer = bootstrapHeartbeat(jarvisConfig, services, bgAgentService, healthMonitor, config.healthCheckInterval ?? 30000);

    logWithTimestamp(`JARVIS daemon running on port ${config.port}`);
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('');
    console.log(healthMonitor.formatHealth());
    console.log('');
  } catch (error) {
    console.error('[Daemon] Fatal error during startup:', error);
    process.exit(1);
  }
}

// Signal handlers
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error('[Daemon] Uncaught exception:', error);
  handleShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes('Timeout waiting for') || msg.includes('CDP')) {
    console.warn('[Daemon] Non-fatal browser error (ignoring):', msg);
    return;
  }
  console.error('[Daemon] Unhandled rejection:', reason);
  handleShutdown('unhandledRejection');
});

// Run as CLI if executed directly
if (import.meta.main) {
  const args = parseArgs();
  await startDaemon(args);
}

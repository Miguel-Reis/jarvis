/**
 * Bootstrap Phase 4 — Awareness Service, sidecar bridging, overlay widget.
 *
 * All async-imported to keep startup fast when awareness is disabled.
 */

import path from 'node:path';
import { sendDesktopNotification } from '../../comms/desktop-notify.ts';
import type { CoreServices } from './services.ts';
import type { DaemonConfig } from '../index.ts';
import type { JarvisConfig } from '../../config/types.ts';
import type { BackgroundAgentService } from '../background-agent-service.ts';

export async function bootstrapAwareness(
  config: DaemonConfig,
  jarvisConfig: JarvisConfig,
  services: CoreServices,
  bgAgent: BackgroundAgentService,
  goalService: unknown,
): Promise<import('../../awareness/service.ts').AwarenessService | null> {
  if (jarvisConfig.awareness?.enabled === false || config.noLocalTools) return null;

  const { classifyEvent } = await import('../event-classifier.ts');
  const { coalescer, reactSafe, wsService, channelService, sidecarManager } = services;

  try {
    const { AwarenessService } = await import('../../awareness/service.ts');
    const svc = new AwarenessService(
      jarvisConfig,
      services.agentService.getLLMManager(),
      (event) => {
        const classified = classifyEvent({
          type: event.type,
          data: event.data,
          timestamp: event.timestamp,
        });
        if (classified.priority === 'critical' || classified.priority === 'high') {
          reactSafe(classified);
        } else {
          coalescer.addEvent(classified);
        }
        wsService.broadcastAwarenessEvent(event);

        if (event.type === 'suggestion_ready') {
          const title = String(event.data.title ?? '');
          const body = String(event.data.body ?? '');
          const text = `**${title}**\n${body}`;

          const hasWsClients = wsService.getServer().getClientCount() > 0;
          if (hasWsClients) {
            wsService.broadcastNotification(text, 'urgent');
            sendDesktopNotification(`JARVIS: ${title}`, body, { urgency: 'normal' });
            wsService.broadcastProactiveVoice(body).catch(err =>
              console.error('[Daemon] Awareness TTS error:', err),
            );
          } else {
            console.log('[Daemon] No WS clients — routing suggestion to external channels');
            channelService.broadcastToAll(text).catch(err =>
              console.error('[Daemon] Channel broadcast error:', err),
            );
            sendDesktopNotification(`JARVIS: ${title}`, body, { urgency: 'critical', expireMs: 30000 });
          }
        }

        if (event.type === 'error_detected' && bgAgent) {
          const errorText = String(event.data.errorText ?? '');
          const appName = String(event.data.appName ?? '');
          if (errorText.length > 5) {
            bgAgent.handleMessage(
              `The user is seeing this error in ${appName}: "${errorText}". ` +
              `Search the web and vault for a solution. Be concise and actionable. ` +
              `Start your response with the fix, not a question.`,
              'awareness',
            ).then(solution => {
              if (solution && solution.length > 10) {
                const solutionText = `**Fix for error in ${appName}:**\n${solution.slice(0, 500)}`;
                wsService.broadcastNotification(solutionText, 'urgent');
                sendDesktopNotification(`JARVIS: Fix for ${appName}`, solution.slice(0, 200), { urgency: 'critical', expireMs: 15000 });
                const voiceText = stripMarkdown(solution).slice(0, 300);
                wsService.broadcastProactiveVoice(
                  `I found a fix for the error in ${appName}. ${voiceText}`,
                ).catch(err => console.error('[Daemon] Error solution TTS failed:', err instanceof Error ? err.message : err));
              }
            }).catch(err => console.error('[Daemon] Error auto-research failed:', err instanceof Error ? err.message : err));
          }
        }

        if (event.type === 'struggle_detected' && bgAgent) {
          const appCategory = String(event.data.appCategory ?? 'general');
          const sAppName = String(event.data.appName ?? '');
          const ocrPreview = String(event.data.ocrPreview ?? '');
          const compositeScore = event.data.compositeScore as number;

          if (compositeScore >= 0.7 && (appCategory === 'code_editor' || appCategory === 'terminal')) {
            bgAgent.handleMessage(
              `The user has been struggling in ${sAppName} (${appCategory}) for several minutes. ` +
              `Here's what's on their screen:\n"${ocrPreview.slice(0, 800)}"\n\n` +
              `Search for solutions to any errors visible. Provide a specific, actionable fix.`,
              'awareness',
            ).then(solution => {
              if (solution && solution.length > 10) {
                wsService.broadcastNotification(`**Help for ${sAppName}:**\n${solution.slice(0, 500)}`, 'urgent');
                sendDesktopNotification(`JARVIS: Help for ${sAppName}`, solution.slice(0, 200), { urgency: 'critical', expireMs: 15000 });
                wsService.broadcastProactiveVoice(
                  `I found something that might help in ${sAppName}. ${stripMarkdown(solution).slice(0, 300)}`,
                ).catch(err => console.error('[Daemon] Struggle solution TTS failed:', err instanceof Error ? err.message : err));
              }
            }).catch(err => console.error('[Daemon] Struggle auto-research failed:', err instanceof Error ? err.message : err));
          }
        }

        // Route awareness events to goal auto-detection
        if (goalService && (event.type === 'context_changed' || event.type === 'session_ended')) {
          try {
            const { matchAwarenessToGoals, logAutoDetectedProgress } = require('../../goals/awareness-bridge.ts');
            const matches = matchAwarenessToGoals(event.data);
            if (matches.length > 0) logAutoDetectedProgress(matches, event.type);
          } catch { /* best-effort */ }
        }
      },
      services.googleAuth,
    );

    await svc.start();

    // Wire sidecar events to awareness service
    sidecarManager.onEvent((sidecarId, event) => {
      if (['screen_capture', 'context_changed', 'idle_detected'].includes(event.event_type)) {
        svc.handleSidecarEvent(sidecarId, event).catch(err =>
          console.error('[Daemon] Awareness sidecar event error:', err instanceof Error ? err.message : err),
        );
      }
    });

    // Auto-launch overlay widget
    if (jarvisConfig.awareness?.overlay_autolaunch !== false) {
      try {
        const overlayUrl = `http://localhost:${config.port}/overlay`;
        const browsers = ['chromium-browser', 'chromium', 'google-chrome', 'google-chrome-stable'];
        for (const browser of browsers) {
          const which = Bun.spawnSync(['which', browser]);
          if (which.exitCode === 0) {
            Bun.spawn([
              browser,
              `--app=${overlayUrl}`,
              '--window-size=300,320',
              '--window-position=20,20',
              '--no-sandbox',
              '--disable-extensions',
              '--disable-gpu',
              `--user-data-dir=${path.join(config.dataDir, 'browser', 'overlay-profile')}`,
            ], { stdout: 'ignore', stderr: 'ignore' });
            console.log(`[Daemon] Awareness overlay launched (${browser})`);
            break;
          }
        }
      } catch (err) {
        console.warn('[Daemon] Awareness overlay failed (non-fatal):', err instanceof Error ? err.message : err);
      }
    }

    console.log('[Daemon] Awareness service started (event-driven OCR + context tracking)');
    return svc;
  } catch (err) {
    console.error('[Daemon] Awareness service failed to start:', err instanceof Error ? err.message : err);
    return null;
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

#!/usr/bin/env bun
/**
 * Launch HUD Overlay as a separate browser window
 *
 * Usage: bun run src/scripts/launch-hud.ts
 */

import { spawn } from 'node:child_process';

const PORT = process.env.JARVIS_PORT || '3142';
const HUD_URL = `http://localhost:${PORT}/#/hud`;

async function launch(): Promise<void> {
  console.log('[HUD Launcher] Attempting to launch HUD overlay...');

  const platform = process.platform;

  if (platform === 'win32') {
    // Windows
    console.log(`[HUD Launcher] Opening HUD at ${HUD_URL}`);
    console.log('  Tip: Open in Chrome with --app flag for overlay mode');
    spawn('cmd', ['/c', 'start', HUD_URL], { detached: true, stdio: 'ignore' });
  } else if (platform === 'darwin') {
    // macOS
    console.log(`[HUD Launcher] Opening HUD in Safari at ${HUD_URL}`);
    spawn('open', ['-a', 'Safari', HUD_URL], { detached: true, stdio: 'ignore' });
  } else {
    // Linux
    const browsers = ['chromium-browser', 'chromium', 'google-chrome', 'google-chrome-stable'];

    for (const browser of browsers) {
      try {
        const check = spawn('which', [browser], { stdio: 'ignore' });
        await new Promise<void>((resolve) => {
          check.on('close', (code) => {
            if (code === 0) {
              console.log(`[HUD Launcher] Launching ${browser}...`);
              const child = spawn(browser, [
                '--app=' + HUD_URL,
                '--window-size=320,480',
                '--window-position=20,20',
                '--no-sandbox',
              ], { detached: true, stdio: 'ignore' });

              child.unref();
              console.log('[HUD Launcher] HUD overlay launched');
              resolve();
            } else {
              resolve();
            }
          });
        });
      } catch {
        continue;
      }
    }
  }

  console.log(`  URL: ${HUD_URL}`);
  console.log('  Tip: Use drag to reposition, −/⊞ to collapse/expand');
}

launch().catch(console.error);

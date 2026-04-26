/**
 * Lighthouse Accessibility Testing Script
 * Runs accessibility audits on the Jarvis UI
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG = {
  url: 'http://localhost:3000',
  outputDir: './lighthouse-reports',
  extends: 'lighthouse:default',
  categories: ['accessibility'],
  screenEmulation: {
    mobile: false,
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  },
};

const PAGES_TO_TEST = [
  { path: '/', name: 'Dashboard' },
  { path: '/tasks', name: 'Tasks' },
  { path: '/chat', name: 'Chat' },
  { path: '/goals', name: 'Goals' },
  { path: '/workflows', name: 'Workflows' },
  { path: '/activity', name: 'Activity' },
  { path: '/knowledge', name: 'Knowledge' },
  { path: '/memory', name: 'Memory' },
];

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function runLighthouse(url, name) {
  const safeName = name.toLowerCase().replace(/\s+/g, '-');
  const outputPath = join(CONFIG.outputDir, `a11y-${safeName}.json`);
  const htmlPath = join(CONFIG.outputDir, `a11y-${safeName}.html`);

  console.log(`\n🔍 Testing: ${name} (${url})`);

  try {
    const cmd = `npx lighthouse "${url}" \
      --output=json \
      --output-path="${outputPath}" \
      --output=html \
      --output-path="${htmlPath}" \
      --only-categories=accessibility \
      --quiet \
      --chrome-flags="--headless"`;

    execSync(cmd, { stdio: 'inherit' });
    console.log(`✅ ${name} - Report saved`);
    return true;
  } catch (error) {
    console.error(`❌ ${name} - Failed:`, error.message);
    return false;
  }
}

function generateSummary(results) {
  const summary = {
    timestamp: new Date().toISOString(),
    totalPages: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results: results.map((r) => ({
      name: r.name,
      score: r.score,
      passed: r.passed,
      url: r.url,
    })),
  };

  const table = `
╔══════════════════════════════════════════════════════════════╗
║           ACCESSIBILITY AUDIT SUMMARY                        ║
╠══════════════════════════════════════════════════════════════╣
║ Total Pages: ${summary.totalPages.toString().padEnd(45)} ║
║ Passed: ${summary.passed.toString().padEnd(48)} ║
║ Failed: ${summary.failed.toString().padEnd(48)} ║
╠══════════════════════════════════════════════════════════════╣
║ PAGE                              SCORE    STATUS            ║`;

  results.forEach((r) => {
    const scoreStr = r.score !== null ? `${(r.score * 100).toFixed(0)}%` : 'N/A';
    const status = r.passed ? '✅ PASS' : r.score !== null && r.score >= 0.9 ? '⚠️  WARN' : '❌ FAIL';
    const namePad = r.name.padEnd(31);
    const scorePad = scoreStr.padEnd(8);
    table += `\n║ ${namePad} ${scorePad} ${status.padEnd(15)} ║`;
  });

  table += `\n╚══════════════════════════════════════════════════════════════╝`;

  console.log(table);

  writeFileSync(
    join(CONFIG.outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  return summary;
}

async function main() {
  console.log('🚀 Jarvis Accessibility Audit');
  console.log('═════════════════════════════');

  ensureDir(CONFIG.outputDir);

  const serverProcess = Bun.spawn(['bun', 'run', 'start'], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  console.log('⏳ Waiting for server...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const results = [];

  for (const page of PAGES_TO_TEST) {
    const url = `${CONFIG.url}${page.path}`;
    const passed = await runLighthouse(url, page.name);

    results.push({
      name: page.name,
      url,
      passed,
      score: null,
    });
  }

  serverProcess.kill();

  generateSummary(results);
  console.log(`\n📁 Reports saved to: ${CONFIG.outputDir}/`);
}

main().catch(console.error);

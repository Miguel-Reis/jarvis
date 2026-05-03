/**
 * Local Brain Demo
 *
 * Demonstrates the Local Brain pattern matching capabilities
 * and shows the cost savings potential.
 */

import { globalLocalBrain } from './local-brain.ts';

const demoQueries = [
  // File operations
  'read config.json',
  'show the file package.json',
  'write index.ts with console.log("hello")',

  // Git operations
  'git status',
  'check the git status',
  'git diff',
  'what has changed',

  // Command execution
  'run bun install',
  'execute the command ls -la',

  // Tests
  'run the tests',
  'test the project',

  // Dev server
  'start the dev server',
  'start dev',

  // Search
  'find "useEffect" in the code',
  'search for TODO in files',

  // Install
  'install lodash',
  'add the package axios',

  // Should fallback to LLM
  'write a poem about coding',
  'explain quantum computing',
  'what is the meaning of life?',
];

async function runDemo(): Promise<void> {
  console.log('='.repeat(60));
  console.log('LOCAL BRAIN DEMO');
  console.log('='.repeat(60));
  console.log();

  const metrics = globalLocalBrain.getMetrics();
  console.log(`Initial metrics: ${JSON.stringify(metrics, null, 2)}`);
  console.log();

  for (const query of demoQueries) {
    console.log(`Query: "${query}"`);

    const result = await globalLocalBrain.process(query);

    if (result.matched) {
      console.log(`  ✓ MATCHED: ${result.skill.name}`);
      console.log(`    Action: ${result.result.action}`);
      if (result.result.toolCalls?.length) {
        console.log(`    Tool calls: ${result.result.toolCalls.map(t => t.tool).join(', ')}`);
      }
    } else {
      console.log(`  → FALLBACK TO LLM: ${result.reason}`);
    }
    console.log();
  }

  const finalMetrics = globalLocalBrain.getMetrics();
  console.log('='.repeat(60));
  console.log('FINAL METRICS');
  console.log('='.repeat(60));
  console.log(`Total requests: ${finalMetrics.totalRequests}`);
  console.log(`Local matches: ${finalMetrics.localMatches}`);
  console.log(`LLM fallbacks: ${finalMetrics.llmFallbacks}`);
  console.log(`Local resolution rate: ${(finalMetrics.localRate * 100).toFixed(1)}%`);
  console.log();

  const estimatedSavings = finalMetrics.localMatches * 0.0001; // ~$0.0001 per LLM call
  console.log(`Estimated savings: $${estimatedSavings.toFixed(4)} (vs LLM-only approach)`);
  console.log();
}

runDemo().catch(console.error);

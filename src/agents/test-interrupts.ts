/**
 * Test script for InterruptManager and system observers
 *
 * Usage: bun run src/agents/test-interrupts.ts
 */

import { InterruptManager, FileWatcherObserver, ProcessMonitorObserver, ErrorMonitorObserver } from './interrupt-manager.ts';

// Mock orchestrator for testing
const mockOrchestrator = {
  interrupt: async (event: any) => {
    console.log(`\n[MockOrchestrator] 🎯 INTERRUPT RECEIVED:`);
    console.log(`   Type: ${event.type}`);
    console.log(`   Severity: ${event.severity}`);
    console.log(`   Message: ${event.message}`);
    console.log(`   Data: ${JSON.stringify(event.data)}`);
    console.log(`   Timestamp: ${new Date(event.timestamp).toISOString()}\n`);
  },
  processMessage: async (systemPrompt: string, message: string) => {
    console.log(`[MockOrchestrator] Processing: ${message.slice(0, 100)}...`);
    return "Interrupt processed successfully";
  },
} as any;

async function runTests() {
  console.log('='.repeat(60));
  console.log('🧪 InterruptManager Test Suite');
  console.log('='.repeat(60));
  console.log();

  // 1. Create InterruptManager
  console.log('[1/5] Creating InterruptManager...');
  const interruptManager = new InterruptManager(mockOrchestrator);
  console.log('✅ InterruptManager created\n');

  // 2. Register observers
  console.log('[2/5] Registering observers...');
  const fileWatcher = new FileWatcherObserver(interruptManager, ['/tmp/test']);
  const processMonitor = new ProcessMonitorObserver(interruptManager, ['test-process']);
  const errorMonitor = new ErrorMonitorObserver(interruptManager, [/error/i]);

  interruptManager.registerObserver(fileWatcher);
  interruptManager.registerObserver(processMonitor);
  interruptManager.registerObserver(errorMonitor);
  console.log('✅ 3 observers registered\n');

  // 3. Test file change interrupt
  console.log('[3/5] Testing file change interrupt...');
  await fileWatcher.triggerFileChange('/tmp/test/config.json', 'modified');
  console.log('✅ File change interrupt triggered\n');

  // 4. Test process event interrupt
  console.log('[4/5] Testing process event interrupt...');
  await processMonitor.triggerProcessEvent('test-process', 'crashed');
  console.log('✅ Process event interrupt triggered\n');

  // 5. Test error detection interrupt
  console.log('[5/5] Testing error detection interrupt...');
  await errorMonitor.triggerErrorDetected('Connection timeout after 30s', 'API Gateway');
  console.log('✅ Error detection interrupt triggered\n');

  // Cleanup
  console.log('🧹 Cleaning up...');
  interruptManager.shutdown();
  console.log('✅ Shutdown complete\n');

  console.log('='.repeat(60));
  console.log('✅ All tests passed!');
  console.log('='.repeat(60));
}

// Run tests
runTests().catch(console.error);

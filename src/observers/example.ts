/**
 * Example usage of the Observer Layer
 *
 * This demonstrates how to set up and use the ObserverManager with various observers.
 */

import {
  ObserverManager,
  FileWatcher,
  ClipboardMonitor,
  ProcessMonitor,
  NotificationListener,
  CalendarSync,
  EmailSync,
  type ObserverEvent,
} from './index';

async function main() {
  // Create the manager
  const manager = new ObserverManager();

  // Register observers
  manager.register(new FileWatcher([import.meta.dir + '/../'])); // Watch src directory
  manager.register(new ClipboardMonitor(2000)); // Poll clipboard every 2 seconds
  manager.register(new ProcessMonitor(10000)); // Poll processes every 10 seconds
  manager.register(new NotificationListener()); // Stub
  manager.register(new CalendarSync()); // Stub
  manager.register(new EmailSync()); // Stub

  // Set up event handler (this would typically be the Vault's ingestion function)
  manager.setEventHandler((event: ObserverEvent) => {
    console.log(`[EVENT] ${event.type} at ${new Date(event.timestamp).toISOString()}`);
    console.log('  Data:', JSON.stringify(event.data, null, 2));
  });

  // Start all observers
  await manager.startAll();

  // Get status
  console.log('\n[STATUS] Observer running status:', manager.getStatus());

  // Run for 30 seconds, then stop
  console.log('\n[INFO] Running observers for 30 seconds...\n');

  await new Promise(resolve => setTimeout(resolve, 30000));

  // Stop all observers
  await manager.stopAll();

  console.log('\n[INFO] Example complete');
}

// Run example if executed directly
if (import.meta.main) {
  main().catch(console.error);
}

export { main };

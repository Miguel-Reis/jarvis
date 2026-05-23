/**
 * Bootstrap Phase 1 — Database initialization, webapp seeds, LLM settings.
 */

import { initDatabase } from '../../vault/schema.ts';
import type { DaemonConfig } from '../index.ts';
import type { JarvisConfig } from '../../config/types.ts';

export async function bootstrapDatabase(config: DaemonConfig, jarvisConfig: JarvisConfig): Promise<void> {
  initDatabase(config.dbPath);

  const { seedWebappTemplates } = await import('../../vault/webapp-template-seeds.ts');
  seedWebappTemplates();

  const { mergeLLMSettingsIntoConfig } = await import('../llm-settings.ts');
  mergeLLMSettingsIntoConfig(jarvisConfig);
}

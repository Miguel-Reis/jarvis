import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NodeDefinition } from '../registry.ts';

export const fileWriteAction: NodeDefinition = {
  type: 'action.file_write',
  label: 'File Write',
  description: 'Write or append content to a file on disk.',
  category: 'action',
  icon: '💾',
  color: '#3b82f6',
  configSchema: {
    path: {
      type: 'template',
      label: 'File Path',
      description: 'Absolute or relative path to the file. Supports template expressions.',
      required: true,
      placeholder: '/tmp/output.txt',
    },
    content: {
      type: 'template',
      label: 'Content',
      description: 'Content to write. Supports template expressions.',
      required: true,
      placeholder: '{{data.result}}',
    },
    mode: {
      type: 'select',
      label: 'Mode',
      description: 'Whether to overwrite the file or append to it.',
      required: true,
      default: 'write',
      options: [
        { label: 'Write (overwrite)', value: 'write' },
        { label: 'Append', value: 'append' },
      ],
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const filePath = String(config.path ?? '');
    if (!filePath) throw new Error('path is required');

    const content = String(config.content ?? '');
    const mode = String(config.mode ?? 'write');

    ctx.logger.info(`File ${mode}: ${filePath}`);

    // Ensure parent directory exists
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      // ignore — may already exist
    }

    if (mode === 'append') {
      appendFileSync(filePath, content, 'utf8');
    } else {
      writeFileSync(filePath, content, 'utf8');
    }

    return {
      data: {
        ...input.data,
        path: filePath,
        mode,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
        writtenAt: Date.now(),
      },
    };
  },
};

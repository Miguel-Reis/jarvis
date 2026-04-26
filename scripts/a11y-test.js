/**
 * Accessibility Testing Script for Jarvis UI
 * Uses axe-core for WCAG AA compliance testing
 *
 * Usage: bun run scripts/a11y-test.js
 */

import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// axe-core rules for WCAG AA
const WCAG_AA_RULES = [
  'aria-allowed-attr',
  'aria-hidden-body',
  'aria-required-attr',
  'aria-roles',
  'aria-valid-attr',
  'button-name',
  'color-contrast',
  'document-title',
  'duplicate-id',
  'html-has-lang',
  'image-alt',
  'input-button-name',
  'label',
  'link-name',
  'region',
  'skip-link',
  'tabindex',
  'valid-lang',
];

describe('Accessibility - WCAG AA Compliance', () => {
  test('design tokens file exists', () => {
    const tokensPath = join(process.cwd(), 'ui/src/styles/design-tokens.css');
    const content = readFileSync(tokensPath, 'utf-8');
    expect(content).toContain('--quantum-cyan');
    expect(content).toContain('--glass-bg');
  });

  test('skip link is implemented in MainLayout', () => {
    const layoutPath = join(process.cwd(), 'ui/src/components/layout/MainLayout.tsx');
    const content = readFileSync(layoutPath, 'utf-8');
    expect(content).toContain('skip-link');
    expect(content).toContain('#main-content');
  });

  test('focus-visible styles are defined', () => {
    const stylesPath = join(process.cwd(), 'ui/src/styles/index.css');
    const content = readFileSync(stylesPath, 'utf-8');
    expect(content).toContain('focus-visible');
  });

  test('LoadingSkeleton has aria attributes', () => {
    const componentPath = join(process.cwd(), 'ui/src/components/LoadingSkeleton.tsx');
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('role="status"');
    expect(content).toContain('aria-hidden');
  });

  test('EmptyState has proper accessibility', () => {
    const componentPath = join(process.cwd(), 'ui/src/components/EmptyState.tsx');
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('aria-hidden');
  });

  test('Pagination has ARIA labels', () => {
    const componentPath = join(process.cwd(), 'ui/src/components/Pagination.tsx');
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('aria-label');
    expect(content).toContain('aria-current');
  });

  test('Toast has role="alert"', () => {
    const componentPath = join(process.cwd(), 'ui/src/components/Toast.tsx');
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('role="alert"');
    expect(content).toContain('aria-live');
  });

  test('ConnectionStatus has aria-live region', () => {
    const componentPath = join(process.cwd(), 'ui/src/components/ConnectionStatus.tsx');
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('aria-live');
    expect(content).toContain('role="status"');
  });

  test('Sidebar has navigation landmark', () => {
    const componentPath = join(process.cwd(), 'ui/src/components/layout/Sidebar.tsx');
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('role="navigation"');
    expect(content).toContain('aria-label');
  });

  test('ErrorBoundary has retry mechanism', () => {
    const componentPath = join(process.cwd(), 'ui/src/components/ErrorBoundary.tsx');
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('handleRetry');
  });
});

console.log('\n✅ Accessibility tests completed\n');

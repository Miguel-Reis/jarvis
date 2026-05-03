/**
 * useKeyboardShortcuts Hook
 *
 * Global keyboard shortcuts manager for the application.
 * Supports page-specific shortcuts and global shortcuts.
 */

import { useEffect, useCallback, useRef } from 'react';

export type ShortcutHandler = (e: KeyboardEvent) => void;

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  handler: ShortcutHandler;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export interface PageShortcuts {
  [page: string]: ShortcutConfig[];
}

// Global shortcuts (always active)
const GLOBAL_SHORTCUTS: ShortcutConfig[] = [
  {
    key: 'k',
    meta: true,
    handler: () => {
      // Command palette - handled by GlobalSearch
      const searchInput = document.querySelector('input[data-global-search]') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
      }
    },
    preventDefault: true,
  },
  {
    key: '/',
    meta: true,
    handler: () => {
      // Toggle shortcuts help overlay
      const overlay = document.getElementById('shortcuts-overlay');
      if (overlay) {
        overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
      }
    },
    preventDefault: true,
  },
  {
    key: 'Escape',
    handler: () => {
      // Close modals, panels
      document.querySelectorAll('[role="dialog"], .modal, .panel-open').forEach(el => {
        (el as HTMLElement).click?.();
      });
    },
  },
];

// Page-specific shortcuts
export const PAGE_SHORTCUTS: PageShortcuts = {
  chat: [
    {
      key: 'Enter',
      ctrl: true,
      handler: () => {
        // Send message
        const sendButton = document.querySelector('[data-chat-send]') as HTMLButtonElement;
        sendButton?.click();
      },
      preventDefault: true,
    },
    {
      key: 'n',
      meta: true,
      handler: () => {
        // New conversation
        const newChatButton = document.querySelector('[data-new-chat]') as HTMLButtonElement;
        newChatButton?.click();
      },
      preventDefault: true,
    },
  ],
  tasks: [
    {
      key: 'n',
      handler: () => {
        // New task
        const newTaskButton = document.querySelector('[data-new-task]') as HTMLButtonElement;
        newTaskButton?.click();
      },
      preventDefault: true,
    },
    {
      key: 'Delete',
      handler: () => {
        // Delete selected task
        const selectedTask = document.querySelector('[data-task-selected] [data-delete]') as HTMLButtonElement;
        selectedTask?.click();
      },
      preventDefault: true,
    },
    {
      key: '1',
      handler: () => {
        // Filter: All tasks
        const filter = document.querySelector('[data-filter="all"]') as HTMLButtonElement;
        filter?.click();
      },
    },
    {
      key: '2',
      handler: () => {
        // Filter: Active tasks
        const filter = document.querySelector('[data-filter="active"]') as HTMLButtonElement;
        filter?.click();
      },
    },
    {
      key: '3',
      handler: () => {
        // Filter: Completed tasks
        const filter = document.querySelector('[data-filter="completed"]') as HTMLButtonElement;
        filter?.click();
      },
    },
  ],
  goals: [
    {
      key: 'n',
      handler: () => {
        // New goal
        const newGoalButton = document.querySelector('[data-new-goal]') as HTMLButtonElement;
        newGoalButton?.click();
      },
      preventDefault: true,
    },
    {
      key: 'r',
      meta: true,
      handler: () => {
        // Refresh goals
        const refreshButton = document.querySelector('[data-refresh-goals]') as HTMLButtonElement;
        refreshButton?.click();
      },
      preventDefault: true,
    },
  ],
  workflows: [
    {
      key: 'n',
      handler: () => {
        // New workflow
        const newWorkflowButton = document.querySelector('[data-new-workflow]') as HTMLButtonElement;
        newWorkflowButton?.click();
      },
      preventDefault: true,
    },
    {
      key: 'e',
      handler: () => {
        // Execute selected workflow
        const executeButton = document.querySelector('[data-execute-workflow]') as HTMLButtonElement;
        executeButton?.click();
      },
      preventDefault: true,
    },
  ],
  superjarvis: [
    {
      key: 'r',
      meta: true,
      handler: () => {
        // Refresh directives
        const refreshButton = document.querySelector('[data-refresh-directives]') as HTMLButtonElement;
        refreshButton?.click();
      },
      preventDefault: true,
    },
    {
      key: 'w',
      handler: () => {
        // Toggle wake-word
        const wakeWordToggle = document.querySelector('[data-toggle-wakeword]') as HTMLButtonElement;
        wakeWordToggle?.click();
      },
      preventDefault: true,
    },
  ],
  progress: [
    {
      key: '1',
      handler: () => {
        // 7 days view
        const button = document.querySelector('[data-range="7d"]') as HTMLButtonElement;
        button?.click();
      },
    },
    {
      key: '2',
      handler: () => {
        // 30 days view
        const button = document.querySelector('[data-range="30d"]') as HTMLButtonElement;
        button?.click();
      },
    },
    {
      key: '3',
      handler: () => {
        // 90 days view
        const button = document.querySelector('[data-range="90d"]') as HTMLButtonElement;
        button?.click();
      },
    },
  ],
};

/**
 * Match keyboard event against shortcut config
 */
function matchesShortcut(e: KeyboardEvent, shortcut: ShortcutConfig): boolean {
  if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;
  if (shortcut.ctrl && !e.ctrlKey) return false;
  if (shortcut.shift && !e.shiftKey) return false;
  if (shortcut.alt && !e.altKey) return false;
  if (shortcut.meta && !e.metaKey) return false;

  // If modifier is required but not pressed
  if (!shortcut.ctrl && e.ctrlKey && shortcut.key !== 'Control') return false;
  if (!shortcut.shift && e.shiftKey && shortcut.key !== 'Shift') return false;
  if (!shortcut.alt && e.altKey && shortcut.key !== 'Alt') return false;
  if (!shortcut.meta && e.metaKey && shortcut.key !== 'Meta') return false;

  return true;
}

/**
 * Register keyboard shortcuts
 */
export function useKeyboardShortcuts(page?: string, enabled = true) {
  const shortcutsRef = useRef<ShortcutConfig[]>([]);

  useEffect(() => {
    if (!enabled) return;

    // Build list of active shortcuts
    shortcutsRef.current = [
      ...GLOBAL_SHORTCUTS,
      ...(page ? PAGE_SHORTCUTS[page] || [] : []),
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Allow global shortcuts even in inputs
        const isGlobal = GLOBAL_SHORTCUTS.some(s => matchesShortcut(e, s));
        if (!isGlobal) return;
      }

      for (const shortcut of shortcutsRef.current) {
        if (matchesShortcut(e, shortcut)) {
          if (shortcut.preventDefault) {
            e.preventDefault();
          }
          if (shortcut.stopPropagation) {
            e.stopPropagation();
          }
          shortcut.handler(e);
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [page, enabled]);
}

/**
 * Hook for registering custom shortcuts
 */
export function useRegisterShortcuts(shortcuts: ShortcutConfig[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        if (matchesShortcut(e, shortcut)) {
          if (shortcut.preventDefault) {
            e.preventDefault();
          }
          if (shortcut.stopPropagation) {
            e.stopPropagation();
          }
          shortcut.handler(e);
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);
}

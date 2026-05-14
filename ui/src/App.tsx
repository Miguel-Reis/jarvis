import React, { useState, useEffect, Component, type ReactNode, type ErrorInfo } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useVoice } from "./hooks/useVoice";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { ToastProvider } from "./components/Toast";
import { GlobalSearch } from "./components/GlobalSearch";
import "./styles/sidebar.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[JARVIS] Page crash:', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: '12px', color: 'var(--j-text-dim)', fontSize: '13px',
        }}>
          <div style={{ fontSize: '24px' }}>⚠</div>
          <div style={{ fontWeight: 600, color: 'var(--j-text)' }}>Something went wrong</div>
          <div style={{ color: 'var(--j-text-muted)', fontSize: '12px', maxWidth: '320px', textAlign: 'center' }}>
            {(this.state.error as Error).message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: '8px', padding: '6px 16px', background: 'var(--j-accent)', color: '#000', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import ChatPage from "./pages/ChatPage";

// Lazy page imports
const TasksPage = React.lazy(() => import("./pages/TasksPage"));
const PipelinePage = React.lazy(() => import("./pages/PipelinePage"));
const KnowledgePage = React.lazy(() => import("./pages/KnowledgePage"));
const MemoryPage = React.lazy(() => import("./pages/MemoryPage"));
const CalendarPage = React.lazy(() => import("./pages/CalendarPage"));
const OfficePage = React.lazy(() => import("./pages/OfficePage"));
const CommandPage = React.lazy(() => import("./pages/CommandPage"));
const AuthorityPage = React.lazy(() => import("./pages/AuthorityPage"));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));
const AwarenessPage = React.lazy(() => import("./pages/AwarenessPage"));
const WorkflowsPage = React.lazy(() => import("./pages/WorkflowsPage"));
const GoalsPage = React.lazy(() => import("./pages/GoalsPage"));
const DashboardPage = React.lazy(() => import("./pages/DashboardPage"));
const SitesPage = React.lazy(() => import("./pages/SitesPage"));
const ProjectsPage = React.lazy(() => import("./pages/ProjectsPage"));
const AgentsPage = React.lazy(() => import("./pages/AgentsPage"));
const SystemStatusPage = React.lazy(() => import("./pages/SystemStatusPage.tsx"));
const HUDOverlayPage = React.lazy(() => import("./pages/HUDOverlayPage.tsx"));

type Route = "dashboard" | "chat" | "tasks" | "pipeline" | "memory" | "calendar" | "office" | "knowledge" | "command" | "authority" | "awareness" | "workflows" | "goals" | "sites" | "projects" | "agents" | "systemstatus" | "hud" | "office" | "settings";

export type SettingsSection = "general" | "profile" | "llm" | "channels" | "integrations" | "sidecar" | "mcp";

const SETTINGS_SECTIONS: SettingsSection[] = ["general", "profile", "llm", "channels", "integrations", "sidecar", "mcp"];

function getRoute(): Route {
  const hash = window.location.hash.replace("#/", "");
  if (hash.startsWith("settings")) return "settings";
  if (["dashboard", "chat", "tasks", "pipeline", "memory", "calendar", "office", "knowledge", "command", "authority", "awareness", "workflows", "goals", "sites", "projects", "agents", "systemstatus", "hud", "office"].includes(hash)) {
    return hash as Route;
  }
  return "dashboard";
}

function getSettingsSection(): SettingsSection {
  const hash = window.location.hash.replace("#/", "");
  if (hash.startsWith("settings/")) {
    const section = hash.replace("settings/", "");
    if (SETTINGS_SECTIONS.includes(section as SettingsSection)) {
      return section as SettingsSection;
    }
  }
  return "general";
}

function PageFallback() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      color: "var(--j-text-dim)",
      fontSize: "14px",
    }}>
      Loading...
    </div>
  );
}

/* ================================================================
   NAV ITEMS CONFIG — icon, label, route, grouped
   ================================================================ */
type NavEntry = { icon: string; label: string; route: Route };

const NAV_CORE: NavEntry[] = [
  { icon: "\u25C7", label: "Dashboard",  route: "dashboard" },
  { icon: "\u25CE", label: "Chat",       route: "chat" },
  { icon: "\u25A3", label: "Projects",   route: "projects" },
  { icon: "\u25C6", label: "Goals",      route: "goals" },
  { icon: "\u25A0", label: "Sites",      route: "sites" },
];

const NAV_INTEL: NavEntry[] = [
  { icon: "\uD83E\uDD16", label: "Agents",     route: "agents" },
  { icon: "\u2726", label: "Tasks",      route: "tasks" },
  { icon: "\u25A3", label: "Authority",  route: "authority" },
  { icon: "\u25C8", label: "Memory",     route: "memory" },
  { icon: "\u25B3", label: "Office",     route: "office" },
];

const NAV_MORE: NavEntry[] = [
  { icon: "\u25B6", label: "Pipeline",   route: "pipeline" },
  { icon: "\u25A1", label: "Calendar",   route: "calendar" },
  { icon: "\u25C9", label: "System",     route: "systemstatus" },
];

const SETTINGS_NAV: { section: SettingsSection; label: string }[] = [
  { section: "general", label: "General" },
  { section: "profile", label: "Profile" },
  { section: "llm", label: "LLM" },
  { section: "channels", label: "Channels" },
  { section: "integrations", label: "Integrations" },
  { section: "sidecar", label: "Sidecar" },
  { section: "mcp", label: "MCP Servers" },
];

/* ================================================================
   APP
   ================================================================ */
type NotifItem = {
  id: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  read: boolean;
  created_at: number;
};

export function App() {
  const [route, setRoute] = useState<Route>(getRoute);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(getSettingsSection);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(
    () => localStorage.getItem('jarvis_wake_word_enabled') !== 'false'
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Keep wake word pref in sync when changed from settings panel
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'jarvis_wake_word_enabled') {
        setWakeWordEnabled(e.newValue !== 'false');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const ws = useWebSocket();
  const voice = useVoice({ wsRef: ws.wsRef, wakeWordEnabled });

  // Wire voice callbacks into WS hook
  useEffect(() => {
    ws.voiceCallbacksRef.current = {
      onTTSBinary: voice.handleTTSBinary,
      onTTSStart: voice.handleTTSStart,
      onTTSEnd: voice.handleTTSEnd,
      onError: voice.handleError,
    };
  }, [voice.handleTTSBinary, voice.handleTTSStart, voice.handleTTSEnd, voice.handleError]);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(getRoute());
      setSettingsSection(getSettingsSection());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Set default hash if none
  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = "#/dashboard";
    }
  }, []);

  // Notification polling
  const fetchNotifications = React.useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=20');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.items ?? []);
      setUnreadCount(data.unread ?? 0);
    } catch {}
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);
  useEffect(() => {
    const iv = setInterval(fetchNotifications, 15000);
    return () => clearInterval(iv);
  }, [fetchNotifications]);

  const markAllRead = React.useCallback(async () => {
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {}
  }, []);

  const markOneRead = React.useCallback(async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {}
  }, []);

  // Close bell on outside click
  useEffect(() => {
    if (!bellOpen) return;

    const close = () => setBellOpen(false);
    // Use setTimeout to avoid immediate trigger on the click that opened the bell
    const timeoutId = setTimeout(() => {
      window.addEventListener('click', close, { once: true });
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('click', close);
    };
  }, [bellOpen]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Use keyboard shortcuts hook
  useKeyboardShortcuts(route, true);

  // Additional global shortcuts (legacy support)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;

      // Override for search toggle ( Cmd+K )
      if (mod && e.key === "k") {
        e.preventDefault();
        return; // Handled by useKeyboardShortcuts
      }
      // New item shortcut
      if (mod && e.key === "n" && !isEditable) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("jarvis:new-item"));
        return;
      }
      // Toggle shortcuts overlay ( Cmd+/ )
      if (mod && e.key === "/" && !isEditable) {
        e.preventDefault();
        setShortcutsOpen(v => !v);
        return;
      }
      if (e.key === "Escape") {
        setShortcutsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = `#/${r}`;
  };

  return (
    <ToastProvider>
    <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
    <div className="jarvis-layout" style={{ display: "flex", height: "100vh", width: "100vw", background: "#07070A" }}>
      {/* Sidebar — The Spine */}
      <nav className="sidebar" role="navigation" aria-label="Primary navigation">

        {/* Logo orb */}
        <div className="sidebar-logo-row">
          <div
            className="sidebar-logo"
            title="JARVIS v0.2 Alpha"
            role="img"
            aria-label="JARVIS logo"
            onClick={() => navigate("dashboard")}
          />
          <span className="sidebar-logo-text">J.A.R.V.I.S.</span>
        </div>
        <div className="sidebar-logo-gap" />

        {/* Navigation */}
        <div className="sidebar-nav">
          {/* CORE group */}
          {NAV_CORE.map((item) => (
            <SidebarNavItem
              key={item.route}
              icon={item.icon}
              label={item.label}
              active={route === item.route}
              onClick={() => navigate(item.route)}
            />
          ))}

          <div className="sidebar-group-divider" aria-hidden="true" />

          {/* INTEL group */}
          {NAV_INTEL.map((item) => (
            <SidebarNavItem
              key={item.route}
              icon={item.icon}
              label={item.label}
              active={route === item.route}
              onClick={() => navigate(item.route)}
            />
          ))}

          <div className="sidebar-group-divider" aria-hidden="true" />

          {/* MORE group */}
          {NAV_MORE.map((item) => (
            <SidebarNavItem
              key={item.route}
              icon={item.icon}
              label={item.label}
              active={route === item.route}
              onClick={() => navigate(item.route)}
            />
          ))}

          <div className="sidebar-group-divider" aria-hidden="true" />

          {/* Settings */}
          <SidebarNavItem
            icon={"\u2699"}
            label="Settings"
            active={route === "settings"}
            onClick={() => {
              if (route !== "settings") {
                window.location.hash = "#/settings/general";
              }
            }}
          />

          {/* Settings sub-items — only visible when expanded + settings active */}
          <div className={`sidebar-settings-sub ${route === "settings" ? "open" : ""}`}>
            {SETTINGS_NAV.map(({ section, label }) => (
              <button
                key={section}
                className={`sidebar-sub-item ${settingsSection === section ? "active" : ""}`}
                onClick={() => { window.location.hash = `#/settings/${section}`; }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Bell */}
        <div className="sidebar-bell-row">
          <div style={{ position: "relative" }}>
            <button
              className="sidebar-bell-btn"
              onClick={() => { setBellOpen(v => !v); if (!bellOpen && unreadCount > 0) markAllRead(); }}
              title="Notifications"
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2a4.5 4.5 0 0 1 4.5 4.5c0 2.5.5 4 1.5 4.5H2c1-.5 1.5-2 1.5-4.5A4.5 4.5 0 0 1 8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {unreadCount > 0 && (
                <span className="sidebar-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
              )}
            </button>

            {bellOpen && (
              <div className="sidebar-notif-panel" onClick={e => e.stopPropagation()}>
                <div className="sidebar-notif-header">
                  <span>Notifications</span>
                  {notifications.some(n => !n.read) && (
                    <button className="sidebar-notif-mark-all" onClick={markAllRead}>Mark all read</button>
                  )}
                </div>
                <div className="sidebar-notif-list">
                  {notifications.length === 0 ? (
                    <div className="sidebar-notif-empty">No notifications</div>
                  ) : notifications.map(n => {
                    const typeColor: Record<string, string> = {
                      emergency: "#FB7185", approval: "#FBBF24", warning: "#FB923C",
                      error: "#FB7185", success: "#34D399", info: "#60A5FA",
                    };
                    const color = typeColor[n.type] ?? "#60A5FA";
                    const ago = (() => {
                      const d = Math.floor((Date.now() - n.created_at) / 1000);
                      if (d < 60) return `${d}s ago`;
                      if (d < 3600) return `${Math.floor(d / 60)}m ago`;
                      if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
                      return `${Math.floor(d / 86400)}d ago`;
                    })();
                    return (
                      <div
                        key={n.id}
                        className={`sidebar-notif-item${n.read ? " read" : ""}`}
                        onClick={() => !n.read && markOneRead(n.id)}
                      >
                        <div className="sidebar-notif-dot" style={{ background: color }} />
                        <div className="sidebar-notif-body">
                          <div className="sidebar-notif-title">{n.title}</div>
                          {n.body && <div className="sidebar-notif-text">{n.body}</div>}
                          <div className="sidebar-notif-time">{ago}</div>
                        </div>
                        {!n.read && <div className="sidebar-notif-unread-dot" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Health dot */}
        <div className="sidebar-health-row">
          <div
            className={`sidebar-health ${ws.isConnected ? "connected" : "disconnected"}`}
            title={ws.isConnected ? "System online" : "Disconnected"}
            aria-label={`System health: ${ws.isConnected ? "online" : "disconnected"}`}
          />
          <span className="sidebar-health-label">
            {ws.isConnected ? "Online" : "Disconnected"}
          </span>
        </div>
      </nav>

      {/* Main Content */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {ws.notices.length > 0 ? (
          <div style={{ padding: "14px 18px 0" }}>
            {ws.notices.map((notice) => (
              <div
                key={notice.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  padding: "12px 14px",
                  marginBottom: "10px",
                  borderRadius: "12px",
                  border: "1px solid rgba(251, 191, 36, 0.35)",
                  background: "rgba(251, 191, 36, 0.12)",
                  color: "#FDE68A",
                }}
              >
                <div style={{ fontSize: "18px", lineHeight: 1 }}>⚠</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 700 }}>{notice.title}</div>
                  <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.82)", marginTop: "2px" }}>{notice.text}</div>
                </div>
                <button
                  onClick={() => ws.dismissNotice(notice.id)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    fontSize: "18px",
                    lineHeight: 1,
                  }}
                  aria-label="Dismiss notice"
                  title="Dismiss notice"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <ErrorBoundary>
        <React.Suspense fallback={<PageFallback />}>
          {route === "dashboard" && <DashboardPage messages={ws.messages} isConnected={ws.isConnected} voice={voice} agentActivity={ws.agentActivity} goalEvents={ws.goalEvents} workflowEvents={ws.workflowEvents} />}
          {route === "chat" && <ChatPage messages={ws.messages} isConnected={ws.isConnected} sendMessage={ws.sendMessage} voice={voice} activeThreadId={ws.activeThreadId} onSelectThread={ws.selectThread} onNewThread={ws.startNewThread} pendingApprovals={ws.pendingApprovals} onResolveApproval={ws.resolveApproval} />}
          {route === "tasks" && <TasksPage taskEvents={ws.taskEvents} />}
          {route === "pipeline" && <PipelinePage contentEvents={ws.contentEvents} sendMessage={ws.sendMessage} />}
          {route === "memory" && <MemoryPage />}
          {route === "calendar" && <CalendarPage taskEvents={ws.taskEvents} contentEvents={ws.contentEvents} />}
          {route === "office" && <OfficePage agentActivity={ws.agentActivity} />}
          {route === "knowledge" && <KnowledgePage />}
          {route === "command" && <CommandPage />}
          {route === "awareness" && <AwarenessPage />}
          {route === "workflows" && <WorkflowsPage workflowEvents={ws.workflowEvents} sendMessage={ws.sendMessage} />}
          {route === "goals" && <GoalsPage goalEvents={ws.goalEvents} />}
          {route === "sites" && <SitesPage sendMessage={ws.sendMessage} isConnected={ws.isConnected} messages={ws.messages} />}
          {route === "projects" && <ProjectsPage />}
          {route === "agents" && <AgentsPage />}
          {route === "systemstatus" && <SystemStatusPage />}
          {route === "hud" && <HUDOverlayPage />}
          {route === "authority" && <AuthorityPage />}
          {route === "settings" && <SettingsPage section={settingsSection} />}
        </React.Suspense>
        </ErrorBoundary>
      </main>

      {/* Mobile bottom navigation */}
      <MobileBottomNav route={route} navigate={navigate} />
    </div>
    </ToastProvider>
  );
}

/* ================================================================
   SIDEBAR NAV ITEM
   ================================================================ */
function SidebarNavItem({ icon, label, active, onClick }: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`sidebar-nav-item ${active ? "active" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      tabIndex={0}
    >
      <span className="nav-icon" aria-hidden="true">{icon}</span>
      <span className="nav-label">{label}</span>
      <div className="nav-active-dot" aria-hidden="true" />
    </button>
  );
}

/* ================================================================
   MOBILE BOTTOM NAV
   ================================================================ */
const MOBILE_NAV: NavEntry[] = [
  { icon: "\u25C7", label: "Dashboard", route: "dashboard" },
  { icon: "\u25CE", label: "Chat",      route: "chat" },
  { icon: "\u25C6", label: "Goals",     route: "goals" },
  { icon: "\u2726", label: "Tasks",     route: "tasks" },
  { icon: "\uD83E\uDD16", label: "Agents",   route: "agents" },
  { icon: "\u25A0", label: "Sites",     route: "sites" },
];

function MobileBottomNav({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {MOBILE_NAV.map((item) => (
        <button
          key={item.route}
          className={`mobile-bottom-nav-item${route === item.route ? " active" : ""}`}
          onClick={() => navigate(item.route)}
          aria-label={item.label}
          aria-current={route === item.route ? "page" : undefined}
        >
          <span className="mobile-nav-icon">{item.icon}</span>
          <span className="mobile-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ================================================================
   SHORTCUTS OVERLAY
   ================================================================ */
const SHORTCUT_GROUPS = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Global search" },
      { keys: ["⌘", "/"], description: "Show this overlay" },
      { keys: ["Esc"], description: "Close overlay / panel" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: ["⌘", "N"], description: "New item (current page)" },
    ],
  },
];

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#10101A", border: "1px solid rgba(139,92,246,0.2)", borderRadius: "16px",
          padding: "24px", minWidth: "340px", boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.5px" }}>
            Keyboard Shortcuts
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "0 4px" }}
          >
            ×
          </button>
        </div>

        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "rgba(139,92,246,0.7)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px" }}>
              {group.title}
            </div>
            {group.shortcuts.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>{s.description}</span>
                <div style={{ display: "flex", gap: "4px" }}>
                  {s.keys.map((k, j) => (
                    <kbd key={j} style={{
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "5px", padding: "2px 7px", fontSize: "11px", fontFamily: "inherit",
                      color: "rgba(255,255,255,0.75)", fontWeight: 500,
                    }}>{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}

        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", textAlign: "center", marginTop: "4px" }}>
          Press <kbd style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", padding: "1px 5px", fontSize: "10px" }}>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}

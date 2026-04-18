import React, { useState, useEffect, Component, type ReactNode, type ErrorInfo } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useVoice } from "./hooks/useVoice";
import { ToastProvider } from "./components/Toast";
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

type Route = "dashboard" | "chat" | "tasks" | "pipeline" | "memory" | "calendar" | "office" | "knowledge" | "command" | "authority" | "awareness" | "workflows" | "goals" | "sites" | "settings";

export type SettingsSection = "general" | "profile" | "llm" | "channels" | "integrations" | "sidecar" | "mcp";

const SETTINGS_SECTIONS: SettingsSection[] = ["general", "profile", "llm", "channels", "integrations", "sidecar", "mcp"];

function getRoute(): Route {
  const hash = window.location.hash.replace("#/", "");
  if (hash.startsWith("settings")) return "settings";
  if (["dashboard", "chat", "tasks", "pipeline", "memory", "calendar", "office", "knowledge", "command", "authority", "awareness", "workflows", "goals", "sites"].includes(hash)) {
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
  { icon: "\u25C6", label: "Goals",      route: "goals" },
  { icon: "\u2B21", label: "Workflows",  route: "workflows" },
  { icon: "\u25A0", label: "Sites",      route: "sites" },
];

const NAV_INTEL: NavEntry[] = [
  { icon: "\u25B3", label: "Agents",     route: "office" },
  { icon: "\u2726", label: "Tasks",      route: "tasks" },
  { icon: "\u25A3", label: "Authority",  route: "authority" },
  { icon: "\u25C8", label: "Memory",     route: "memory" },
];

const NAV_MORE: NavEntry[] = [
  { icon: "\u25B6", label: "Pipeline",   route: "pipeline" },
  { icon: "\u25A1", label: "Calendar",   route: "calendar" },
  { icon: "\u25CB", label: "Knowledge",  route: "knowledge" },
  { icon: "\u25A3", label: "Command",    route: "command" },
  { icon: "\u25CE", label: "Awareness",  route: "awareness" },
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
export function App() {
  const [route, setRoute] = useState<Route>(getRoute);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(getSettingsSection);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(
    () => localStorage.getItem('jarvis_wake_word_enabled') !== 'false'
  );

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

  const navigate = (r: Route) => {
    window.location.hash = `#/${r}`;
  };

  return (
    <ToastProvider>
    <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#07070A" }}>
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
          {route === "authority" && <AuthorityPage />}
          {route === "settings" && <SettingsPage section={settingsSection} />}
        </React.Suspense>
        </ErrorBoundary>
      </main>
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

/**
 * Agents & Coordination Page
 *
 * Unified view for multi-agent coordination, observers, interrupts, and goal directives.
 * Combines War Room + Super Jarvis functionality with tabbed interface.
 */

import { useEffect, useState, useCallback } from 'react';
import '../styles/war-room.css';
import { AgentTree, type AgentNode } from '../components/AgentTree';
import { EventTimeline, type TimelineEvent } from '../components/EventTimeline';

type ObserverStatus = {
  name: string;
  active: boolean;
  lastTrigger?: number;
  triggerCount: number;
};

type InterruptLog = {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
};

type GoalDirective = {
  goal: {
    id: string;
    title: string;
    level: string;
    score: number;
    health: string;
    status: string;
  };
  current_task: {
    id: string;
    description: string;
    status: string;
    attempts: number;
  } | null;
  next_tasks: Array<{
    id: string;
    description: string;
    status: string;
  }>;
  needs_decomposition: boolean;
};

type AgentStatus = {
  id: string;
  name: string;
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'blocked' | 'completed';
  currentTask?: string;
  parentAgent?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  skill?: string;
  specialty?: string;
  tasksCompleted?: number;
  tasksFailed?: number;
};

type SkillConfig = {
  icon: string;
  color: string;
  label: string;
};

const SKILL_CONFIG: Record<string, SkillConfig> = {
  'software-engineer': { icon: '💻', color: '#60a5fa', label: 'Software Engineer' },
  'research-analyst': { icon: '🔬', color: '#a78bfa', label: 'Research Analyst' },
  'content-writer': { icon: '✍️', color: '#34d399', label: 'Content Writer' },
  'data-analyst': { icon: '📊', color: '#fbbf24', label: 'Data Analyst' },
  'marketing-strategist': { icon: '📈', color: '#fb7185', label: 'Marketing' },
  'project-coordinator': { icon: '📋', color: '#10b981', label: 'Project Coordinator' },
  'customer-support': { icon: '🎧', color: '#06b6d4', label: 'Support' },
  'financial-analyst': { icon: '💰', color: '#84cc16', label: 'Financial' },
  'legal-advisor': { icon: '⚖️', color: '#f59e0b', label: 'Legal' },
  'hr-specialist': { icon: '👥', color: '#ec4899', label: 'HR' },
  'system-administrator': { icon: '🔧', color: '#6366f1', label: 'SysAdmin' },
  'personal-assistant': { icon: '🤖', color: '#14b8a6', label: 'PA' },
};

function getSkillConfig(name: string): SkillConfig {
  const normalizedName = name.toLowerCase().replace(/_/g, '-');
  for (const [key, config] of Object.entries(SKILL_CONFIG)) {
    if (normalizedName.includes(key) || key.includes(normalizedName)) {
      return config;
    }
  }
  return { icon: '🤖', color: '#6b7280', label: 'Agent' };
}

type Tab = 'agents' | 'observers' | 'directives';

export function AgentsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('agents');
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [skills, setSkills] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [showSkills, setShowSkills] = useState(false);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Super Jarvis state
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakeWordSupported, setWakeWordSupported] = useState(true);
  const [wakeWordStatus, setWakeWordStatus] = useState<'idle' | 'listening' | 'error'>('idle');
  const [observers, setObservers] = useState<ObserverStatus[]>([
    { name: 'file-watcher', active: false, triggerCount: 0 },
    { name: 'process-monitor', active: false, triggerCount: 0 },
    { name: 'error-monitor', active: false, triggerCount: 0 },
  ]);
  const [interrupts, setInterrupts] = useState<InterruptLog[]>([]);
  const [directives, setDirectives] = useState<GoalDirective | null>(null);
  const [lastDirectivesUpdate, setLastDirectivesUpdate] = useState<number | null>(null);
  const [totalInterrupts, setTotalInterrupts] = useState(0);
  const [criticalInterrupts, setCriticalInterrupts] = useState(0);

  // Load agents and events (War Room)
  useEffect(() => {
    async function loadCoordinationData() {
      try {
        const [agentsRes, eventsRes, skillsRes] = await Promise.all([
          fetch('/api/coordination/agents'),
          fetch('/api/coordination/events?limit=50'),
          fetch('/api/coordination/skills'),
        ]);

        if (agentsRes.ok) {
          const agentsData = await agentsRes.json();
          setAgents(agentsData.data || []);
        }

        if (eventsRes.ok) {
          const eventsData = await eventsRes.json();
          setEvents(eventsData.data || []);
        }

        if (skillsRes.ok) {
          const skillsData = await skillsRes.json();
          setSkills(skillsData.skills || []);
        }
      } catch (err) {
        console.error('Failed to load coordination data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadCoordinationData();

    if (autoRefresh) {
      const interval = setInterval(loadCoordinationData, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // Load observers and directives (Super Jarvis)
  useEffect(() => {
    const fetchDirectives = async () => {
      try {
        const res = await fetch('/api/super-jarvis/directives');
        if (res.ok) {
          const data = await res.json();
          setDirectives(data);
          setLastDirectivesUpdate(Date.now());
        }
      } catch (err) {
        console.warn('[Agents] Failed to fetch directives:', err);
      }
    };

    const fetchObservers = async () => {
      try {
        const res = await fetch('/api/super-jarvis/observers');
        if (res.ok) {
          const data = await res.json();
          setObservers(prev =>
            prev.map(obs => ({
              ...obs,
              ...data.find((o: any) => o.name === obs.name),
            }))
          );
        }
      } catch (err) {
        console.warn('[Agents] Failed to fetch observers:', err);
      }
    };

    fetchDirectives();
    fetchObservers();

    const directivesInterval = setInterval(fetchDirectives, 10000);
    const observersInterval = setInterval(fetchObservers, 5000);

    return () => {
      clearInterval(directivesInterval);
      clearInterval(observersInterval);
    };
  }, []);

  // WebSocket for interrupts
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}`);

    ws.onopen = () => console.log('[Agents] WebSocket connected');

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'interrupt_triggered') {
          const newInterrupt: InterruptLog = {
            id: msg.data.id || crypto.randomUUID(),
            type: msg.data.type,
            severity: msg.data.severity,
            message: msg.data.message,
            timestamp: msg.data.timestamp || Date.now(),
            data: msg.data.data,
          };
          setInterrupts(prev => {
            const updated = [newInterrupt, ...prev].slice(0, 50);
            return updated;
          });
          setTotalInterrupts(prev => prev + 1);
          if (msg.data.severity === 'critical') {
            setCriticalInterrupts(prev => prev + 1);
          }
        }
      } catch (err) {
        console.warn('[Agents] WebSocket message error:', err);
      }
    };

    ws.onerror = (err) => console.error('[Agents] WebSocket error:', err);

    return () => ws.close();
  }, []);

  // Wake word support check
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setWakeWordSupported(false);
    }
  }, []);

  const agentTree = buildAgentTree(agents);

  const stats = {
    total: agents.length,
    active: agents.filter(a => a.status === 'executing' || a.status === 'thinking').length,
    blocked: agents.filter(a => a.status === 'blocked').length,
    idle: agents.filter(a => a.status === 'idle').length,
  };

  const toggleWakeWord = useCallback(async () => {
    if (!wakeWordSupported) return;

    if (!wakeWordEnabled) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        setWakeWordStatus('listening');
        setWakeWordEnabled(true);
        await fetch('/api/super-jarvis/wakeword/enable', { method: 'POST' });
      } catch (err) {
        console.error('[Agents] Failed to enable wake-word:', err);
        setWakeWordStatus('error');
      }
    } else {
      setWakeWordStatus('idle');
      setWakeWordEnabled(false);
      await fetch('/api/super-jarvis/wakeword/disable', { method: 'POST' });
    }
  }, [wakeWordEnabled, wakeWordSupported]);

  const toggleObserver = useCallback(async (name: string) => {
    const action = observers.find(o => o.name === name)?.active ? 'disable' : 'enable';
    await fetch(`/api/super-jarvis/observers/${name}/${action}`, { method: 'POST' });

    setObservers(prev =>
      prev.map(obs =>
        obs.name === name ? { ...obs, active: action === 'enable' } : obs
      )
    );
  }, [observers]);

  const clearInterrupts = useCallback(() => {
    setInterrupts([]);
    setTotalInterrupts(0);
    setCriticalInterrupts(0);
  }, []);

  const exportInterrupts = useCallback(() => {
    const blob = new Blob([JSON.stringify(interrupts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interrupts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [interrupts]);

  return (
    <div className="war-room">
      <div className="war-room__container">
        {/* Header */}
        <div className="war-room__header">
          <div>
            <h1 className="war-room__title">🤖 Agents & Coordination</h1>
            <p className="war-room__subtitle">Multi-Agent Coordination • Observers • Interrupts • Goal Directives</p>
          </div>

          <div className="war-room__actions">
            <button
              onClick={() => setShowSkills(!showSkills)}
              className={`war-room__btn ${showSkills ? 'active' : ''}`}
            >
              👁️ Skills {showSkills ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`war-room__btn ${autoRefresh ? 'active' : ''}`}
            >
              {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="agents-tabs">
          <button
            className={`agents-tab ${activeTab === 'agents' ? 'active' : ''}`}
            onClick={() => setActiveTab('agents')}
          >
            Agents ({stats.total})
          </button>
          <button
            className={`agents-tab ${activeTab === 'observers' ? 'active' : ''}`}
            onClick={() => setActiveTab('observers')}
          >
            Observers & Interrupts ({totalInterrupts})
          </button>
          <button
            className={`agents-tab ${activeTab === 'directives' ? 'active' : ''}`}
            onClick={() => setActiveTab('directives')}
          >
            Goal Directives
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'agents' && (
          <>
            {/* Stats Cards */}
            <div className="war-room__stats">
              <div className="stat-card">
                <h3 className="stat-card__label">Total Agents</h3>
                <p className="stat-card__value">{stats.total}</p>
              </div>
              <div className="stat-card stat-card--active">
                <h3 className="stat-card__label">Active</h3>
                <p className="stat-card__value text-green">{stats.active}</p>
              </div>
              <div className="stat-card stat-card--blocked">
                <h3 className="stat-card__label">Blocked</h3>
                <p className="stat-card__value text-red">{stats.blocked}</p>
              </div>
              <div className="stat-card stat-card--idle">
                <h3 className="stat-card__label">Idle</h3>
                <p className="stat-card__value text-gray">{stats.idle}</p>
              </div>
            </div>

            {/* Main Content Grid */}
            <div className="war-room__grid">
              {/* Agent Tree */}
              <div className="war-room__panel">
                <h3 className="war-room__panel-title">Agent Hierarchy</h3>
                {loading ? (
                  <div className="war-room__loading"><div className="spinner" /></div>
                ) : agentTree.length === 0 ? (
                  <div className="empty-state">No active agents</div>
                ) : (
                  <AgentTree agents={agentTree} />
                )}
              </div>

              {/* Agent List */}
              <div className="war-room__panel">
                <h3 className="war-room__panel-title">Agent List</h3>
                <div className="agent-list">
                  {agents.length === 0 ? (
                    <div className="empty-state">
                      <p>No active agents</p>
                      <p className="empty-state-sub">Agents will appear here when spawned for complex tasks</p>
                    </div>
                  ) : (
                    agents.map(agent => {
                      const skill = getSkillConfig(agent.name);
                      return (
                        <div
                          key={agent.id}
                          className={`agent-item ${selectedAgent === agent.id ? 'selected' : ''}`}
                          onClick={() => setSelectedAgent(agent.id === selectedAgent ? null : agent.id)}
                        >
                          <div className="agent-item__header">
                            <div className={`agent-item__status agent-item__status--${agent.status}`} />
                            <span className="agent-item__skill-icon" style={{ fontSize: '16px' }}>{skill.icon}</span>
                            <span className="agent-item__name">{agent.name}</span>
                          </div>
                          <div className="agent-item__skill-badge" style={{ backgroundColor: `${skill.color}20`, color: skill.color, fontSize: '10px', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', marginBottom: '6px' }}>
                            {skill.label}
                          </div>
                          {agent.currentTask && (
                            <div className="agent-item__task">{agent.currentTask}</div>
                          )}
                          <div className="agent-item__meta">
                            <span>{agent.status}</span>
                            {agent.cpuUsage !== undefined && (
                              <span>CPU: {agent.cpuUsage}%</span>
                            )}
                            {agent.memoryUsage !== undefined && (
                              <span>MEM: {agent.memoryUsage}MB</span>
                            )}
                          </div>

                          {selectedAgent === agent.id && (
                            <div className="agent-item__details">
                              <div className="agent-item__detail-row">
                                <span className="agent-item__detail-label">ID:</span>
                                <span className="agent-item__detail-value">{agent.id}</span>
                              </div>
                              <div className="agent-item__detail-row">
                                <span className="agent-item__detail-label">Specialty:</span>
                                <span className="agent-item__detail-value" style={{ color: skill.color }}>{skill.label}</span>
                              </div>
                              {agent.parentAgent && (
                                <div className="agent-item__detail-row">
                                  <span className="agent-item__detail-label">Parent:</span>
                                  <span className="agent-item__detail-value text-purple">{agent.parentAgent}</span>
                                </div>
                              )}
                              {agent.tasksCompleted !== undefined && (
                                <div className="agent-item__detail-row">
                                  <span className="agent-item__detail-label">Tasks:</span>
                                  <span className="agent-item__detail-value">
                                    <span className="text-green">{agent.tasksCompleted}</span> done / <span className="text-red">{agent.tasksFailed || 0}</span> failed
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Event Timeline */}
              <div className="war-room__panel">
                <h3 className="war-room__panel-title">Event Timeline</h3>
                <div className="event-timeline-container">
                  {loading ? (
                    <div className="war-room__loading"><div className="spinner" /></div>
                  ) : (
                    <EventTimeline events={events} limit={30} />
                  )}
                </div>
              </div>
            </div>

            {/* Skills Panel */}
            {showSkills && (
              <div className="war-room__panel">
                <h3 className="war-room__panel-title">Available Specialist Skills</h3>
                {loading ? (
                  <div className="war-room__loading"><div className="spinner" /></div>
                ) : skills.length === 0 ? (
                  <div className="empty-state">No specialist skills registered</div>
                ) : (
                  <div className="skills-grid">
                    {skills.map(skill => {
                      const skillConfig = getSkillConfig(skill.id);
                      return (
                        <div key={skill.id} className="skill-card">
                          <div className="skill-card__header">
                            <span className="skill-card__icon">{skillConfig.icon}</span>
                            <span className="skill-card__name">{skill.name}</span>
                          </div>
                          {skill.description && (
                            <p className="skill-card__desc">{skill.description.slice(0, 100)}...</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Communication Log */}
            <div className="war-room__panel war-room__panel--wide">
              <h3 className="war-room__panel-title">Communication Log</h3>
              <div className="comm-log">
                {events
                  .filter(e => e.type === 'message_sent' || e.type === 'coordination_request')
                  .slice(0, 20)
                  .map((event, idx) => (
                    <div
                      key={event.id}
                      className={`comm-log__item ${idx % 2 === 0 ? 'comm-log__item--alt' : ''}`}
                    >
                      <span className="comm-log__time">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                      {event.fromAgent && (
                        <span className="comm-log__agent comm-log__agent--from">{event.fromAgent}</span>
                      )}
                      <span className="comm-log__arrow">→</span>
                      {event.toAgent && (
                        <span className="comm-log__agent comm-log__agent--to">{event.toAgent}</span>
                      )}
                      {typeof event.data?.message === 'string' && (
                        <span className="comm-log__message">"{event.data.message}"</span>
                      )}
                      {event.data?.requiresResponse === true && (
                        <span className="comm-log__badge">needs response</span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}

        {/* Observers & Interrupts Tab */}
        {activeTab === 'observers' && (
          <div className="observers-tab-content">
            {/* Wake Word + Stats Row */}
            <div className="observers-grid">
              <div className="super-jarvis-card">
                <h2 className="super-jarvis-card-header">
                  <span className="card-icon">🎤</span>
                  Wake-Word Detection
                </h2>

                {!wakeWordSupported ? (
                  <div className="wake-word-warning">
                    ⚠️ Wake-word not supported in this browser. Requires Web Audio API.
                  </div>
                ) : (
                  <>
                    <div className="wake-word-status-row">
                      <span className="wake-word-label">Status:</span>
                      <span className={`wake-word-badge ${wakeWordStatus}`}>
                        {wakeWordStatus === 'listening' ? '🟢 Listening' : wakeWordStatus === 'error' ? '🔴 Error' : '⚪ Idle'}
                      </span>
                    </div>

                    <button
                      onClick={toggleWakeWord}
                      disabled={wakeWordStatus === 'error'}
                      className={`wake-word-btn ${wakeWordEnabled ? 'disable' : 'enable'}`}
                    >
                      {wakeWordEnabled ? '🔴 Disable "Hey Jarvis"' : '🟢 Enable "Hey Jarvis"'}
                    </button>
                  </>
                )}
              </div>

              <div className="super-jarvis-card">
                <h2 className="super-jarvis-card-header">
                  <span className="card-icon">📊</span>
                  System Stats
                </h2>

                <div className="super-jarvis-stats">
                  <div className="stat-box">
                    <div className="stat-value text-cyan">{totalInterrupts}</div>
                    <div className="stat-label">Total Interrupts</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-value text-red">{criticalInterrupts}</div>
                    <div className="stat-label">Critical</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-value text-green">
                      {observers.filter(o => o.active).length}/{observers.length}
                    </div>
                    <div className="stat-label">Active Observers</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-value text-purple">
                      {directives ? '🟢' : '🟡'}
                    </div>
                    <div className="stat-label">Goal Directives</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Observers Grid */}
            <div className="super-jarvis-card super-jarvis-observers">
              <h2 className="super-jarvis-card-header">
                <span className="card-icon">👁️</span>
                System Observers
              </h2>

              <div className="observers-grid">
                {observers.map((observer) => (
                  <div
                    key={observer.name}
                    className={`observer-card ${observer.active ? 'active' : 'inactive'}`}
                  >
                    <div className="observer-card-header">
                      <span className="observer-name">{observer.name.replace('-', ' ')}</span>
                      <span className={`observer-dot ${observer.active ? 'active' : ''}`} />
                    </div>
                    <div className="observer-triggers">
                      Triggers: {observer.triggerCount}
                    </div>
                    <button
                      onClick={() => toggleObserver(observer.name)}
                      className={`observer-btn ${observer.active ? 'disable' : 'enable'}`}
                    >
                      {observer.active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Interrupts Log */}
            <div className="super-jarvis-card super-jarvis-interrupts">
              <div className="interrupts-header">
                <h2 className="super-jarvis-card-header" style={{ margin: 0 }}>
                  <span className="card-icon">🚨</span>
                  Interrupts Log
                </h2>
                <div className="interrupts-actions">
                  <button onClick={exportInterrupts} className="interrupt-btn export">
                    📥 Export
                  </button>
                  <button onClick={clearInterrupts} className="interrupt-btn clear">
                    🗑️ Clear
                  </button>
                </div>
              </div>

              {interrupts.length === 0 ? (
                <div className="empty-state">No interrupts recorded yet.</div>
              ) : (
                <div className="interrupts-list">
                  {interrupts.map((intr) => (
                    <div
                      key={intr.id}
                      className={`interrupt-item ${intr.severity}`}
                    >
                      <div className="interrupt-item-header">
                        <div className="interrupt-badges">
                          <span className={`severity-badge ${intr.severity}`}>{intr.severity}</span>
                          <span className="interrupt-type">{intr.type}</span>
                        </div>
                        <span className="interrupt-time">
                          {new Date(intr.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="interrupt-message">{intr.message}</div>
                      {intr.data && Object.keys(intr.data).length > 0 && (
                        <pre className="interrupt-data">
                          {JSON.stringify(intr.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Goal Directives Tab */}
        {activeTab === 'directives' && (
          <div className="directives-tab-content">
            <div className="super-jarvis-card">
              <h2 className="super-jarvis-card-header">
                <span className="card-icon">🎯</span>
                Current Goal Directives
              </h2>

              {!directives || !directives.goal ? (
                <div className="empty-state">No active directives. The system is in discovery mode.</div>
              ) : (
                <div className="directives-content">
                  <div className="directive-card">
                    <div className="directive-header">
                      <span className="directive-level">{directives.goal?.level.toUpperCase()}</span>
                      <span className="directive-score">
                        Score: {directives.goal?.score?.toFixed(1) ?? 'N/A'}/1.0
                      </span>
                      <span className={`directive-health ${directives.goal?.health}`}>
                        {directives.goal?.health}
                      </span>
                    </div>
                    <h3 className="directive-title">{directives.goal?.title}</h3>

                    {directives.current_task ? (
                      <div className="current-task">
                        <div className="current-task-label">CURRENT TASK</div>
                        <div className="current-task-description">{directives.current_task.description}</div>
                        <div className="current-task-meta">
                          <span>Status: {directives.current_task.status}</span>
                          <span>Attempts: {directives.current_task.attempts}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="needs-decomposition">
                        ⚠️ Needs decomposition — no sub-tasks defined
                      </div>
                    )}

                    {directives.next_tasks && directives.next_tasks.length > 0 && (
                      <div className="next-tasks">
                        <div className="next-tasks-label">NEXT TASKS</div>
                        <ul className="next-tasks-list">
                          {directives.next_tasks.slice(0, 3).map((task, i) => (
                            <li key={i} className="next-task-item">
                              <span className="task-dot" />
                              {task.description}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="directive-updated">
                    Last updated: {lastDirectivesUpdate ? new Date(lastDirectivesUpdate).toLocaleString() : 'Never'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildAgentTree(agents: AgentStatus[]): AgentNode[] {
  const agentMap = new Map<string, AgentNode>();

  for (const agent of agents) {
    agentMap.set(agent.id, {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      currentTask: agent.currentTask,
      children: [],
    });
  }

  const roots: AgentNode[] = [];
  for (const agent of agents) {
    const node = agentMap.get(agent.id)!;
    if (agent.parentAgent && agentMap.has(agent.parentAgent)) {
      agentMap.get(agent.parentAgent)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export default AgentsPage;

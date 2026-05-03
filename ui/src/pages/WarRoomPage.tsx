/**
 * War Room Page - Multi-Agent Coordination UI
 */

import React, { useEffect, useState } from 'react';
import '../styles/war-room.css';
import { AgentTree, type AgentNode } from '../components/AgentTree';
import { EventTimeline, type TimelineEvent } from '../components/EventTimeline';

interface AgentStatus {
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
}

interface SkillConfig {
  icon: string;
  color: string;
  label: string;
}

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
  'ceo-founder': { icon: '👔', color: '#8b5cf6', label: 'CEO' },
  'chief-of-staff': { icon: '📌', color: '#f43f5e', label: 'Chief of Staff' },
  'dev-lead': { icon: '👨‍💻', color: '#3b82f6', label: 'Dev Lead' },
  'marketing-director': { icon: '📢', color: '#e879f9', label: 'Marketing Dir' },
  'executive-assistant': { icon: '📞', color: '#2dd4bf', label: 'Exec Assistant' },
  'activity-observer': { icon: '👁️', color: '#64748b', label: 'Observer' },
  'research-specialist': { icon: '🔍', color: '#a855f7', label: 'Research' },
  'system-admin': { icon: '🖥️', color: '#4f46e5', label: 'SysAdmin' },
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

export function WarRoomPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [skills, setSkills] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [showSkills, setShowSkills] = useState(false);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    loadCoordinationData();

    if (autoRefresh) {
      const interval = setInterval(loadCoordinationData, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

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

  const agentTree = buildAgentTree(agents);

  const stats = {
    total: agents.length,
    active: agents.filter(a => a.status === 'executing' || a.status === 'thinking').length,
    blocked: agents.filter(a => a.status === 'blocked').length,
    idle: agents.filter(a => a.status === 'idle').length,
  };

  return (
    <div className="war-room">
      <div className="war-room__container">
        {/* Header */}
        <div className="war-room__header">
          <div>
            <h1 className="war-room__title">War Room</h1>
            <p className="war-room__subtitle">Multi-Agent Coordination Dashboard</p>
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
            <button
              onClick={loadCoordinationData}
              className="war-room__btn war-room__btn--primary"
            >
              Refresh Now
            </button>
          </div>
        </div>

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
              <div className="war-room__loading">
                <div className="spinner" />
              </div>
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
                <div className="war-room__loading">
                  <div className="spinner" />
                </div>
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
              <div className="war-room__loading">
                <div className="spinner" />
              </div>
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

export default WarRoomPage;

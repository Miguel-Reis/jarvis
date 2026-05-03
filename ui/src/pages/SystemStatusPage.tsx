/**
 * System Status Page
 */

import React, { useEffect, useState } from 'react';
import '../styles/system-status.css';

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastCheck?: number;
  details?: string;
}

interface SystemStats {
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  uptime: number;
  platform: string;
}

interface DatabaseStats {
  status: string;
  tables: Record<string, number>;
}

interface AgentStats {
  total: number;
  active: number;
  blocked: number;
  idle: number;
}

interface GoalStats {
  total: number;
  byStatus: Record<string, number>;
}

interface LiveScreenStatus {
  status: string;
  connectedSidecars: number;
  privacyMode: boolean;
}

export function SystemStatusPage() {
  const [services, setServices] = useState<ServiceHealth[]>([]);

  function formatMB(mb: number): string {
    if (mb === 0) return '0 MB';
    if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(0)} MB`;
  }

  function calculateCPUUsage(cpu: { user: number; system: number }, uptime: number) {
    // cpu.user and cpu.system are in microseconds
    // Convert to percentage based on uptime in seconds
    const totalCpuTime = (cpu.user + cpu.system) / 1_000_000; // Convert μs to seconds
    const cores = navigator.hardwareConcurrency || 4; // Assume 4 cores if unknown
    const userPercent = (cpu.user / 1_000_000 / uptime) * 100;
    const systemPercent = (cpu.system / 1_000_000 / uptime) * 100;
    const totalPercent = ((userPercent + systemPercent) / 2);

    return {
      user: userPercent.toFixed(1),
      system: systemPercent.toFixed(1),
      total: totalPercent.toFixed(1),
    };
  }
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [goalStats, setGoalStats] = useState<GoalStats | null>(null);
  const [siteBuilderStatus, setSiteBuilderStatus] = useState<'running' | 'stopped' | 'error' | 'unknown'>('unknown');
  const [liveScreenStatus, setLiveScreenStatus] = useState<LiveScreenStatus | null>(null);
  const [overallStatus, setOverallStatus] = useState<'healthy' | 'degraded' | 'unhealthy'>('healthy');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadStatus() {
    try {
      const [statusRes, systemRes, dbRes, agentsRes, goalsRes, siteBuilderRes, liveScreenRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/status/system'),
        fetch('/api/status/database'),
        fetch('/api/status/agents'),
        fetch('/api/status/goals'),
        fetch('/api/site-builder/status'),
        fetch('/api/live-screen/status'),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        setOverallStatus(data.status || 'healthy');
        setServices(Object.entries(data.services || {}).map(([name, status]: [string, any]) => ({
          name,
          status: typeof status === 'string' ? status : (status.state || 'running'),
          lastCheck: Date.now(),
        })));
      }

      if (systemRes.ok) setSystemStats(await systemRes.json());
      if (dbRes.ok) setDbStats(await dbRes.json());
      if (agentsRes.ok) setAgentStats(await agentsRes.json());
      if (goalsRes.ok) setGoalStats(await goalsRes.json());
      if (siteBuilderRes.ok) {
        const data = await siteBuilderRes.json();
        setSiteBuilderStatus(data.status || 'unknown');
      }
      if (liveScreenRes.ok) {
        const data = await liveScreenRes.json();
        setLiveScreenStatus(data);
      }

      setLastUpdate(Date.now());
    } catch (err) {
      console.error('Failed to load system status:', err);
    } finally {
      setLoading(false);
    }
  }

  function formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
  }

  async function toggleSiteBuilder() {
    const action = siteBuilderStatus === 'running' ? 'stop' : 'start';
    const res = await fetch(`/api/site-builder/${action}`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setSiteBuilderStatus(data.status || 'unknown');
    }
  }

  async function toggleLiveScreen() {
    const action = liveScreenStatus?.status === 'running' ? 'stop' : 'start';
    const res = await fetch(`/api/live-screen/${action}`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setLiveScreenStatus(data);
    }
  }

  async function triggerLiveScreenCapture() {
    const res = await fetch('/api/live-screen/capture', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      console.log('Live screen captures:', data.captures);
      loadStatus(); // Refresh status
    }
  }

  return (
    <div className="system-status">
      <div className="system-status__container">
        {/* Header */}
        <div className="system-status__header">
          <div>
            <h1 className="system-status__title">System Status</h1>
            <p className="system-status__subtitle">
              Last updated: {new Date(lastUpdate).toLocaleTimeString()}
            </p>
          </div>
          <div className={`system-status__badge ${overallStatus}`}>
            <span className={`system-status__dot system-status__dot--${overallStatus}`} />
            {overallStatus.charAt(0).toUpperCase() + overallStatus.slice(1)}
          </div>
        </div>

        {loading ? (
          <div className="system-status__loading">
            <div className="spinner" />
          </div>
        ) : (
          <>
            {/* Service Health Grid */}
            <div className="system-status__section">
              <h2 className="system-status__section-title">Service Health</h2>
              <div className="service-grid">
                {services.map(service => (
                  <div key={service.name} className={`service-card ${service.status}`}>
                    <div className="service-card__header">
                      <span className="service-card__name">{service.name}</span>
                      <span className={`service-card__status service-card__status--${service.status}`}>
                        {service.status}
                      </span>
                    </div>
                    {service.lastCheck && (
                      <div className="service-card__time">
                        Checked: {new Date(service.lastCheck).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* System Stats */}
            {systemStats && (
              <div className="system-status__section">
                <h2 className="system-status__section-title">System Resources</h2>
                <div className="stats-grid">
                  <div className="stat-card">
                    <h3 className="stat-card__label">Memory Usage</h3>
                    <p className="stat-card__value">{formatMB(systemStats.memory.heapUsed)}</p>
                    <p className="stat-card__sub">of {formatMB(systemStats.memory.heapTotal)}</p>
                  </div>
                  <div className="stat-card">
                    <h3 className="stat-card__label">RSS Memory</h3>
                    <p className="stat-card__value">{formatMB(systemStats.memory.rss)}</p>
                  </div>
                  <div className="stat-card">
                    <h3 className="stat-card__label">CPU Usage</h3>
                    <p className="stat-card__value">{calculateCPUUsage(systemStats.cpu, systemStats.uptime).total}%</p>
                    <p className="stat-card__sub">User: {calculateCPUUsage(systemStats.cpu, systemStats.uptime).user}% | System: {calculateCPUUsage(systemStats.cpu, systemStats.uptime).system}%</p>
                  </div>
                  <div className="stat-card">
                    <h3 className="stat-card__label">Uptime</h3>
                    <p className="stat-card__value">{formatUptime(systemStats.uptime)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Database Stats */}
            {dbStats && (
              <div className="system-status__section">
                <h2 className="system-status__section-title">Database</h2>
                <div className="db-card">
                  <div className="db-card__status">
                    <span className={`status-dot status-dot--${dbStats.status === 'connected' ? 'healthy' : 'unhealthy'}`} />
                    <span>{dbStats.status}</span>
                  </div>
                  <div className="db-card__tables">
                    {Object.entries(dbStats.tables).map(([table, count]) => (
                      <div key={table} className="db-table-row">
                        <span className="db-table-name">{table}</span>
                        <span className="db-table-count">{count.toLocaleString()} rows</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Agent & Goal Stats */}
            <div className="system-status__section system-status__section--grid">
              {agentStats && (
                <div className="info-card">
                  <h3 className="info-card__title">Agent Statistics</h3>
                  <div className="info-card__stats">
                    <div className="info-stat">
                      <span className="info-stat__label">Total</span>
                      <span className="info-stat__value">{agentStats.total}</span>
                    </div>
                    <div className="info-stat">
                      <span className="info-stat__label">Active</span>
                      <span className="info-stat__value text-green">{agentStats.active}</span>
                    </div>
                    <div className="info-stat">
                      <span className="info-stat__label">Blocked</span>
                      <span className="info-stat__value text-red">{agentStats.blocked}</span>
                    </div>
                    <div className="info-stat">
                      <span className="info-stat__label">Idle</span>
                      <span className="info-stat__value text-gray">{agentStats.idle}</span>
                    </div>
                  </div>
                </div>
              )}

              {goalStats && (
                <div className="info-card">
                  <h3 className="info-card__title">Goal Statistics</h3>
                  <div className="info-card__stats">
                    <div className="info-stat">
                      <span className="info-stat__label">Total</span>
                      <span className="info-stat__value">{goalStats.total}</span>
                    </div>
                    {Object.entries(goalStats.byStatus).map(([status, count]) => (
                      <div key={status} className="info-stat">
                        <span className="info-stat__label">{status}</span>
                        <span className="info-stat__value">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Site Builder Status */}
            <div className="system-status__section">
              <h2 className="system-status__section-title">Site Builder</h2>
              <div className="info-card">
                <div className="system-status__header">
                  <h3 className="info-card__title">Site Builder Service</h3>
                  <div className={`system-status__badge ${siteBuilderStatus === 'running' ? 'healthy' : siteBuilderStatus === 'stopped' ? 'degraded' : 'unhealthy'}`}>
                    <span className={`system-status__dot system-status__dot--${siteBuilderStatus === 'running' ? 'healthy' : 'unhealthy'}`} />
                    {siteBuilderStatus}
                  </div>
                </div>
                <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
                  <button
                    onClick={toggleSiteBuilder}
                    className={`war-room__btn war-room__btn--primary ${siteBuilderStatus === 'running' ? '' : 'active'}`}
                  >
                    {siteBuilderStatus === 'running' ? 'Stop Site Builder' : 'Start Site Builder'}
                  </button>
                </div>
              </div>
            </div>

            {/* Live Screen Status */}
            {liveScreenStatus && (
              <div className="system-status__section">
                <h2 className="system-status__section-title">Live Screen Sharing</h2>
                <div className="info-card">
                  <div className="system-status__header">
                    <h3 className="info-card__title">Sidecar Screen Capture</h3>
                    <div className={`system-status__badge ${liveScreenStatus.status === 'running' ? 'healthy' : liveScreenStatus.status === 'stopped' ? 'degraded' : 'unhealthy'}`}>
                      <span className={`system-status__dot system-status__dot--${liveScreenStatus.status === 'running' ? 'healthy' : 'unhealthy'}`} />
                      {liveScreenStatus.status}
                    </div>
                  </div>
                  <div className="live-screen-info">
                    <div className="live-screen-stat">
                      <span className="live-screen-stat__label">Connected Sidecars:</span>
                      <span className="live-screen-stat__value">{liveScreenStatus.connectedSidecars}</span>
                    </div>
                    <div className="live-screen-stat">
                      <span className="live-screen-stat__label">Privacy Mode:</span>
                      <span className="live-screen-stat__value">{liveScreenStatus.privacyMode ? 'ON' : 'OFF'}</span>
                    </div>
                  </div>
                  <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
                    <button
                      onClick={toggleLiveScreen}
                      className={`war-room__btn war-room__btn--primary ${liveScreenStatus.status === 'running' ? '' : 'active'}`}
                    >
                      {liveScreenStatus.status === 'running' ? 'Stop Live Screen' : 'Start Live Screen'}
                    </button>
                    <button
                      onClick={triggerLiveScreenCapture}
                      className="war-room__btn war-room__btn--success"
                      disabled={liveScreenStatus.status !== 'running'}
                    >
                      📸 Capture Now
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SystemStatusPage;

/**
 * HUD Overlay Page - Ambient Transparent Overlay
 *
 * A minimal, always-on-top overlay showing key information:
 * - Current goal progress
 * - Active agent status
 * - Quick notifications
 * - Voice status indicator
 *
 * Designed for transparency and minimal intrusion.
 */

import React, { useEffect, useState } from 'react';
import '../styles/hud-overlay.css';

interface HUDData {
  currentGoal?: string;
  goalProgress: number;
  activeAgents: number;
  pendingNotifications: number;
  voiceActive: boolean;
  systemStatus: 'healthy' | 'degraded' | 'busy';
}

export function HUDOverlayPage() {
  const [data, setData] = useState<HUDData>({
    goalProgress: 0,
    activeAgents: 0,
    pendingNotifications: 0,
    voiceActive: false,
    systemStatus: 'healthy',
  });
  const [, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(0.85);

  useEffect(() => {
    loadHUDData();
    const interval = setInterval(loadHUDData, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  async function loadHUDData() {
    try {
      const [goalsRes, agentsRes, notificationsRes, statusRes] = await Promise.all([
        fetch('/api/status/goals'),
        fetch('/api/status/agents'),
        fetch('/api/notifications?limit=5'),
        fetch('/api/status'),
      ]);

      const goalsData = goalsRes.ok ? await goalsRes.json() : null;
      const agentsData = agentsRes.ok ? await agentsRes.json() : null;
      const notificationsData = notificationsRes.ok ? await notificationsRes.json() : null;
      const statusData = statusRes.ok ? await statusRes.json() : null;

      setData({
        currentGoal: goalsData?.byStatus?.active > 0 ? 'Goal in progress' : undefined,
        goalProgress: calculateGoalProgress(goalsData),
        activeAgents: agentsData?.active ?? 0,
        pendingNotifications: notificationsData?.unread ?? 0,
        voiceActive: false, // Would need WS event for this
        systemStatus: statusData?.status === 'healthy' ? 'healthy' :
                      statusData?.status === 'degraded' ? 'degraded' : 'busy',
      });
    } catch (err) {
      console.error('[HUD] Failed to load data:', err);
    }
  }

  function calculateGoalProgress(data: any): number {
    if (!data || !data.byStatus) return 0;
    const values = Object.values(data.byStatus) as number[];
    const total = values.reduce((a, b) => a + b, 0);
    const completed = data.byStatus.completed || 0;
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  }

  // Dragging handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    const startX = e.clientX - position.x;
    const startY = e.clientY - position.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setPosition({
        x: moveEvent.clientX - startX,
        y: moveEvent.clientY - startY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="hud-overlay" style={{ left: position.x, top: position.y, opacity }}>
      <div className={`hud-container ${isCollapsed ? 'hud-container--collapsed' : 'hud-container--expanded'}`}>
        {/* Header - Always visible */}
        <div className="hud-header" onMouseDown={handleMouseDown}>
          {!isCollapsed && (
            <span className="hud-title">JARVIS HUD</span>
          )}
          <div className="hud-controls">
            {/* System Status Dot */}
            <div className={`hud-status-dot ${
              data.systemStatus === 'healthy' ? 'hud-status-dot--healthy' :
              data.systemStatus === 'degraded' ? 'hud-status-dot--degraded' :
              'hud-status-dot--busy'
            }`} />

            {/* Collapse/Expand */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hud-collapse-btn"
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? '⊞' : '−'}
            </button>
          </div>
        </div>

        {/* Content - Hidden when collapsed */}
        {!isCollapsed && (
          <div className="hud-content">
            {/* Goal Progress */}
            <div className="hud-progress">
              <div className="hud-progress-header">
                <span className="hud-progress-label">Goal Progress</span>
                <span className="hud-progress-value">{data.goalProgress}%</span>
              </div>
              <div className="hud-progress-bar">
                <div
                  className="hud-progress-fill"
                  style={{ width: `${data.goalProgress}%` }}
                />
              </div>
            </div>

            {/* Active Agents */}
            <div className="hud-stat-row">
              <span className="hud-stat-label">🤖 Agents</span>
              <span className={`hud-stat-value ${data.activeAgents > 0 ? 'hud-stat-value--active' : 'hud-stat-value--inactive'}`}>
                {data.activeAgents}
              </span>
            </div>

            {/* Notifications */}
            <div className="hud-stat-row">
              <span className="hud-stat-label">🔔 Notifications</span>
              <span className={`hud-stat-value ${data.pendingNotifications > 0 ? 'hud-stat-value--warning' : 'hud-stat-value--inactive'}`}>
                {data.pendingNotifications > 9 ? '9+' : data.pendingNotifications}
              </span>
            </div>

            {/* Voice Status */}
            <div className="hud-stat-row">
              <span className="hud-stat-label">🎤 Voice</span>
              <span className={`hud-stat-value ${data.voiceActive ? 'hud-stat-value--active' : 'hud-stat-value--inactive'}`}>
                {data.voiceActive ? 'ON' : 'OFF'}
              </span>
            </div>

            {/* Quick Actions */}
            <div className="hud-actions">
              <button
                onClick={() => window.location.hash = '#/dashboard'}
                className="hud-action-btn"
              >
                Dashboard
              </button>
              <button
                onClick={() => window.location.hash = '#/warroom'}
                className="hud-action-btn"
              >
                War Room
              </button>
            </div>

            {/* Opacity Control */}
            <div className="hud-opacity-control">
              <input
                type="range"
                min="0.3"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="hud-slider"
                title="Opacity"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HUDOverlayPage;

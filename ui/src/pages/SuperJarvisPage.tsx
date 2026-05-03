/**
 * Super Jarvis Page — Control Center for Autonomous Features
 */

import React, { useEffect, useState, useCallback } from 'react';
import '../styles/super-jarvis.css';

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

export function SuperJarvisPage() {
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakeWordSupported, setWakeWordSupported] = useState(true);
  const [wakeWordStatus, setWakeWordStatus] = useState<'idle' | 'listening' | 'error'>('idle');
  const [sensitivity, setSensitivity] = useState(0.7);

  const [observers, setObservers] = useState<ObserverStatus[]>([
    { name: 'file-watcher', active: false, triggerCount: 0 },
    { name: 'process-monitor', active: false, triggerCount: 0 },
    { name: 'error-monitor', active: false, triggerCount: 0 },
  ]);

  const [interrupts, setInterrupts] = useState<InterruptLog[]>([]);
  const [maxInterrupts, setMaxInterrupts] = useState(50);

  const [directives, setDirectives] = useState<GoalDirective | null>(null);
  const [lastDirectivesUpdate, setLastDirectivesUpdate] = useState<number | null>(null);

  const [totalInterrupts, setTotalInterrupts] = useState(0);
  const [criticalInterrupts, setCriticalInterrupts] = useState(0);

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setWakeWordSupported(false);
    }
  }, []);

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
        console.warn('[SuperJarvis] Failed to fetch directives:', err);
      }
    };

    fetchDirectives();
    const interval = setInterval(fetchDirectives, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
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
        console.warn('[SuperJarvis] Failed to fetch observers:', err);
      }
    };

    fetchObservers();
    const interval = setInterval(fetchObservers, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}`);

    ws.onopen = () => {
      console.log('[SuperJarvis] WebSocket connected');
    };

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
            const updated = [newInterrupt, ...prev].slice(0, maxInterrupts);
            return updated;
          });
          setTotalInterrupts(prev => prev + 1);
          if (msg.data.severity === 'critical') {
            setCriticalInterrupts(prev => prev + 1);
          }
        }
      } catch (err) {
        console.warn('[SuperJarvis] WebSocket message error:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('[SuperJarvis] WebSocket error:', err);
    };

    return () => {
      ws.close();
    };
  }, [maxInterrupts]);

  const toggleWakeWord = useCallback(async () => {
    if (!wakeWordSupported) return;

    if (!wakeWordEnabled) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setWakeWordStatus('listening');
        setWakeWordEnabled(true);
        await fetch('/api/super-jarvis/wakeword/enable', { method: 'POST' });
        console.log('[SuperJarvis] Wake-word enabled');
      } catch (err) {
        console.error('[SuperJarvis] Failed to enable wake-word:', err);
        setWakeWordStatus('error');
      }
    } else {
      setWakeWordStatus('idle');
      setWakeWordEnabled(false);
      await fetch('/api/super-jarvis/wakeword/disable', { method: 'POST' });
      console.log('[SuperJarvis] Wake-word disabled');
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
    <div className="super-jarvis-page">
      <div className="super-jarvis-container">
        {/* Header */}
        <header className="super-jarvis-header">
          <div>
            <h1 className="super-jarvis-title">🚀 Super Jarvis Control Center</h1>
            <p className="super-jarvis-subtitle">Autonomous Features • Wake-Word • Observers • Interrupts</p>
          </div>
        </header>

        {/* Main Grid */}
        <div className="super-jarvis-grid">
          {/* Wake-Word Card */}
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

                <div className="wake-word-sensitivity">
                  <label className="sensitivity-label">
                    Sensitivity: {(sensitivity * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={sensitivity}
                    onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                    className="sensitivity-slider"
                  />
                </div>
              </>
            )}
          </div>

          {/* Stats Card */}
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

        {/* Observers Section */}
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

        {/* Goal Directives Section */}
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
    </div>
  );
}

export default SuperJarvisPage;

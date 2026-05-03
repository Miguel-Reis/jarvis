/**
 * Local Brain Dashboard
 *
 * Real-time metrics for Local Brain performance and Ollama cost savings.
 */

import React, { useEffect, useState } from 'react';

interface LocalBrainMetrics {
  metrics: {
    totalRequests: number;
    localMatches: number;
    llmFallbacks: number;
    localRate: number;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  estimatedSavings: {
    llmCallsSaved: number;
    estimatedCostSavings: string;
    latencyReduction: string;
  };
}

interface OllamaStats {
  totalCalls: number;
  localCalls: number;
  cloudCalls: number;
  tokensUsed: number;
  estimatedCost: number;
}

export function LocalBrainDashboard(): React.JSX.Element {
  const [metrics, setMetrics] = useState<LocalBrainMetrics | null>(null);
  const [ollamaStats, setOllamaStats] = useState<OllamaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    try {
      const [localBrainRes, ollamaRes] = await Promise.all([
        fetch('/api/status/local-brain'),
        fetch('/api/status/ollama'),
      ]);

      if (localBrainRes.ok) {
        const data = await localBrainRes.json();
        setMetrics(data);
      }

      if (ollamaRes.ok) {
        const data = await ollamaRes.json();
        setOllamaStats(data);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="local-brain-dashboard loading">
        <div className="spinner" />
        <p>Loading Local Brain metrics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="local-brain-dashboard error">
        <p className="error-message">{error}</p>
        <button onClick={fetchMetrics}>Retry</button>
      </div>
    );
  }

  const localRate = metrics?.metrics.localRate ?? 0;
  const localRatePercent = (localRate * 100).toFixed(1);
  const savingsPercent = ((ollamaStats?.localCalls ?? 0) / Math.max(ollamaStats?.totalCalls ?? 1, 1) * 100).toFixed(1);

  return (
    <div className="local-brain-dashboard">
      <header className="dashboard-header">
        <h1>🧠 Local Brain Dashboard</h1>
        <p className="subtitle">Real-time optimization metrics for Ollama cost savings</p>
      </header>

      {/* Key Metrics Cards */}
      <div className="metrics-grid">
        <div className="metric-card primary">
          <div className="metric-value">{localRatePercent}%</div>
          <div className="metric-label">Local Resolution Rate</div>
          <div className="metric-trend positive">
            {localRate >= 0.8 ? '✓ Target achieved (≥80%)' : '○ Below target (≥80%)'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{metrics?.metrics.localMatches ?? 0}</div>
          <div className="metric-label">Local Matches</div>
          <div className="metric-detail">Requests handled without LLM</div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{metrics?.metrics.llmFallbacks ?? 0}</div>
          <div className="metric-label">LLM Fallbacks</div>
          <div className="metric-detail">Requests sent to Ollama Cloud</div>
        </div>

        <div className="metric-card savings">
          <div className="metric-value">${metrics?.estimatedSavings.estimatedCostSavings ?? '0.00'}</div>
          <div className="metric-label">Estimated Savings</div>
          <div className="metric-detail">vs LLM-only approach</div>
        </div>
      </div>

      {/* Ollama Usage Stats */}
      {ollamaStats && (
        <div className="ollama-stats-section">
          <h2>Ollama Cloud Usage</h2>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Total API Calls:</span>
              <span className="stat-value">{ollamaStats.totalCalls}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Local (no API):</span>
              <span className="stat-value local">{ollamaStats.localCalls}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Cloud (API calls):</span>
              <span className="stat-value cloud">{ollamaStats.cloudCalls}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Tokens Used:</span>
              <span className="stat-value">{ollamaStats.tokensUsed.toLocaleString()}</span>
            </div>
            <div className="stat-item highlight">
              <span className="stat-label">API Cost Savings:</span>
              <span className="stat-value">{savingsPercent}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Skills List */}
      <div className="skills-section">
        <h2>Registered Skills ({metrics?.skills.length ?? 0})</h2>
        <div className="skills-list">
          {metrics?.skills.map((skill) => (
            <div key={skill.id} className="skill-item">
              <div className="skill-header">
                <span className="skill-name">{skill.name}</span>
                <span className="skill-id">{skill.id}</span>
              </div>
              <p className="skill-description">{skill.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Performance Chart Placeholder */}
      <div className="chart-section">
        <h2>Request Distribution</h2>
        <div className="distribution-chart">
          <div className="bar-container">
            <div
              className="bar local"
              style={{ width: `${localRatePercent}%` }}
            >
              <span className="bar-label">Local: {localRatePercent}%</span>
            </div>
          </div>
          <div className="bar-container">
            <div
              className="bar cloud"
              style={{ width: `${(1 - localRate) * 100}%` }}
            >
              <span className="bar-label">Cloud: {((1 - localRate) * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="info-box">
        <h3>How Local Brain Works</h3>
        <ul>
          <li><strong>Pattern Matching:</strong> Regex + keyword matching for known commands</li>
          <li><strong>Confidence Scoring:</strong> Only matches above threshold (default 60%)</li>
          <li><strong>Auto Fallback:</strong> Complex requests go to Ollama Cloud automatically</li>
          <li><strong>Cost Savings:</strong> ~80% reduction in API calls for simple tasks</li>
        </ul>
      </div>
    </div>
  );
}

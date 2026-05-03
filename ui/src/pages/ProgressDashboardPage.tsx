/**
 * Progress Dashboard Page
 *
 * Visualizes productivity metrics, goal progress, and predictions.
 */

import React, { useEffect, useState } from 'react';
import '../styles/progress-dashboard.css';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DailyMetrics {
  date: string;
  tasksCompleted: number;
  tasksFailed: number;
  velocityScore: number;
  focusScore: number;
}

interface WeeklyMetrics {
  weekStart: string;
  weekEnd: string;
  totalTasksCompleted: number;
  totalHours: number;
  avgDailyVelocity: number;
  trendDirection: 'up' | 'down' | 'stable';
}

interface HeatmapData {
  date: string;
  count: number;
  level: number;
}

interface GoalPrediction {
  goalId: string;
  title: string;
  currentProgress: number;
  estimatedCompletionDate?: number;
  confidence: number;
  daysRemaining?: number;
  onTrack: boolean;
  recommendedAction: string;
}

const HEATMAP_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

export default function ProgressDashboardPage() {
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetrics[]>([]);
  const [weeklyMetrics, setWeeklyMetrics] = useState<WeeklyMetrics[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([]);
  const [predictions, setPredictions] = useState<GoalPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    loadMetrics();
  }, [selectedRange]);

  async function loadMetrics() {
    setLoading(true);
    try {
      const days = selectedRange === '7d' ? 7 : selectedRange === '30d' ? 30 : 90;

      const [dailyRes, weeklyRes, heatmapRes, predictionsRes] = await Promise.all([
        fetch(`/api/metrics/daily?days=${days}`),
        fetch('/api/metrics/weekly'),
        fetch('/api/metrics/heatmap?months=6'),
        fetch('/api/predictions/goals'),
      ]);

      const daily = await dailyRes.json();
      const weekly = await weeklyRes.json();
      const heatmap = await heatmapRes.json();
      const preds = await predictionsRes.json();

      setDailyMetrics(daily.data || []);
      setWeeklyMetrics(weekly.data || []);
      setHeatmapData(heatmap.data || []);
      setPredictions(preds.data || []);
    } catch (err) {
      console.error('Failed to load metrics:', err);
    } finally {
      setLoading(false);
    }
  }

  const totalTasks = dailyMetrics.reduce((sum, d) => sum + d.tasksCompleted, 0);
  const avgVelocity = dailyMetrics.length > 0
    ? (totalTasks / dailyMetrics.length).toFixed(2)
    : '0';
  const avgFocus = dailyMetrics.length > 0
    ? (dailyMetrics.reduce((sum, d) => sum + d.focusScore, 0) / dailyMetrics.length * 100).toFixed(0)
    : '0';

  return (
    <div className="progress-dashboard">
      <div className="progress-dashboard__container">
        {/* Header */}
        <div className="progress-dashboard__header">
          <div>
            <h1 className="progress-dashboard__title">Progress Dashboard</h1>
            <p className="progress-dashboard__subtitle">Track your productivity and goal completion</p>
          </div>
          <div className="progress-dashboard__range-selector">
            {(['7d', '30d', '90d'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setSelectedRange(range)}
                className={`range-btn ${selectedRange === range ? 'active' : ''}`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="progress-dashboard__loading">
            <div className="spinner" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="progress-dashboard__summary">
              <div className="summary-card">
                <h3 className="summary-card__label">Tasks Completed</h3>
                <p className="summary-card__value text-cyan">{totalTasks}</p>
              </div>
              <div className="summary-card">
                <h3 className="summary-card__label">Avg Velocity</h3>
                <p className="summary-card__value text-green">{avgVelocity} <span className="summary-card__unit">tasks/day</span></p>
              </div>
              <div className="summary-card">
                <h3 className="summary-card__label">Focus Score</h3>
                <p className="summary-card__value text-purple">{avgFocus}%</p>
              </div>
              <div className="summary-card">
                <h3 className="summary-card__label">Active Goals</h3>
                <p className="summary-card__value text-orange">{predictions.length}</p>
              </div>
            </div>

            {/* Main Charts Row */}
            <div className="progress-dashboard__charts">
              <div className="chart-card">
                <h3 className="chart-card__title">Daily Tasks Completed</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dailyMetrics}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10 }} />
                    <YAxis stroke="rgba(255,255,255,0.4)" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#181822', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                    />
                    <Bar dataKey="tasksCompleted" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                <h3 className="chart-card__title">Velocity Trend</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={dailyMetrics}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10 }} />
                    <YAxis stroke="rgba(255,255,255,0.4)" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#181822', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                    />
                    <Line type="monotone" dataKey="velocityScore" stroke="#10B981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Heatmap */}
            <div className="chart-card heatmap-card">
              <h3 className="chart-card__title">Activity Heatmap</h3>
              <div className="heatmap-container">
                <div className="heatmap-row">
                  {heatmapData.map((day, idx) => (
                    <div
                      key={idx}
                      className="heatmap-cell"
                      style={{ backgroundColor: HEATMAP_COLORS[day.level ?? 0] }}
                      title={`${day.date}: ${day.count} tasks`}
                    />
                  ))}
                </div>
              </div>
              <div className="heatmap-legend">
                <span>Less</span>
                <div className="heatmap-scale">
                  {HEATMAP_COLORS.map((color, idx) => (
                    <div key={idx} className="heatmap-scale-cell" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <span>More</span>
              </div>
            </div>

            {/* Goal Predictions */}
            <div className="chart-card">
              <h3 className="chart-card__title">Goal Predictions</h3>
              {predictions.length === 0 ? (
                <p className="empty-state">No active goals with predictions</p>
              ) : (
                <div className="predictions-grid">
                  {predictions.map((pred) => (
                    <div
                      key={pred.goalId}
                      className={`prediction-card ${pred.onTrack ? 'on-track' : 'at-risk'}`}
                    >
                      <h4 className="prediction-card__title" title={pred.title}>{pred.title}</h4>
                      <div className="prediction-card__stats">
                        <div className="prediction-stat">
                          <span className="prediction-stat__label">Progress:</span>
                          <span className={`prediction-stat__value ${pred.currentProgress >= 80 ? 'text-green' : 'text-cyan'}`}>
                            {pred.currentProgress}%
                          </span>
                        </div>
                        <div className="prediction-stat">
                          <span className="prediction-stat__label">ETA:</span>
                          <span className="prediction-stat__value">{pred.daysRemaining ? `${pred.daysRemaining} days` : 'N/A'}</span>
                        </div>
                        <div className="prediction-stat">
                          <span className="prediction-stat__label">Confidence:</span>
                          <span className="prediction-stat__value text-purple">{Math.round(pred.confidence * 100)}%</span>
                        </div>
                        <div className="prediction-card__status">
                          {pred.onTrack ? 'On Track' : 'At Risk'}
                        </div>
                      </div>
                      <p className="prediction-card__action">{pred.recommendedAction}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Weekly Summary */}
            <div className="chart-card">
              <h3 className="chart-card__title">Weekly Summary</h3>
              <div className="weekly-grid">
                {weeklyMetrics.map((week, idx) => (
                  <div key={idx} className="weekly-card">
                    <p className="weekly-card__date">
                      {new Date(week.weekStart).toLocaleDateString()} - {new Date(week.weekEnd).toLocaleDateString()}
                    </p>
                    <p className="weekly-card__value">{week.totalTasksCompleted}</p>
                    <p className="weekly-card__label">tasks</p>
                    <p className="weekly-card__hours">{week.totalHours}h total</p>
                    <div className={`weekly-card__trend ${week.trendDirection}`}>
                      {week.trendDirection === 'up' ? '↑' : week.trendDirection === 'down' ? '↓' : '→'} {week.avgDailyVelocity}/day
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

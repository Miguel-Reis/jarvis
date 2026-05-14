/**
 * Status Page — Real-time dashboard for JARVIS
 *
 * Simple HTML page that shows service status, connected clients,
 * pending approvals, and recent activity.
 */

import type { AgentService } from './agent-service.ts';
import type { WebSocketService } from './ws-service.ts';
import type { ApprovalManager } from '../authority/approval.ts';
import type { AuditTrail } from '../authority/audit.ts';
import type { CommitmentExecutor } from './commitment-executor.ts';

export function getStatusPage(
  agentService: AgentService | null,
  wsService: WebSocketService | null,
  approvalManager: ApprovalManager | null,
  auditTrail: AuditTrail | null,
  commitmentExecutor: CommitmentExecutor | null,
  uptimeMs: number
): string {
  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const agentStatus = agentService?.status() ?? 'stopped';
  const wsClients = wsService?.getClientCount?.() ?? 0;
  const pendingApprovals = approvalManager?.getPendingRequests?.()?.length ?? 0;
  const auditStats = auditTrail?.getStats?.() ?? { total: 0, allowed: 0, denied: 0, approvalRequired: 0, byCategory: {} };
  const commitments = commitmentExecutor?.getPendingCommitments?.() ?? [];

  const getStatusColor = (status: string) => {
    if (status === 'running') return '#22c55e';
    if (status === 'starting' || status === 'stopping') return '#eab308';
    return '#ef4444';
  };

  const now = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JARVIS Status</title>
  <meta http-equiv="refresh" content="5">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 2rem;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #fff; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 1.5rem;
      border: 1px solid #334155;
    }
    .card h2 {
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin-bottom: 1rem;
    }
    .stat {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 0;
      border-bottom: 1px solid #334155;
    }
    .stat:last-child { border-bottom: none; }
    .stat-label { color: #cbd5e1; }
    .stat-value { font-weight: 600; font-size: 1.25rem; }
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 8px;
    }
    .status-row {
      display: flex;
      align-items: center;
      padding: 0.5rem 0;
    }
    .refresh { color: #64748b; font-size: 0.875rem; margin-top: 1rem; }
    .warning { background: #fef3c7; color: #92400e; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; }
    .commitment {
      background: #334155;
      padding: 0.75rem;
      border-radius: 6px;
      margin-top: 0.5rem;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 JARVIS Status</h1>
    <p class="subtitle">Last updated: ${now}</p>

    ${pendingApprovals > 0 ? `
      <div class="warning">
        ⚠️ You have <strong>${pendingApprovals}</strong> pending approval${pendingApprovals > 1 ? 's' : ''} waiting
      </div>
    ` : ''}

    <div class="grid">
      <div class="card">
        <h2>Services</h2>
        <div class="status-row">
          <span class="status-dot" style="background: ${getStatusColor(agentStatus)}"></span>
          <span>Agent: <strong>${agentStatus}</strong></span>
        </div>
        <div class="status-row">
          <span class="status-dot" style="background: ${wsClients > 0 ? '#22c55e' : '#64748b'}"></span>
          <span>WebSocket: <strong>${wsClients}</strong> client${wsClients !== 1 ? 's' : ''} connected</span>
        </div>
        <div class="stat">
          <span class="stat-label">Uptime</span>
          <span class="stat-value">${formatUptime(uptimeMs)}</span>
        </div>
      </div>

      <div class="card">
        <h2>Approvals</h2>
        <div class="stat">
          <span class="stat-label">Pending</span>
          <span class="stat-value" style="color: ${pendingApprovals > 0 ? '#f59e0b' : '#22c55e'}">${pendingApprovals}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Allowed</span>
          <span class="stat-value" style="color: #22c55e">${auditStats.allowed}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Denied</span>
          <span class="stat-value" style="color: #ef4444">${auditStats.denied}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Required</span>
          <span class="stat-value" style="color: #f59e0b">${auditStats.approvalRequired}</span>
        </div>
      </div>

      <div class="card">
        <h2>Audit Trail</h2>
        <div class="stat">
          <span class="stat-label">Total Actions</span>
          <span class="stat-value">${auditStats.total}</span>
        </div>
        <div class="stat">
          <span class="stat-label">By Category</span>
          <span class="stat-value">${Object.keys(auditStats.byCategory || {}).length}</span>
        </div>
      </div>

      <div class="card">
        <h2>Commitments</h2>
        <div class="stat">
          <span class="stat-label">Pending</span>
          <span class="stat-value">${commitments.length}</span>
        </div>
        ${commitments.slice(0, 3).map(c => `
          <div class="commitment">
            <strong>${c.title?.slice(0, 40) || 'Unnamed'}</strong>${c.title && c.title.length > 40 ? '...' : ''}<br>
            <span style="color: #94a3b8">Due: ${c.dueAt ? new Date(c.dueAt).toLocaleString() : 'No deadline'}</span>
          </div>
        `).join('')}
        ${commitments.length > 3 ? `<div style="color: #64748b; font-size: 0.875rem; margin-top: 0.5rem">+${commitments.length - 3} more...</div>` : ''}
      </div>
    </div>

    <p class="refresh">Page auto-refreshes every 5 seconds</p>
  </div>
</body>
</html>`;
}

/**
 * Agent Tree Component
 *
 * Visualizes the hierarchy of agents and their tasks in a tree structure.
 * Shows parent-child relationships and task delegation.
 */

import { useState } from 'react';
import '../styles/agent-tree.css';

export interface AgentNode {
  id: string;
  name: string;
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'blocked' | 'completed';
  currentTask?: string;
  children?: AgentNode[];
  depth?: number;
}

interface AgentTreeProps {
  agents: AgentNode[];
  expanded?: boolean;
}

const statusColors: Record<string, string> = {
  idle: 'bg-gray-500',
  thinking: 'bg-yellow-500 animate-pulse',
  executing: 'bg-green-500 animate-pulse',
  waiting: 'bg-orange-500',
  blocked: 'bg-red-500 animate-pulse',
  completed: 'bg-blue-500',
};

const statusLabels: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking...',
  executing: 'Executing',
  waiting: 'Waiting',
  blocked: 'Blocked',
  completed: 'Completed',
};

export function AgentTree({ agents }: AgentTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(agents.map(a => a.id)));

  const toggleNode = (agentId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(agentId)) {
      newExpanded.delete(agentId);
    } else {
      newExpanded.add(agentId);
    }
    setExpandedNodes(newExpanded);
  };

  function renderNode(node: AgentNode, depth = 0) {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.id} style={{ marginLeft: depth > 0 ? '16px' : '0' }}>
        <div
          className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all hover:bg-gray-800/50 ${
            depth === 0 ? 'bg-gray-800/30' : ''
          }`}
          onClick={() => hasChildren && toggleNode(node.id)}
        >
          {/* Status indicator */}
          <div
            className={`w-3 h-3 rounded-full ${statusColors[node.status]}`}
            title={statusLabels[node.status]}
          />

          {/* Expand/collapse icon */}
          {hasChildren ? (
            <span className="text-gray-400 text-xs">
              {isExpanded ? '▼' : '▶'}
            </span>
          ) : (
            <span className="w-3" />
          )}

          {/* Agent name */}
          <span className="font-medium text-white flex-1">{node.name}</span>

          {/* Current task */}
          {node.currentTask && (
            <span className="text-xs text-gray-400 truncate max-w-[200px]">
              {node.currentTask}
            </span>
          )}

          {/* Status label */}
          <span className="text-xs text-gray-500">{statusLabels[node.status]}</span>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="border-l border-gray-700 ml-4">
            {node.children!.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {agents.map(agent => renderNode(agent, 0))}
    </div>
  );
}

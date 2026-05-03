/**
 * Event Timeline Component
 *
 * Displays a chronological timeline of agent coordination events.
 * Shows inter-agent communication, task assignments, and escalations.
 */

import React from 'react';
import '../styles/event-timeline.css';

export interface TimelineEvent {
  id: string;
  type: string;
  fromAgent?: string;
  toAgent?: string;
  taskId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface EventTimelineProps {
  events: TimelineEvent[];
  limit?: number;
}

const eventTypeIcons: Record<string, string> = {
  agent_spawned: '👤',
  task_assigned: '📋',
  task_completed: '✅',
  task_failed: '❌',
  message_sent: '💬',
  message_received: '📨',
  escalation: '⚠️',
  coordination_request: '🔄',
  blocked: '🚫',
  unblocked: '✅',
};

const eventTypeColors: Record<string, string> = {
  agent_spawned: 'border-blue-500 bg-blue-500/10',
  task_assigned: 'border-cyan-500 bg-cyan-500/10',
  task_completed: 'border-green-500 bg-green-500/10',
  task_failed: 'border-red-500 bg-red-500/10',
  message_sent: 'border-gray-500 bg-gray-500/10',
  escalation: 'border-orange-500 bg-orange-500/10',
  coordination_request: 'border-purple-500 bg-purple-500/10',
  blocked: 'border-red-500 bg-red-500/10',
  unblocked: 'border-green-500 bg-green-500/10',
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function EventTimeline({ events, limit = 50 }: EventTimelineProps) {
  const slicedEvents = events.slice(0, limit);

  return (
    <div className="space-y-0">
      {slicedEvents.length === 0 ? (
        <div className="text-center text-gray-500 py-8">
          No events yet
        </div>
      ) : (
        slicedEvents.map((event, index) => (
          <div
            key={event.id}
            className={`flex gap-3 ${index !== slicedEvents.length - 1 ? 'pb-4' : ''}`}
          >
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                  eventTypeColors[event.type] || 'border-gray-500 bg-gray-500/10'
                }`}
              >
                <span className="text-sm">
                  {eventTypeIcons[event.type] || '📝'}
                </span>
              </div>
              {index !== slicedEvents.length - 1 && (
                <div className="w-px h-full bg-gray-700 mt-2" />
              )}
            </div>

            {/* Event content */}
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-white">
                  {formatEventType(event.type)}
                </span>
                <span className="text-xs text-gray-500">
                  {formatRelativeTime(event.timestamp)}
                </span>
              </div>

              {/* Event details */}
              <div className="text-sm text-gray-400 space-y-1">
                {event.fromAgent && event.toAgent && (
                  <div>
                    <span className="text-cyan-400">{event.fromAgent}</span>
                    <span className="text-gray-500"> → </span>
                    <span className="text-purple-400">{event.toAgent}</span>
                  </div>
                )}
                {event.fromAgent && !event.toAgent && (
                  <div>
                    <span className="text-cyan-400">{event.fromAgent}</span>
                  </div>
                )}
                {event.taskId && (
                  <div className="text-xs">
                    Task: <span className="text-gray-300">{event.taskId}</span>
                  </div>
                )}
                {event.data && Object.keys(event.data).length > 0 && (
                  <div className="text-xs bg-gray-800/50 rounded p-2 mt-1">
                    {typeof event.data.message === 'string' && (
                      <div className="text-gray-300">{event.data.message}</div>
                    )}
                    {typeof event.data.reason === 'string' && (
                      <div className="text-orange-400">Reason: {event.data.reason}</div>
                    )}
                    {typeof event.data.description === 'string' && (
                      <div className="text-gray-300">{event.data.description}</div>
                    )}
                    {event.data.result !== undefined && (
                      <div className="text-green-400">Result: {String(event.data.result)}</div>
                    )}
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <div className="text-xs text-gray-600 mt-1">
                {formatTime(event.timestamp)}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function formatEventType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

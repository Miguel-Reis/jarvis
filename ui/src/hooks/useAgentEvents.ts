/**
 * useAgentEvents — task, content, agent-activity, workflow, and site event state.
 */

import { useState, useCallback } from "react";
import type { TaskEvent, ContentEvent, AgentActivityEvent, WorkflowEvent, SiteEvent, WSMessage } from "./ws-types.ts";

export type { TaskEvent, ContentEvent, AgentActivityEvent, WorkflowEvent, SiteEvent };

export function useAgentEvents() {
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [contentEvents, setContentEvents] = useState<ContentEvent[]>([]);
  const [agentActivity, setAgentActivity] = useState<AgentActivityEvent[]>([]);
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [siteEvents, setSiteEvents] = useState<SiteEvent[]>([]);

  const addAgentActivity = useCallback((event: AgentActivityEvent) => {
    setAgentActivity((prev) => [event, ...prev].slice(0, 50));
  }, []);

  const handleTaskUpdate = useCallback((msg: WSMessage, payload: any) => {
    if (payload.source === "task_update" && payload.task && payload.action) {
      setTaskEvents((prev) => [...prev, {
        action: payload.action as TaskEvent["action"],
        task: payload.task,
        timestamp: msg.timestamp,
      }]);
    } else if (payload.source === "content_update" && payload.item && payload.action) {
      setContentEvents((prev) => [...prev, {
        action: payload.action as ContentEvent["action"],
        item: payload.item,
        timestamp: msg.timestamp,
      }]);
    }
  }, []);

  const handleWorkflowEvent = useCallback((wfEvent: WorkflowEvent) => {
    setWorkflowEvents((prev) => [...prev, wfEvent].slice(-100));
  }, []);

  const handleSiteEvent = useCallback((siteEvent: SiteEvent) => {
    setSiteEvents((prev) => [...prev, siteEvent].slice(-100));
  }, []);

  return {
    taskEvents,
    contentEvents,
    agentActivity,
    workflowEvents,
    siteEvents,
    addAgentActivity,
    handleTaskUpdate,
    handleWorkflowEvent,
    handleSiteEvent,
  };
}

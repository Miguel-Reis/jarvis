import { describe, test, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useAgentEvents } from "./useAgentEvents.ts";

const makeMockMsg = (overrides: any = {}) => ({
  type: "notification",
  payload: {},
  timestamp: Date.now(),
  ...overrides,
});

describe("useAgentEvents", () => {
  test("starts with empty state", () => {
    const { result } = renderHook(() => useAgentEvents());
    expect(result.current.taskEvents).toHaveLength(0);
    expect(result.current.contentEvents).toHaveLength(0);
    expect(result.current.agentActivity).toHaveLength(0);
    expect(result.current.workflowEvents).toHaveLength(0);
    expect(result.current.siteEvents).toHaveLength(0);
  });

  test("records a task update", () => {
    const { result } = renderHook(() => useAgentEvents());
    const msg = makeMockMsg();
    const payload = {
      source: "task_update",
      action: "created",
      task: { id: "t1", what: "Do something", when_due: null, context: null, priority: "high", status: "pending", assigned_to: null, created_from: null, created_at: Date.now(), completed_at: null, result: null, sort_order: 0 },
    };
    act(() => { result.current.handleTaskUpdate(msg, payload); });
    expect(result.current.taskEvents).toHaveLength(1);
    expect(result.current.taskEvents[0]?.task.id).toBe("t1");
  });

  test("records a workflow event", () => {
    const { result } = renderHook(() => useAgentEvents());
    const wfEvent = { type: "node_completed", workflowId: "wf1", data: {}, timestamp: Date.now() };
    act(() => { result.current.handleWorkflowEvent(wfEvent); });
    expect(result.current.workflowEvents).toHaveLength(1);
    expect(result.current.workflowEvents[0]?.workflowId).toBe("wf1");
  });

  test("keeps agent activity capped at 50", () => {
    const { result } = renderHook(() => useAgentEvents());
    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.addAgentActivity({ id: `a${i}`, agentName: "bot", agentId: "a", eventType: "text", data: i, timestamp: i });
      }
    });
    expect(result.current.agentActivity).toHaveLength(50);
  });
});

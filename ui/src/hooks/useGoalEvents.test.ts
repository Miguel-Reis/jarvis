import { describe, test, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useGoalEvents } from "./useGoalEvents.ts";

describe("useGoalEvents", () => {
  test("starts with empty goal events", () => {
    const { result } = renderHook(() => useGoalEvents());
    expect(result.current.goalEvents).toHaveLength(0);
  });

  test("appends a goal event", () => {
    const { result } = renderHook(() => useGoalEvents());
    const event = { type: "goal_created", goalId: "g1", data: { title: "Write tests" }, timestamp: Date.now() };

    act(() => {
      result.current.handleGoalEvent(event);
    });

    expect(result.current.goalEvents).toHaveLength(1);
    expect(result.current.goalEvents[0]?.type).toBe("goal_created");
    expect(result.current.goalEvents[0]?.goalId).toBe("g1");
  });

  test("keeps only last 100 events", () => {
    const { result } = renderHook(() => useGoalEvents());
    act(() => {
      for (let i = 0; i < 105; i++) {
        result.current.handleGoalEvent({ type: "tick", data: { i }, timestamp: i });
      }
    });
    expect(result.current.goalEvents).toHaveLength(100);
    expect(result.current.goalEvents[99]?.data.i).toBe(104);
  });
});

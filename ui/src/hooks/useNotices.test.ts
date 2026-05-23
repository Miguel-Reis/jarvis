import { describe, test, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useNotices } from "./useNotices.ts";

describe("useNotices", () => {
  test("starts with no notices", () => {
    const { result } = renderHook(() => useNotices());
    expect(result.current.notices).toHaveLength(0);
  });

  test("adds a notice", () => {
    const { result } = renderHook(() => useNotices());
    act(() => {
      result.current.addNotice({ id: "n1", title: "Warning", text: "Something went wrong", level: "warning" });
    });
    expect(result.current.notices).toHaveLength(1);
    expect(result.current.notices[0]?.title).toBe("Warning");
  });

  test("deduplicates notices with the same text", () => {
    const { result } = renderHook(() => useNotices());
    act(() => {
      result.current.addNotice({ id: "n1", title: "W", text: "Same message", level: "warning" });
      result.current.addNotice({ id: "n2", title: "W", text: "Same message", level: "warning" });
    });
    expect(result.current.notices).toHaveLength(1);
  });

  test("dismisses a notice by ID", () => {
    const { result } = renderHook(() => useNotices());
    act(() => {
      result.current.addNotice({ id: "n1", title: "W", text: "Test", level: "warning" });
      result.current.addNotice({ id: "n2", title: "W2", text: "Test 2", level: "warning" });
    });
    act(() => {
      result.current.dismissNotice("n1");
    });
    expect(result.current.notices).toHaveLength(1);
    expect(result.current.notices[0]?.id).toBe("n2");
  });

  test("caps at 3 notices", () => {
    const { result } = renderHook(() => useNotices());
    act(() => {
      for (let i = 0; i < 5; i++) {
        result.current.addNotice({ id: `n${i}`, title: "W", text: `Msg ${i}`, level: "warning" });
      }
    });
    expect(result.current.notices).toHaveLength(3);
  });
});

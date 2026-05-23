/**
 * useGoalEvents — goal event state slice.
 */

import { useState, useCallback } from "react";
import type { GoalEvent } from "./ws-types.ts";

export type { GoalEvent };

export function useGoalEvents() {
  const [goalEvents, setGoalEvents] = useState<GoalEvent[]>([]);

  const handleGoalEvent = useCallback((event: GoalEvent) => {
    setGoalEvents((prev) => [...prev, event].slice(-100));
  }, []);

  return { goalEvents, handleGoalEvent };
}

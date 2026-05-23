/**
 * useNotices — system notice banner state.
 */

import { useState, useCallback } from "react";
import type { SystemNotice } from "./ws-types.ts";

export type { SystemNotice };

export function useNotices() {
  const [notices, setNotices] = useState<SystemNotice[]>([]);

  const addNotice = useCallback((notice: SystemNotice) => {
    setNotices((prev) =>
      [notice, ...prev.filter((n) => n.text !== notice.text)].slice(0, 3),
    );
  }, []);

  const dismissNotice = useCallback((noticeId: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== noticeId));
  }, []);

  return { notices, addNotice, dismissNotice };
}

import React from "react";
import { CalendarEventBadge } from "./CalendarEventBadge";
import type { CalendarEvent } from "./CalendarEventBadge";

type Props = {
  date: Date | null;
  events: CalendarEvent[];
};

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function CalendarDayDetail({ date, events }: Props) {
  if (!date) {
    return (
      <div
        style={{
          padding: "24px",
          textAlign: "center",
          color: "var(--j-text-muted)",
          fontSize: "13px",
        }}
      >
        Select a day to see scheduled events
      </div>
    );
  }

  const dayEvents = events
    .filter((e) => {
      const d = new Date(e.timestamp);
      return (
        d.getFullYear() === date.getFullYear() &&
        d.getMonth() === date.getMonth() &&
        d.getDate() === date.getDate()
      );
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div style={{ padding: "16px 0" }}>
      <div
        style={{
          fontSize: "14px",
          fontWeight: 600,
          color: "var(--j-text)",
          marginBottom: "12px",
          padding: "0 4px",
        }}
      >
        {formatDate(date)}
      </div>

      {dayEvents.length === 0 ? (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            color: "var(--j-text-muted)",
            fontSize: "12px",
            background: "var(--j-surface)",
            borderRadius: "8px",
            border: "1px solid var(--j-border)",
          }}
        >
          No events scheduled for this day
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {dayEvents.map((event) => (
            <CalendarEventBadge key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

import React from "react";
import { CalendarEventBadge } from "./CalendarEventBadge";
import type { CalendarEvent } from "./CalendarEventBadge";

type Props = {
  weekStart: Date;
  selectedDate: Date | null;
  events: CalendarEvent[];
  onSelectDate: (date: Date) => void;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayHeader(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CalendarGrid({
  weekStart,
  selectedDate,
  events,
  onSelectDate,
}: Props) {
  const today = new Date();

  // Build 7 days from weekStart
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }

  function getEventsForDay(date: Date): CalendarEvent[] {
    return events.filter((e) => sameDay(new Date(e.timestamp), date));
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: "6px",
      }}
    >
      {days.map((date, i) => {
        const isToday = sameDay(date, today);
        const isSelected = selectedDate ? sameDay(date, selectedDate) : false;
        const dayEvents = getEventsForDay(date);
        const hasCommitments = dayEvents.some((e) => e.type === "commitment");
        const hasContent = dayEvents.some((e) => e.type === "content");

        return (
          <div
            key={i}
            onClick={() => onSelectDate(date)}
            style={{
              display: "flex",
              flexDirection: "column",
              background: isSelected
                ? "rgba(0, 212, 255, 0.08)"
                : "var(--j-surface)",
              borderRadius: "8px",
              border: isToday
                ? "1px solid var(--j-accent)"
                : isSelected
                ? "1px solid rgba(0, 212, 255, 0.3)"
                : "1px solid var(--j-border)",
              cursor: "pointer",
              transition: "background 0.1s, border-color 0.1s",
              overflow: "hidden",
              height: "200px",
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.background = "var(--j-surface-hover)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.background = "var(--j-surface)";
              }
            }}
          >
            {/* Day header */}
            <div
              style={{
                padding: "8px 10px 6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid var(--j-border)",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: "var(--j-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {DAY_NAMES[i]}
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? "var(--j-accent)" : "var(--j-text)",
                    marginTop: "2px",
                  }}
                >
                  {formatDayHeader(date)}
                </div>
              </div>
              {dayEvents.length > 0 && (
                <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                  {hasCommitments && (
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "var(--j-accent)",
                      }}
                    />
                  )}
                  {hasContent && (
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "#fbbf24",
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: "10px",
                      color: "var(--j-text-muted)",
                      marginLeft: "2px",
                    }}
                  >
                    {dayEvents.length}
                  </span>
                </div>
              )}
            </div>

            {/* Events */}
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "4px",
                display: "flex",
                flexDirection: "column",
                gap: "3px",
              }}
            >
              {dayEvents.map((event) => (
                <CalendarEventBadge key={event.id} event={event} compact />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import React, { useState, useRef, useCallback } from "react";

type Props = {
  onSearch: (query: string) => void;
};

export function MemorySearchBar({ onSearch }: Props) {
  const [value, setValue] = useState("");
  const timerRef = useRef<Timer | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      setValue(text);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onSearch(text.trim()), 300);
    },
    [onSearch]
  );

  const handleClear = useCallback(() => {
    setValue("");
    onSearch("");
  }, [onSearch]);

  return (
    <div style={{ position: "relative" }}>
      <span
        style={{
          position: "absolute",
          left: "14px",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--j-text-muted)",
          fontSize: "16px",
          pointerEvents: "none",
        }}
      >
        {"\u2315"}
      </span>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="Search memories — names, facts, relationships..."
        style={{
          width: "100%",
          padding: "12px 40px 12px 40px",
          borderRadius: "10px",
          border: "1px solid var(--j-border)",
          background: "var(--j-surface)",
          color: "var(--j-text)",
          fontSize: "14px",
          outline: "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
          boxSizing: "border-box",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--j-accent)";
          e.currentTarget.style.boxShadow =
            "0 0 0 3px rgba(0, 212, 255, 0.1)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--j-border)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
      {value && (
        <button
          onClick={handleClear}
          style={{
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            color: "var(--j-text-muted)",
            cursor: "pointer",
            fontSize: "16px",
            padding: "4px",
            lineHeight: 1,
          }}
        >
          {"\u2715"}
        </button>
      )}
    </div>
  );
}

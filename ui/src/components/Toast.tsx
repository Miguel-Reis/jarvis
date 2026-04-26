import React, { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: number;
  text: string;
  type: ToastType;
};

type ToastContextValue = {
  showToast: (text: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((text: string, type: ToastType = "info") => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev.slice(-3), { id, text, type }]);
    const delay = type === "error" ? 6000 : 4000;
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), delay);
  }, []);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          pointerEvents: "none",
        }}>
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 14px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: 500,
                maxWidth: "360px",
                pointerEvents: "all",
                backdropFilter: "blur(12px)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                animation: "toast-in 200ms ease",
                ...(t.type === "success" ? {
                  background: "rgba(52, 211, 153, 0.12)",
                  border: "1px solid rgba(52, 211, 153, 0.25)",
                  color: "#34D399",
                } : t.type === "error" ? {
                  background: "rgba(251, 113, 133, 0.12)",
                  border: "1px solid rgba(251, 113, 133, 0.25)",
                  color: "#FB7185",
                } : {
                  background: "rgba(139, 92, 246, 0.12)",
                  border: "1px solid rgba(139, 92, 246, 0.25)",
                  color: "rgba(167, 139, 250, 0.95)",
                }),
              }}
            >
              <span style={{ flex: 1, lineHeight: 1.4 }}>{t.text}</span>
              <button
                onClick={() => dismiss(t.id)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  opacity: 0.6,
                  fontSize: "16px",
                  lineHeight: 1,
                  padding: "0 2px",
                  flexShrink: 0,
                }}
                aria-label="Dismiss"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

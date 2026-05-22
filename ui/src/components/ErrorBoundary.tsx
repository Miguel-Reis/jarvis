import React from "react";

type Props = { children: React.ReactNode; name?: string };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name ?? "page"}]`, error, info.componentStack);
  }

  private async handleReset() {
    try {
      await fetch("/api/system/reset", { method: "POST" });
    } catch {
      // ignore — reset is best-effort
    }
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error } = this.state;

    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "16px",
        padding: "40px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: "28px" }}>⚠</div>
        <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--j-text)" }}>
          {this.props.name ? `${this.props.name} crashed` : "Something went wrong"}
        </div>
        <div style={{
          fontSize: "12px",
          color: "var(--j-text-muted)",
          fontFamily: "monospace",
          background: "var(--j-surface)",
          padding: "12px 16px",
          borderRadius: "8px",
          maxWidth: "600px",
          wordBreak: "break-word",
        }}>
          {error.message}
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 18px",
              background: "rgba(255,255,255,0.06)",
              color: "var(--j-text-dim)",
              border: "1px solid var(--j-border)",
              borderRadius: "8px",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Reload Page
          </button>
          <button
            onClick={() => this.handleReset()}
            style={{
              padding: "8px 18px",
              background: "rgba(251,113,133,0.12)",
              color: "var(--j-error)",
              border: "1px solid rgba(251,113,133,0.25)",
              borderRadius: "8px",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Reset Jarvis
          </button>
        </div>
      </div>
    );
  }
}

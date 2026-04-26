import React, { useState, useEffect, useRef, useCallback } from "react";
import { useApiData, api } from "../../hooks/useApi";

type GoogleStatus = {
  status: "not_configured" | "credentials_saved" | "connected";
  has_credentials: boolean;
  is_authenticated: boolean;
  scopes: string[];
  token_expiry: number | null;
};

export function IntegrationsPanel() {
  const { data: gStatus, loading, refetch } = useApiData<GoogleStatus>(
    "/api/auth/google/status",
    []
  );
  const [phase, setPhase] = useState<"idle" | "saving" | "authenticating">(
    "idle"
  );
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const pollRef = useRef<Timer | null>(null);

  // Clear messages after 5s
  useEffect(() => {
    if (!errorMsg && !successMsg) return;
    const t = setTimeout(() => {
      setErrorMsg("");
      setSuccessMsg("");
    }, 5000);
    return () => clearTimeout(t);
  }, [errorMsg, successMsg]);

  // Listen for postMessage from OAuth callback popup
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.data === "google-auth-complete") {
        setPhase("idle");
        setSuccessMsg("Connected! Restart JARVIS to activate Gmail and Calendar monitoring.");
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        refetch();
      }
    },
    [refetch]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSaveCredentials = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setErrorMsg("Both Client ID and Client Secret are required.");
      return;
    }
    setPhase("saving");
    setErrorMsg("");
    try {
      await api("/api/config/google", {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
        }),
      });
      setClientId("");
      setClientSecret("");
      setSuccessMsg("Credentials saved.");
      refetch();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setPhase("idle");
    }
  };

  const handleConnect = async () => {
    setErrorMsg("");
    try {
      const resp = await api<{ auth_url: string }>("/api/auth/google/init", {
        method: "POST",
      });
      setPhase("authenticating");

      // Open consent page in new window
      window.open(resp.auth_url, "google-auth", "width=600,height=700");

      // Polling fallback: check status every 3s for up to 2 minutes
      let polls = 0;
      pollRef.current = setInterval(async () => {
        polls++;
        if (polls > 40) {
          // 2 minutes
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPhase("idle");
          setErrorMsg("Authorization timed out. Try again.");
          return;
        }
        try {
          const status = await api<GoogleStatus>("/api/auth/google/status");
          if (status.is_authenticated) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setPhase("idle");
            setSuccessMsg(
              "Connected! Restart JARVIS to activate Gmail and Calendar monitoring."
            );
            refetch();
          }
        } catch {
          // Ignore poll errors
        }
      }, 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to start auth");
    }
  };

  const handleDisconnect = async () => {
    setErrorMsg("");
    try {
      await api("/api/auth/google/disconnect", { method: "POST" });
      setSuccessMsg(
        "Disconnected. Restart JARVIS to deactivate observers."
      );
      refetch();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to disconnect");
    }
  };

  if (loading || !gStatus) {
    return (
      <div className="sp-card">
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>
          Loading...
        </span>
      </div>
    );
  }

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">Integrations</h3>

      {/* Google Section */}
      <div className="sp-label">Google</div>

      {/* Messages */}
      {errorMsg && (
        <div className="sp-msg sp-msg--error" style={{ marginBottom: "8px" }}>{errorMsg}</div>
      )}
      {successMsg && (
        <div className="sp-msg sp-msg--success" style={{ marginBottom: "8px" }}>
          {successMsg}
        </div>
      )}

      {/* Not Configured — show credential form */}
      {gStatus.status === "not_configured" && phase !== "saving" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={{ fontSize: "12px", color: "var(--j-text-dim)", margin: 0, lineHeight: 1.5 }}>
            Connect Gmail and Google Calendar. You'll need OAuth2 credentials from{" "}
            <span style={{ color: "var(--j-accent)" }}>
              Google Cloud Console &gt; APIs &amp; Credentials
            </span>
            .
          </p>
          <div style={setupStepsStyle}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--j-text-muted)", marginBottom: "6px" }}>SETUP STEPS</div>
            <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "11px", color: "var(--j-text-dim)", lineHeight: 1.8 }}>
              <li>Enable <strong>Gmail API</strong> and <strong>Google Calendar API</strong> in your Google Cloud project</li>
              <li>Create an <strong>OAuth 2.0 Client ID</strong> (type: Web application)</li>
              <li>Add this <strong>Authorized redirect URI</strong>:
                <code style={codeStyle}>http://localhost:3142/api/auth/google/callback</code>
              </li>
              <li>Copy the Client ID and Client Secret below</li>
            </ol>
          </div>
          <input
            className="sp-input"
            type="text"
            placeholder="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <input
            className="sp-input"
            type="password"
            placeholder="Client Secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
          <button className="sp-btn-primary" onClick={handleSaveCredentials}>
            Save Credentials
          </button>
        </div>
      )}

      {phase === "saving" && (
        <div style={rowStyle}>
          <StatusDot color="var(--j-accent)" pulse />
          <span style={{ color: "var(--j-text-dim)", fontSize: "13px" }}>
            Saving...
          </span>
        </div>
      )}

      {/* Credentials Saved — show connect button */}
      {gStatus.status === "credentials_saved" && phase === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={rowStyle}>
            <StatusDot color="var(--j-warning)" />
            <span style={{ color: "var(--j-text)", fontSize: "13px" }}>
              Credentials configured
            </span>
          </div>
          <button className="sp-btn-primary" onClick={handleConnect}>
            Connect Google Account
          </button>
          <p style={{ fontSize: "11px", color: "var(--j-text-muted)", margin: 0 }}>
            Opens Google consent page in a new window.
          </p>
        </div>
      )}

      {/* Authenticating — waiting for callback */}
      {phase === "authenticating" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={rowStyle}>
            <StatusDot color="var(--j-accent)" pulse />
            <span style={{ color: "var(--j-text)", fontSize: "13px" }}>
              Waiting for Google authorization...
            </span>
          </div>
          <p style={{ fontSize: "11px", color: "var(--j-text-muted)", margin: 0 }}>
            Complete the consent flow in the popup window.
          </p>
        </div>
      )}

      {/* Connected — show status + disconnect */}
      {gStatus.status === "connected" && phase === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Service rows */}
          <div style={serviceCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <StatusDot color="var(--j-success)" />
              <span style={{ color: "var(--j-text)", fontSize: "13px", fontWeight: 500 }}>
                Gmail
              </span>
            </div>
            <span style={{ color: "var(--j-text-muted)", fontSize: "12px" }}>
              Read-only
            </span>
          </div>
          <div style={serviceCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <StatusDot color="var(--j-success)" />
              <span style={{ color: "var(--j-text)", fontSize: "13px", fontWeight: 500 }}>
                Google Calendar
              </span>
            </div>
            <span style={{ color: "var(--j-text-muted)", fontSize: "12px" }}>
              Read-only
            </span>
          </div>

          {/* Token info */}
          {gStatus.token_expiry && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
              }}
            >
              <span style={{ color: "var(--j-text-dim)" }}>Token expires</span>
              <span style={{ color: "var(--j-text-muted)" }}>
                {new Date(gStatus.token_expiry).toLocaleString()}
              </span>
            </div>
          )}

          <button className="sp-btn-danger" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/* -- Sub-components -- */

function StatusDot({
  color,
  pulse,
}: {
  color: string;
  pulse?: boolean;
}) {
  return (
    <span
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: color,
        display: "inline-block",
        flexShrink: 0,
        animation: pulse ? "pulse-dot 1.5s ease-in-out infinite" : undefined,
      }}
    />
  );
}

/* -- Styles -- */

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const setupStepsStyle: React.CSSProperties = {
  padding: "12px",
  background: "var(--j-bg)",
  border: "1px solid var(--j-border)",
  borderRadius: "6px",
};

const codeStyle: React.CSSProperties = {
  display: "block",
  marginTop: "4px",
  padding: "4px 8px",
  background: "var(--j-surface)",
  borderRadius: "4px",
  fontSize: "11px",
  color: "var(--j-accent)",
  wordBreak: "break-all",
};

const serviceCardStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "var(--j-bg)",
  border: "1px solid var(--j-border)",
  borderRadius: "6px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

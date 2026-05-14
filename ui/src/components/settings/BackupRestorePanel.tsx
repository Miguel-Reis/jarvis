import React, { useState } from "react";
import { api } from "../../hooks/useApi";

export function BackupRestorePanel() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const config = await api<Record<string, unknown>>("/api/system/backup/export");
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jarvis-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ text: "Config exported successfully!", type: "success" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to export", type: "error" });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const config = JSON.parse(text);
      await api("/api/system/backup/import", {
        method: "POST",
        body: JSON.stringify(config),
      });
      setMsg({ text: "Config imported! Some settings require restart.", type: "success" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to import", type: "error" });
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const handleReset = async (section: string) => {
    if (!confirm(`Are you sure you want to reset ${section} to defaults? This cannot be undone.`)) {
      return;
    }

    setResetting(true);
    try {
      await api("/api/system/backup/reset", {
        method: "POST",
        body: JSON.stringify({ section }),
      });
      setMsg({ text: `${section} reset to defaults!`, type: "success" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to reset", type: "error" });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">Backup & Restore</h3>

      {msg && (
        <div className={`sp-msg ${msg.type === "error" ? "sp-msg--error" : "sp-msg--success"}`} style={{ marginBottom: "8px" }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Export Section */}
        <div className="sp-section">
          <div className="sp-label">Export Configuration</div>
          <p className="sp-hint">
            Download your current configuration (without API keys) as a JSON file.
            Useful for backup or sharing your setup.
          </p>
          <button className="sp-btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting..." : "Download Backup"}
          </button>
        </div>

        {/* Import Section */}
        <div className="sp-section">
          <div className="sp-label">Import Configuration</div>
          <p className="sp-hint">
            Restore settings from a previously exported backup file.
            API keys and tokens are preserved for security.
          </p>
          <label className="sp-btn-secondary" style={{ cursor: "pointer", display: "inline-block" }}>
            {importing ? "Importing..." : "Select Backup File"}
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              disabled={importing}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {/* Reset Section */}
        <div className="sp-section-last">
          <div className="sp-label" style={{ color: "var(--j-error)" }}>Danger Zone</div>
          <p className="sp-hint">
            Reset configuration sections to their default values.
            This action cannot be undone.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              className="sp-btn-secondary"
              onClick={() => handleReset("heartbeat")}
              disabled={resetting}
              style={{ borderColor: "var(--j-error)", color: "var(--j-error)" }}
            >
              Reset Heartbeat
            </button>
            <button
              className="sp-btn-secondary"
              onClick={() => handleReset("tts")}
              disabled={resetting}
              style={{ borderColor: "var(--j-error)", color: "var(--j-error)" }}
            >
              Reset TTS
            </button>
            <button
              className="sp-btn-secondary"
              onClick={() => handleReset("stt")}
              disabled={resetting}
              style={{ borderColor: "var(--j-error)", color: "var(--j-error)" }}
            >
              Reset STT
            </button>
            <button
              className="sp-btn-secondary"
              onClick={() => handleReset("all")}
              disabled={resetting}
              style={{ borderColor: "var(--j-error)", color: "var(--j-error)" }}
            >
              Reset All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

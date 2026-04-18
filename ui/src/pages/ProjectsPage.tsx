import React, { useState, useCallback } from "react";
import { useApiData } from "../hooks/useApi";

type Project = {
  id: string;
  name: string;
  description: string;
  path: string;
  color: string;
  created_at: number;
  updated_at: number;
};

type ProjectsResponse = {
  projects: Project[];
  activeProjectId: string | null;
};

const COLORS = ["#6b7280","#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981","#ef4444","#06b6d4"];

export default function ProjectsPage() {
  const { data, refetch } = useApiData<ProjectsResponse>("/api/projects", []);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", path: "", color: "#6b7280" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Sync activeProjectId from API data
  const projects = data?.projects ?? [];
  const serverActiveId = data?.activeProjectId ?? null;
  const currentActiveId = activeProjectId === null ? serverActiveId : activeProjectId;

  const flash = (text: string) => { setMsg(text); setTimeout(() => setMsg(null), 3000); };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json() as { ok?: boolean; project?: Project; error?: string };
      if (d.ok) {
        setCreating(false);
        setForm({ name: "", description: "", path: "", color: "#6b7280" });
        refetch();
        flash("Project created");
      } else {
        flash(d.error ?? "Failed");
      }
    } finally { setSaving(false); }
  };

  const handleUpdate = async () => {
    if (!editId || !form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(editId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json() as { ok?: boolean; error?: string };
      if (d.ok) { setEditId(null); refetch(); flash("Saved"); }
      else flash(d.error ?? "Failed");
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this project?")) return;
    await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (currentActiveId === id) { setActiveProjectId(null); }
    refetch();
  };

  const handleSetActive = useCallback(async (id: string | null) => {
    setActiveProjectId(id);
    await fetch("/api/projects/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    flash(id ? "Project activated — agent will focus on this project" : "Project deactivated");
    refetch();
  }, []);

  const startEdit = (p: Project) => {
    setEditId(p.id);
    setForm({ name: p.name, description: p.description, path: p.path, color: p.color });
    setCreating(false);
  };

  const FormPanel = ({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel: string }) => (
    <div className="sp-card" style={{ borderColor: "rgba(139,92,246,0.3)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div className="sp-field">
            <span className="sp-field-label">Project Name *</span>
            <input className="sp-input" placeholder="e.g. Metin2 Server" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} autoFocus />
          </div>
          <div className="sp-field">
            <span className="sp-field-label">Root Path (optional)</span>
            <input className="sp-input" placeholder="e.g. /home/user/projects/metin2" value={form.path} onChange={e => setForm(f => ({...f, path: e.target.value}))} />
          </div>
        </div>
        <div className="sp-field">
          <span className="sp-field-label">Description (optional)</span>
          <input className="sp-input" placeholder="What this project is about" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
        </div>
        <div className="sp-field">
          <span className="sp-field-label">Color</span>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({...f, color: c}))} style={{
                width: "24px", height: "24px", borderRadius: "50%", background: c, border: "none", cursor: "pointer",
                outline: form.color === c ? "2px solid white" : "none", outlineOffset: "2px",
              }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button className="sp-btn-primary" onClick={onSubmit} disabled={saving || !form.name.trim()}>{saving ? "Saving…" : submitLabel}</button>
          <button className="sp-btn-secondary" onClick={() => { setCreating(false); setEditId(null); }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div>
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Projects</h2>
          <div style={{ fontSize: "12px", color: "var(--j-text-dim)", marginTop: "2px" }}>
            Set an active project to keep the agent focused and avoid context bleed between projects.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: "12px", color: "var(--j-text-muted)" }}>{msg}</span>}
        {!creating && !editId && (
          <button className="sp-btn-primary" onClick={() => { setCreating(true); setForm({ name: "", description: "", path: "", color: "#6b7280" }); }}>
            + New Project
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && <FormPanel onSubmit={handleCreate} submitLabel="Create Project" />}

      {/* Active project indicator */}
      {currentActiveId && (
        <div style={{
          padding: "10px 16px", borderRadius: "8px",
          background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)",
          fontSize: "12px", color: "#34D399",
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34D399", flexShrink: 0 }} />
          Agent is focused on: <strong>{projects.find(p => p.id === currentActiveId)?.name ?? "Unknown"}</strong>
          <button className="sp-btn-secondary" style={{ marginLeft: "auto", padding: "2px 10px", fontSize: "11px" }} onClick={() => handleSetActive(null)}>
            Clear focus
          </button>
        </div>
      )}

      {/* Project list */}
      {projects.length === 0 && !creating ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--j-text-dim)", fontSize: "13px" }}>
          No projects yet. Create one to help the agent stay focused.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {projects.map(p => (
            <div key={p.id}>
              {editId === p.id ? (
                <FormPanel onSubmit={handleUpdate} submitLabel="Save Changes" />
              ) : (
                <div style={{
                  display: "flex", alignItems: "center", gap: "14px",
                  padding: "14px 18px", borderRadius: "10px",
                  background: currentActiveId === p.id ? "rgba(52,211,153,0.05)" : "var(--j-surface)",
                  border: `1px solid ${currentActiveId === p.id ? "rgba(52,211,153,0.2)" : "var(--j-border)"}`,
                }}>
                  <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: p.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--j-text)" }}>{p.name}</div>
                    {p.description && <div style={{ fontSize: "12px", color: "var(--j-text-muted)", marginTop: "2px" }}>{p.description}</div>}
                    {p.path && <div style={{ fontSize: "11px", color: "var(--j-text-dim)", marginTop: "2px", fontFamily: "monospace" }}>{p.path}</div>}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    {currentActiveId === p.id ? (
                      <button className="sp-btn-secondary" style={{ padding: "5px 12px", fontSize: "11px", color: "#34D399" }} onClick={() => handleSetActive(null)}>
                        Active ✓
                      </button>
                    ) : (
                      <button className="sp-btn-secondary" style={{ padding: "5px 12px", fontSize: "11px" }} onClick={() => handleSetActive(p.id)}>
                        Set Active
                      </button>
                    )}
                    <button className="sp-btn-secondary" style={{ padding: "5px 10px", fontSize: "11px" }} onClick={() => startEdit(p)}>Edit</button>
                    <button className="sp-btn-danger" style={{ padding: "5px 10px", fontSize: "11px" }} onClick={() => handleDelete(p.id)}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

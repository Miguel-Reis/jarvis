import React, { useEffect, useMemo, useState } from "react";
import { api, useApiData } from "../../hooks/useApi";

type UserProfileQuestion = {
  id: string;
  step: number;
  step_title: string;
  label: string;
  prompt: string;
  description: string;
  placeholder?: string;
  multiline?: boolean;
};

type UserProfileRecord = {
  version: 1;
  answers: Record<string, string>;
  qualities: string[];
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type UserProfilePreset = {
  id: string;
  name: string;
  description: string;
};

type UserProfileResponse = {
  questions: UserProfileQuestion[];
  profile: UserProfileRecord | null;
  answered_count: number;
  total_questions: number;
  has_profile: boolean;
};

type PresetsResponse = {
  presets: UserProfilePreset[];
};

const PREDEFINED_QUALITIES = [
  "Pensamento Crítico",
  "Criatividade",
  "Atenção a Detalhes",
  "Comunicação Clara",
  "Foco em Resultados",
  "Colaboração",
  "Adaptabilidade",
  "Liderança",
  "Empatia",
  "Inovação",
  "Persistência",
  "Curiosidade Intelectual",
];

export function UserProfilePanel() {
  const { data, loading, error, refetch } = useApiData<UserProfileResponse>("/api/user-profile", []);
  const [presets, setPresets] = useState<UserProfilePreset[]>([]);
  const [editing, setEditing] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qualities, setQualities] = useState<string[]>([]);
  const [customQuality, setCustomQuality] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user-profile/presets")
      .then(r => r.json())
      .then((data: PresetsResponse) => setPresets(data.presets))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!data) return;
    setAnswers(data.profile?.answers ?? {});
    setQualities(data.profile?.qualities ?? []);
  }, [data]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const steps = useMemo(() => {
    if (!data) return [];
    const grouped = new Map<number, { title: string; questions: UserProfileQuestion[] }>();
    for (const question of data.questions) {
      const group = grouped.get(question.step) ?? { title: question.step_title, questions: [] };
      group.questions.push(question);
      grouped.set(question.step, group);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([step, group]) => ({ step, title: group.title, questions: group.questions }));
  }, [data]);

  const currentStep = steps[stepIndex];
  const liveAnsweredCount = useMemo(() => {
    if (!data) return 0;
    return data.questions.filter((question) => {
      const value = answers[question.id];
      return typeof value === "string" && value.trim().length > 0;
    }).length;
  }, [answers, data]);
  const answeredCount = editing ? liveAnsweredCount : data?.answered_count ?? 0;
  const completionPct = data ? Math.round((answeredCount / Math.max(data.total_questions, 1)) * 100) : 0;

  const saveProfile = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const resp = await api<{ message: string }>("/api/user-profile", {
        method: "POST",
        body: JSON.stringify({ answers, qualities }),
      });
      setMessage({ text: resp.message, type: "success" });
      setEditing(false);
      refetch();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to save user profile", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const clearProfile = async () => {
    if (!window.confirm("Clear the saved user profile context?")) return;
    try {
      await api<{ message: string }>("/api/user-profile/clear", { method: "POST" });
      setAnswers({});
      setEditing(false);
      setStepIndex(0);
      setMessage({ text: "User profile cleared.", type: "success" });
      refetch();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to clear user profile", type: "error" });
    }
  };

  const applyPreset = async (presetId: string) => {
    setLoadingPreset(presetId);
    setMessage(null);
    try {
      const resp = await api<{ message: string }>("/api/user-profile/presets", {
        method: "POST",
        body: JSON.stringify({ presetId }),
      });
      setMessage({ text: resp.message, type: "success" });
      setEditing(false);
      setStepIndex(0);
      refetch();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to apply preset", type: "error" });
    } finally {
      setLoadingPreset(null);
    }
  };

  if (error && !data) {
    return (
      <div className="sp-card">
        <span style={{ color: "#FB7185", fontSize: "13px" }}>{error}</span>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="sp-card">
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>Loading user profile wizard...</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div className="sp-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "280px" }}>
            <h3 className="sp-card-title" style={{ margin: 0 }}>Initial User Context</h3>
            <p style={{ fontSize: "13px", color: "var(--j-text-muted)", margin: "8px 0 0 0", lineHeight: 1.6 }}>
              This wizard gives JARVIS durable context about who you are, what matters to you, and how you prefer to work.
              It is meant to be the initial context dump you can refine later.
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button className="sp-btn-primary" onClick={() => { setEditing(true); setStepIndex(0); }}>
              {data.has_profile ? "Edit Profile" : "Start Wizard"}
            </button>
            {data.has_profile && (
              <button className="sp-btn-secondary" onClick={clearProfile}>
                Clear
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop: "18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "8px" }}>
            <span style={{ color: "var(--j-text-muted)" }}>Completion</span>
            <span style={{ color: "var(--j-text)" }}>{answeredCount}/{data.total_questions} answered</span>
          </div>
          <div style={{ height: "6px", borderRadius: "999px", background: "var(--j-bg)", overflow: "hidden" }}>
            <div style={{ width: `${completionPct}%`, height: "100%", background: "var(--j-accent)" }} />
          </div>
        </div>

        {data.profile?.updated_at && (
          <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--j-text-muted)" }}>
            Last updated: {new Date(data.profile.updated_at).toLocaleString()}
          </div>
        )}
      </div>

      {message && (
        <div className={`sp-msg ${message.type === "success" ? "sp-msg--success" : "sp-msg--error"}`}>
          {message.text}
        </div>
      )}

      {presets.length > 0 && (
        <div className="sp-card">
          <h3 className="sp-card-title" style={{ margin: 0 }}>Quick Start Profiles</h3>
          <p style={{ fontSize: "13px", color: "var(--j-text-muted)", margin: "8px 0 16px 0", lineHeight: 1.6 }}>
            Choose a preset profile to quickly configure JARVIS with a professional persona.
          </p>
          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {presets.map((preset) => (
              <div
                key={preset.id}
                style={{
                  border: "1px solid var(--j-border)",
                  borderRadius: "8px",
                  padding: "16px",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  background: "var(--j-bg-secondary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--j-accent)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--j-border)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
                onClick={() => applyPreset(preset.id)}
              >
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--j-text)", marginBottom: "6px" }}>
                  {preset.name}
                </div>
                <div style={{ fontSize: "12px", color: "var(--j-text-muted)", lineHeight: 1.5 }}>
                  {preset.description}
                </div>
                {loadingPreset === preset.id && (
                  <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--j-accent)" }}>
                    Applying...
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && currentStep ? (
        <div className="sp-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--j-text-muted)", marginBottom: "6px" }}>
                Step {stepIndex + 1} of {steps.length}
              </div>
              <h3 style={{ margin: 0, fontSize: "16px", color: "var(--j-text)" }}>{currentStep.title}</h3>
            </div>
            <button className="sp-btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {currentStep.questions.map((question) => (
              <label key={question.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--j-text)" }}>{question.label}</div>
                  <div style={{ fontSize: "12px", color: "var(--j-text-muted)", marginTop: "4px", lineHeight: 1.5 }}>
                    {question.prompt} {question.description}
                  </div>
                </div>

                {question.multiline ? (
                  <textarea
                    className="sp-textarea"
                    value={answers[question.id] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))}
                    placeholder={question.placeholder}
                    rows={5}
                  />
                ) : (
                  <input
                    className="sp-input"
                    value={answers[question.id] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))}
                    placeholder={question.placeholder}
                  />
                )}
              </label>
            ))}
          </div>

          {stepIndex === steps.length - 1 && (
            <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid var(--j-border)" }}>
              <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", color: "var(--j-text)" }}>Qualidades & Especializações</h4>
              <p style={{ fontSize: "12px", color: "var(--j-text-muted)", marginBottom: "16px", lineHeight: 1.5 }}>
                Selecione qualidades adicionais para complementar seu profile. Estas serão usadas para dar mais contexto ao JARVIS sobre como você pensa e trabalha.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px", marginBottom: "16px" }}>
                {PREDEFINED_QUALITIES.map((quality) => (
                  <label
                    key={quality}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 12px",
                      background: qualities.includes(quality) ? "rgba(139, 92, 246, 0.15)" : "rgba(255,255,255,0.02)",
                      border: qualities.includes(quality) ? "1px solid var(--j-accent)" : "1px solid var(--j-border)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={qualities.includes(quality)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setQualities([...qualities, quality]);
                        } else {
                          setQualities(qualities.filter((q) => q !== quality));
                        }
                      }}
                      style={{ accentColor: "var(--j-accent)" }}
                    />
                    <span style={{ fontSize: "12px", color: "var(--j-text)" }}>{quality}</span>
                  </label>
                ))}
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <input
                  className="sp-input"
                  placeholder="Adicionar qualidade personalizada..."
                  value={customQuality}
                  onChange={(e) => setCustomQuality(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customQuality.trim()) {
                      e.preventDefault();
                      if (!qualities.includes(customQuality.trim())) {
                        setQualities([...qualities, customQuality.trim()]);
                      }
                      setCustomQuality("");
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  className="sp-btn-secondary"
                  onClick={() => {
                    if (customQuality.trim() && !qualities.includes(customQuality.trim())) {
                      setQualities([...qualities, customQuality.trim()]);
                      setCustomQuality("");
                    }
                  }}
                >
                  Adicionar
                </button>
              </div>

              {qualities.length > 0 && (
                <div style={{ marginTop: "16px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {qualities.map((q) => (
                    <span
                      key={q}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 10px",
                        background: "rgba(139, 92, 246, 0.2)",
                        border: "1px solid rgba(139, 92, 246, 0.4)",
                        borderRadius: "12px",
                        fontSize: "11px",
                        color: "var(--j-text)",
                      }}
                    >
                      {q}
                      <button
                        onClick={() => setQualities(qualities.filter((item) => item !== q))}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--j-text-muted)",
                          cursor: "pointer",
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "24px", flexWrap: "wrap" }}>
            <button
              className="sp-btn-secondary"
              onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
              disabled={stepIndex === 0}
            >
              Previous
            </button>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {stepIndex < steps.length - 1 ? (
                <button className="sp-btn-primary" onClick={() => setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))}>
                  Next
                </button>
              ) : (
                <button className="sp-btn-primary" onClick={saveProfile} disabled={saving}>
                  {saving ? "Saving..." : "Save Profile"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : data.has_profile ? (
        <div className="sp-card">
          <h3 className="sp-card-title">Saved Context</h3>

          {data.profile?.qualities && data.profile.qualities.length > 0 && (
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--j-text-muted)", marginBottom: "10px" }}>
                Qualidades & Especializações
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {data.profile.qualities.map((q) => (
                  <span
                    key={q}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "6px 12px",
                      background: "rgba(139, 92, 246, 0.2)",
                      border: "1px solid rgba(139, 92, 246, 0.4)",
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: "var(--j-text)",
                    }}
                  >
                    {q}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gap: "14px" }}>
            {steps.map((step) => {
              const answeredQuestions = step.questions.filter((question) => {
                const value = data.profile?.answers[question.id];
                return typeof value === "string" && value.trim().length > 0;
              });
              if (answeredQuestions.length === 0) return null;

              return (
                <div key={step.step} style={{ border: "1px solid var(--j-border)", borderRadius: "8px", padding: "16px" }}>
                  <div style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--j-text-muted)", marginBottom: "10px" }}>
                    {step.title}
                  </div>
                  <div style={{ display: "grid", gap: "12px" }}>
                    {answeredQuestions.map((question) => (
                      <div key={question.id}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--j-text)" }}>{question.label}</div>
                        <div style={{ fontSize: "13px", color: "var(--j-text-muted)", marginTop: "4px", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                          {data.profile?.answers[question.id]}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="sp-card">
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
            No user profile has been saved yet. Start the wizard to give JARVIS a strong initial understanding of your identity,
            goals, preferences, routines, and context.
          </div>
        </div>
      )}
    </div>
  );
}


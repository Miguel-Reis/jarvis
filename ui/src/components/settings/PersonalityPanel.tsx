import React from "react";
import { useApiData } from "../../hooks/useApi";

type PersonalityModel = {
  core_traits: string[];
  learned_preferences: {
    verbosity: number;
    formality: number;
    humor_level: number;
    emoji_usage: boolean;
    preferred_format: string;
  };
  relationship: {
    first_interaction: number;
    message_count: number;
    trust_level: number;
    shared_references: string[];
  };
};

export function PersonalityPanel() {
  const { data: personality, loading } = useApiData<PersonalityModel>("/api/personality", []);

  if (loading || !personality) {
    return <div className="sp-card"><span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>Loading personality...</span></div>;
  }

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">Personality</h3>

      {/* Core traits */}
      <div style={{ marginBottom: "16px" }}>
        <div className="sp-label">Core Traits</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {personality.core_traits.map((trait) => (
            <span key={trait} style={tagStyle}>{trait}</span>
          ))}
        </div>
      </div>

      {/* Learned preferences */}
      <div style={{ marginBottom: "16px" }}>
        <div className="sp-label">Learned Preferences</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <SliderDisplay label="Verbosity" value={personality.learned_preferences.verbosity} max={10} />
          <SliderDisplay label="Formality" value={personality.learned_preferences.formality} max={10} />
          <SliderDisplay label="Humor" value={personality.learned_preferences.humor_level} max={10} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
            <span style={{ color: "var(--j-text-dim)" }}>Emoji Usage</span>
            <span style={{ color: personality.learned_preferences.emoji_usage ? "var(--j-success)" : "var(--j-text-muted)" }}>
              {personality.learned_preferences.emoji_usage ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
            <span style={{ color: "var(--j-text-dim)" }}>Preferred Format</span>
            <span style={{ color: "var(--j-text)", textTransform: "capitalize" }}>
              {personality.learned_preferences.preferred_format}
            </span>
          </div>
        </div>
      </div>

      {/* Relationship */}
      <div>
        <div className="sp-label">Relationship</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--j-text-dim)" }}>Messages Exchanged</span>
            <span style={{ color: "var(--j-accent)", fontWeight: 600 }}>{personality.relationship.message_count}</span>
          </div>
          <SliderDisplay label="Trust Level" value={personality.relationship.trust_level} max={10} />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--j-text-dim)" }}>First Interaction</span>
            <span style={{ color: "var(--j-text)" }}>
              {new Date(personality.relationship.first_interaction).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SliderDisplay({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "4px" }}>
        <span style={{ color: "var(--j-text-dim)" }}>{label}</span>
        <span style={{ color: "var(--j-text)" }}>{value}/{max}</span>
      </div>
      <div style={{ height: "4px", background: "var(--j-bg)", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--j-accent)", borderRadius: "2px", transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

const tagStyle: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: "12px",
  background: "rgba(0, 212, 255, 0.1)",
  border: "1px solid rgba(0, 212, 255, 0.2)",
  color: "var(--j-accent)",
  fontSize: "12px",
  textTransform: "capitalize",
};

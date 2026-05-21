import React, { useState, useMemo, useCallback } from "react";
import { useApiData, api } from "../hooks/useApi";
import { useToast } from "../components/Toast";
import "../styles/knowledge.css";

type Entity = {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  source: string | null;
};

type Fact = {
  id: string;
  subject_id: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string | null;
  created_at: number;
};

type RelWithEntities = {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  from_entity: { id: string; name: string; type: string };
  to_entity: { id: string; name: string; type: string };
};

const ENTITY_TYPES = ["all", "person", "project", "tool", "place", "concept", "event"] as const;
type EntityTypeName = "person" | "project" | "tool" | "place" | "concept" | "event";

const TYPE_COLORS: Record<string, string> = {
  person: "#60A5FA",
  project: "#8B5CF6",
  tool: "#A78BFA",
  place: "#FBBF24",
  concept: "#34D399",
  event: "#22D3EE",
};

export default function KnowledgePage() {
  const { showToast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateEntity, setShowCreateEntity] = useState(false);
  const [showAddFact, setShowAddFact] = useState(false);
  const [newFactPredicate, setNewFactPredicate] = useState("");
  const [newFactObject, setNewFactObject] = useState("");
  const [addingFact, setAddingFact] = useState(false);

  // Build entity query
  const entityParams = useMemo(() => {
    const p = new URLSearchParams();
    if (typeFilter !== "all") p.set("type", typeFilter);
    if (search) p.set("q", search);
    return p.toString();
  }, [typeFilter, search]);

  const { data: entities, loading: entitiesLoading, refetch: refetchEntities } = useApiData<Entity[]>(
    `/api/vault/entities${entityParams ? `?${entityParams}` : ""}`,
    [entityParams]
  );

  // Fetch facts + relationships for selected entity
  const { data: facts, loading: factsLoading, refetch: refetchFacts } = useApiData<Fact[]>(
    selectedId ? `/api/vault/entities/${selectedId}/facts` : null,
    [selectedId]
  );

  const { data: rels, loading: relsLoading } = useApiData<RelWithEntities[]>(
    selectedId ? `/api/vault/entities/${selectedId}/relationships` : null,
    [selectedId]
  );

  const handleNavigateToEntity = (entityId: string) => {
    setSelectedId(entityId);
  };

  const handleDeleteEntity = useCallback(async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete entity "${name}"? This will also remove its facts.`)) return;
    try {
      await api(`/api/vault/entities/${id}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      refetchEntities();
      showToast("Entity deleted", "success");
    } catch {
      showToast("Failed to delete entity", "error");
    }
  }, [selectedId, refetchEntities, showToast]);

  const handleDeleteFact = useCallback(async (factId: string) => {
    try {
      await api(`/api/vault/facts/${factId}`, { method: "DELETE" });
      refetchFacts();
      showToast("Fact deleted", "success");
    } catch {
      showToast("Failed to delete fact", "error");
    }
  }, [refetchFacts, showToast]);

  const handleAddFact = useCallback(async () => {
    if (!selectedId || !newFactPredicate.trim() || !newFactObject.trim()) return;
    setAddingFact(true);
    try {
      await api(`/api/vault/entities/${selectedId}/facts`, {
        method: "POST",
        body: JSON.stringify({ predicate: newFactPredicate.trim(), object: newFactObject.trim() }),
      });
      setNewFactPredicate("");
      setNewFactObject("");
      setShowAddFact(false);
      refetchFacts();
      showToast("Fact added", "success");
    } catch {
      showToast("Failed to add fact", "error");
    } finally {
      setAddingFact(false);
    }
  }, [selectedId, newFactPredicate, newFactObject, refetchFacts, showToast]);

  return (
    <div className="kb-page">
      <div className="kb-atmosphere" />

      {/* Header */}
      <div className="kb-header">
        <span className="kb-header-title">Knowledge Browser</span>
        <span className="kb-header-count">{entities?.length ?? 0}</span>
        <div className="kb-header-spacer" />
        <button
          className="kb-new-btn"
          onClick={() => setShowCreateEntity(true)}
          aria-label="Create new entity"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          New Entity
        </button>
      </div>

      {/* Three columns */}
      <div className="kb-columns">

        {/* Entities column */}
        <div className="kb-col kb-col-entities">
          <div className="kb-col-header">
            <span className="kb-col-title">Entities</span>
            <span className="kb-col-count">{entities?.length ?? 0}</span>
          </div>
          <div className="kb-col-search">
            <input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="kb-type-filters">
            {ENTITY_TYPES.map(t => (
              <button
                key={t}
                className={`kb-type-filter${typeFilter === t ? " active" : ""}`}
                onClick={() => setTypeFilter(t)}
              >
                {t === "all" ? "All" : t}
              </button>
            ))}
          </div>
          <div className="kb-col-body">
            {entitiesLoading && <div className="kb-loading">Loading...</div>}
            {!entitiesLoading && entities && entities.length === 0 && (
              <div className="kb-empty">No entities found</div>
            )}
            {entities?.map(entity => {
              const color = TYPE_COLORS[entity.type] || "#8B5CF6";
              return (
                <div
                  key={entity.id}
                  className={`kb-entity${entity.id === selectedId ? " selected" : ""}`}
                  onClick={() => setSelectedId(entity.id)}
                >
                  <div className="ke-dot" style={{ background: color }} />
                  <span className="ke-name">{entity.name}</span>
                  <span className="ke-type">{entity.type}</span>
                  <button
                    className="ke-delete-btn"
                    onClick={(e) => handleDeleteEntity(entity.id, entity.name, e)}
                    title="Delete entity"
                    aria-label={`Delete ${entity.name}`}
                  >×</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Facts column */}
        <div className="kb-col kb-col-facts">
          <div className="kb-col-header">
            <span className="kb-col-title">Facts</span>
            <span className="kb-col-count">{facts?.length ?? 0}</span>
            {selectedId && (
              <button
                className="kb-add-btn"
                onClick={() => setShowAddFact(v => !v)}
                title="Add fact"
                aria-label="Add fact"
              >+ Add</button>
            )}
          </div>

          {/* Add fact inline form */}
          {showAddFact && selectedId && (
            <div className="kb-add-fact-form">
              <input
                className="kb-fact-input"
                placeholder="Predicate (e.g. works at)"
                value={newFactPredicate}
                onChange={e => setNewFactPredicate(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddFact()}
                autoFocus
              />
              <input
                className="kb-fact-input"
                placeholder="Value (e.g. Anthropic)"
                value={newFactObject}
                onChange={e => setNewFactObject(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddFact()}
              />
              <div className="kb-fact-form-actions">
                <button
                  className="kb-fact-save-btn"
                  onClick={handleAddFact}
                  disabled={addingFact || !newFactPredicate.trim() || !newFactObject.trim()}
                >
                  {addingFact ? "Saving…" : "Save"}
                </button>
                <button
                  className="kb-fact-cancel-btn"
                  onClick={() => { setShowAddFact(false); setNewFactPredicate(""); setNewFactObject(""); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="kb-col-body">
            {!selectedId && <div className="kb-empty">Select an entity</div>}
            {selectedId && factsLoading && <div className="kb-loading">Loading facts...</div>}
            {selectedId && !factsLoading && facts && facts.length === 0 && !showAddFact && (
              <div className="kb-empty">No facts recorded</div>
            )}
            {facts?.map((fact, i) => {
              const confPct = Math.round(fact.confidence * 100);
              const confColor = confPct >= 90 ? "#34D399" : confPct >= 70 ? "#FBBF24" : "#FB7185";
              return (
                <div key={fact.id} className="kb-fact" style={{ animationDelay: `${i * 0.03}s` }}>
                  <div className="kf-pred">{fact.predicate}</div>
                  <div className="kf-obj">{fact.object}</div>
                  <div className="kf-meta">
                    <span>{confPct}%</span>
                    <span className="kf-conf-bar"><span className="kf-conf-fill" style={{ width: `${confPct}%`, background: confColor }} /></span>
                    {fact.source && <span>{fact.source}</span>}
                    <button
                      className="kf-delete-btn"
                      onClick={() => handleDeleteFact(fact.id)}
                      title="Delete fact"
                      aria-label="Delete fact"
                    >×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Relationships column */}
        <div className="kb-col kb-col-rels">
          <div className="kb-col-header">
            <span className="kb-col-title">Relationships</span>
            <span className="kb-col-count">{rels?.length ?? 0}</span>
          </div>
          <div className="kb-col-body">
            {!selectedId && <div className="kb-empty">Select an entity</div>}
            {selectedId && relsLoading && <div className="kb-loading">Loading...</div>}
            {selectedId && !relsLoading && rels && rels.length === 0 && (
              <div className="kb-empty">No relationships found</div>
            )}
            {rels?.map((rel, i) => {
              const isFrom = rel.from_id === selectedId;
              const other = isFrom ? rel.to_entity : rel.from_entity;
              const otherColor = TYPE_COLORS[other.type] || "#8B5CF6";
              return (
                <div
                  key={rel.id}
                  className="kb-rel"
                  style={{ animationDelay: `${i * 0.03}s` }}
                  onClick={() => handleNavigateToEntity(other.id)}
                >
                  <div className="kr-dot" style={{ background: otherColor }} />
                  <span className="kr-type">{rel.type}</span>
                  <span className="kr-arrow">{isFrom ? "\u2192" : "\u2190"}</span>
                  <span className="kr-name">{other.name}</span>
                  <span className="kr-etype">{other.type}</span>
                  <span className="kr-nav">Go &rarr;</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create Entity Modal */}
      {showCreateEntity && (
        <CreateEntityModal
          onClose={() => setShowCreateEntity(false)}
          onCreated={(id) => {
            setShowCreateEntity(false);
            refetchEntities();
            setSelectedId(id);
            showToast("Entity created", "success");
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------
   Create Entity Modal
   ---------------------------------------------------------------- */
function CreateEntityModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<EntityTypeName>("concept");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const entity = await api<{ id: string }>("/api/vault/entities", {
        method: "POST",
        body: JSON.stringify({ type, name: name.trim() }),
      });
      onCreated(entity.id);
    } catch {
      showToast("Failed to create entity", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="kb-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Create entity">
        <div className="kb-modal-header">
          <span className="kb-modal-title">New Entity</span>
          <button className="kb-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="kb-modal-body">
          <label className="kb-modal-label">Name</label>
          <input
            className="kb-modal-input"
            placeholder="Entity name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <label className="kb-modal-label" style={{ marginTop: "14px" }}>Type</label>
          <div className="kb-modal-type-grid">
            {(["person", "project", "tool", "place", "concept", "event"] as EntityTypeName[]).map(t => (
              <button
                key={t}
                className={`kb-modal-type-btn${type === t ? " active" : ""}`}
                onClick={() => setType(t)}
                style={type === t ? { borderColor: TYPE_COLORS[t], color: TYPE_COLORS[t], background: `${TYPE_COLORS[t]}18` } : {}}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="kb-modal-footer">
          <button className="kb-modal-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="kb-modal-create-btn"
            onClick={handleCreate}
            disabled={saving || !name.trim()}
          >
            {saving ? "Creating…" : "Create Entity"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useApiData } from "../../hooks/useApi";

type RoleInfo = {
  active_role: string;
  role: {
    id: string;
    name: string;
    authority_level: number;
    tools: string[];
    sub_roles: Array<{
      role_id: string;
      name: string;
      description: string;
    }>;
  } | null;
};

export function RolePanel() {
  const { data: roleInfo, loading } = useApiData<RoleInfo>("/api/roles", []);

  if (loading || !roleInfo) {
    return <div className="sp-card"><span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>Loading...</span></div>;
  }

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">Active Role</h3>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
          <span style={{ color: "var(--j-text-dim)" }}>Role</span>
          <span style={{ color: "var(--j-accent)", fontWeight: 600 }}>
            {roleInfo.role?.name ?? roleInfo.active_role}
          </span>
        </div>

        {roleInfo.role && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--j-text-dim)" }}>Authority</span>
              <span style={{ color: "var(--j-text)" }}>{roleInfo.role.authority_level}/10</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--j-text-dim)" }}>Tools</span>
              <span style={{ color: "var(--j-text)" }}>{roleInfo.role.tools.join(", ")}</span>
            </div>
          </>
        )}

        {/* Sub-roles / Specialists */}
        {roleInfo.role && roleInfo.role.sub_roles.length > 0 && (
          <div style={{ borderTop: "1px solid var(--j-border)", paddingTop: "12px", marginTop: "4px" }}>
            <div className="sp-label">Available Specialists ({roleInfo.role.sub_roles.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {roleInfo.role.sub_roles.map((sr) => (
                <div
                  key={sr.role_id}
                  style={{
                    padding: "8px 12px",
                    background: "var(--j-bg)",
                    border: "1px solid var(--j-border)",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: 500, color: "var(--j-text)", marginBottom: "2px" }}>
                    {sr.name}
                  </div>
                  <div style={{ color: "var(--j-text-muted)", fontSize: "11px" }}>
                    {sr.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


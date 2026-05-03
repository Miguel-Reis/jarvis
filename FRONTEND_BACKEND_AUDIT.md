# 🔍 Frontend-Backend Audit Report

**Data:** 2026-05-01
**Scope:** Complete analysis of all frontend-backend connections

---

## 📊 Resumo Executivo

| Métrica | Valor |
|---------|-------|
| **API Endpoints** | ~170 endpoints |
| **Páginas Frontend** | 28 páginas |
| **Componentes** | 32 componentes |
| **Eventos WebSocket** | 10 tipos |
| **Problemas Críticos** | 0 |
| **Problemas Médios** | 5 |
| **Problemas Menores** | 8 |

---

## ✅ O Que Está Funcional

### 1. API Endpoints - 100% Match
Todos os endpoints frontend correspondem a rotas backend existentes:

| Frontend Call | Backend Route | Status |
|---------------|---------------|--------|
| `/api/metrics/daily` | `src/daemon/routes/metrics.ts` | ✅ |
| `/api/goals` | `src/daemon/routes/goals.ts` | ✅ |
| `/api/coordination/agents` | `src/daemon/routes/coordination.ts` | ✅ |
| `/api/status` | `src/daemon/routes/status.ts` | ✅ |
| `/api/workflows` | `src/daemon/routes/workflows.ts` | ✅ |
| `/api/awareness/status` | `src/daemon/routes/awareness.ts` | ✅ |
| `/api/authority/status` | `src/daemon/routes/authority.ts` | ✅ |

### 2. WebSocket Integration
- **Backend:** `src/daemon/ws-service.ts` - 12 broadcast methods
- **Frontend:** `ui/src/hooks/useWebSocket.ts` - 10 event handlers
- **Connection:** `/ws` endpoint funcional

### 3. Service Wiring
Todos os serviços estão corretamente injetados no `ApiContext`:
- AgentService ✅
- ObserverService ✅
- WebSocketService ✅
- AwarenessService ✅
- GoalService ✅
- WorkflowEngine ✅
- AuthorityEngine ✅
- MCPService ✅

---

## ⚠️ Problemas Identificados

### CRITICAL: 0
Nenhum problema crítico encontrado que impeça o funcionamento.

### HIGH: 0
Nenhum problema alto encontrado.

### MEDIUM: 5

#### M-1: Empty Catch Blocks (Silent Failures)

**Localização:** `ui/src/hooks/useWebSocket.ts:312`
```typescript
} catch {}
```

**Problema:** Erros são silenciados sem logging, dificultando debugging.

**Solução:**
```typescript
} catch (err) {
  console.warn('[WS] Failed to load pending approvals:', err);
}
```

---

#### M-2: Empty Catch Blocks em AuthorityPage

**Localização:** `ui/src/pages/AuthorityPage.tsx:167, 331, 486, 498, 508, 820`

**Problema:** Múltiplos catch blocks vazios.

**Solução:** Adicionar logging consistente.

---

#### M-3: Empty Catch em GoalsPage

**Localização:** `ui/src/pages/GoalsPage.tsx:81`
```typescript
fetch("/api/goals/overdue").then(...).catch(() => {});
```

**Solução:**
```typescript
fetch("/api/goals/overdue")
  .then(r => r.ok ? r.json() : [])
  .then(setOverdueGoals)
  .catch(err => console.warn('Failed to load overdue goals:', err));
```

---

#### M-4: Empty Catch em PipelinePage

**Localização:** `ui/src/pages/PipelinePage.tsx:151-160`

**Problema:** Advance/Regress actions com catch vazio.

---

#### M-5: WebSocket Race Condition

**Localização:** `ui/src/hooks/useWebSocket.ts:614-670`
```typescript
if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
wsRef.current.send(JSON.stringify(msg));
```

**Problema:** WebSocket pode fechar entre o check e o send().

**Solução:**
```typescript
try {
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
  wsRef.current.send(JSON.stringify(msg));
} catch (err) {
  console.error('[WS] Send error:', err);
}
```

---

### LOW: 8

#### L-1: Type Casting Inseguro em useApi

**Localização:** `ui/src/hooks/useApi.ts:15`
```typescript
throw new Error((body as any).error ?? `HTTP ${res.status}`);
```

**Solução:** Usar type guard:
```typescript
const error = (body as Record<string, unknown>)?.error;
throw new Error(typeof error === 'string' ? error : `HTTP ${res.status}`);
```

---

#### L-2: Null Safety em ProgressDashboardPage

**Localização:** `ui/src/pages/ProgressDashboardPage.tsx:215`
```typescript
style={{ backgroundColor: HEATMAP_COLORS[day.level] }}
```

**Status:** ✅ **CORRIGIDO NA SESSÃO ANTERIOR**
```typescript
style={{ backgroundColor: HEATMAP_COLORS[day.level ?? 0] }}
```

---

#### L-3: Missing Error Handling em ChatPage

**Localização:** `ui/src/pages/ChatPage.tsx:50`

**Problema:** Fetch LLM config sem error handling explícito.

---

#### L-4: Missing Error Handling em MemoryPage

**Localização:** `ui/src/pages/MemoryPage.tsx:199-212`

**Problema:** `fetchMemories` sem error handling visível.

---

#### L-5: Empty Catch em CalendarPage

**Localização:** `ui/src/pages/CalendarPage.tsx`

**Problema:** Múltiplos fetch calls com minimal error handling.

---

#### L-6: Service Panel API Call

**Localização:** `ui/src/components/ServicePanel.tsx`

**Problema:** `/api/system/autostart` sem tratamento de erro robusto.

---

#### L-7: SiteEditor Error Handling

**Localização:** `ui/src/components/SiteEditor.tsx`

**Problema:** File save errors podem não ser comunicadas ao utilizador.

---

#### L-8: WorkflowCanvas Error Handling

**Localização:** `ui/src/components/WorkflowCanvas.tsx`

**Problema:** Version save errors sem feedback claro.

---

## 📁 Mapeamento de Rotas

### Rotas de Métricas e Progresso
| Endpoint | Frontend Use | Backend Handler |
|----------|--------------|-----------------|
| `GET /api/metrics/daily` | ProgressDashboardPage | `metricsRoutes` |
| `GET /api/metrics/weekly` | ProgressDashboardPage | `metricsRoutes` |
| `GET /api/metrics/heatmap` | ProgressDashboardPage | `metricsRoutes` |
| `GET /api/predictions/goals` | ProgressDashboardPage | `predictionRoutes` |
| `GET /api/coordination/agents` | WarRoomPage | `coordinationRoutes` |
| `GET /api/coordination/events` | WarRoomPage | `coordinationRoutes` |
| `GET /api/status` | SystemStatusPage, HUD | `statusRoutes` |
| `GET /api/status/system` | SystemStatusPage | `statusRoutes` |
| `GET /api/status/database` | SystemStatusPage | `statusRoutes` |
| `GET /api/status/agents` | SystemStatusPage | `statusRoutes` |
| `GET /api/status/goals` | SystemStatusPage, HUD | `statusRoutes` |

### Rotas de Goals
| Endpoint | Frontend Use | Backend Handler |
|----------|--------------|-----------------|
| `GET /api/goals` | GoalsPage, GlobalSearch | `goalRoutes` |
| `GET /api/goals/overdue` | GoalsPage | `goalRoutes` |
| `GET /api/goals/metrics` | GoalMetrics | `goalRoutes` |
| `GET /api/goals/daily-actions` | GoalsPage | `goalRoutes` |
| `GET /api/goals/:id` | GoalDetail, GoalCard | `goalRoutes` |
| `PATCH /api/goals/:id` | GoalDetail | `goalRoutes` |
| `DELETE /api/goals/:id` | GoalCard | `goalRoutes` |
| `POST /api/goals/:id/score` | GoalDetail | `goalRoutes` |
| `POST /api/goals/:id/status` | GoalDetail | `goalRoutes` |
| `POST /api/goals/:id/health` | GoalDetail | `goalRoutes` |
| `GET /api/goals/:id/progress` | GoalDetail | `goalRoutes` |
| `GET /api/goals/:id/tree` | GoalDetail | `goalRoutes` |
| `GET /api/goals/:id/children` | GoalDetail | `goalRoutes` |
| `GET /api/goals/check-ins` | GoalDetail | `goalRoutes` |

### Rotas de Awareness
| Endpoint | Frontend Use | Backend Handler |
|----------|--------------|-----------------|
| `GET /api/awareness/status` | AwarenessPage, LiveContextPanel | `awarenessRoutes` |
| `GET /api/awareness/context` | AwarenessPage | `awarenessRoutes` |
| `GET /api/awareness/captures` | AwarenessPage | `awarenessRoutes` |
| `GET /api/awareness/suggestions` | AwarenessPage, SuggestionPanel | `awarenessRoutes` |
| `PATCH /api/awareness/suggestions/:id/dismiss` | SuggestionPanel | `awarenessRoutes` |
| `PATCH /api/awareness/suggestions/:id/act` | SuggestionPanel | `awarenessRoutes` |
| `POST /api/awareness/toggle` | AwarenessPage | `awarenessRoutes` |
| `GET /api/awareness/report` | AwarenessPage | `awarenessRoutes` |
| `GET /api/awareness/stats` | AwarenessPage | `awarenessRoutes` |

### Rotas de Authority
| Endpoint | Frontend Use | Backend Handler |
|----------|--------------|-----------------|
| `GET /api/authority/status` | AuthorityPage | `authorityRoutes` |
| `GET /api/authority/approvals` | AuthorityPage, ApprovalBanner | `authorityRoutes` |
| `POST /api/authority/approvals/:id/approve` | ApprovalBanner | `authorityRoutes` |
| `POST /api/authority/approvals/:id/deny` | ApprovalBanner | `authorityRoutes` |
| `GET /api/authority/audit` | AuthorityPage | `authorityRoutes` |
| `GET /api/authority/audit/stats` | AuthorityPage | `authorityRoutes` |
| `POST /api/authority/emergency/pause` | AuthorityPage | `authorityRoutes` |
| `POST /api/authority/emergency/resume` | AuthorityPage | `authorityRoutes` |
| `POST /api/authority/emergency/kill` | AuthorityPage | `authorityRoutes` |
| `GET /api/authority/config` | AuthorityPage | `authorityRoutes` |
| `POST /api/authority/config` | AuthorityPage | `authorityRoutes` |
| `GET /api/authority/learning/suggestions` | AuthorityPage | `authorityRoutes` |
| `POST /api/authority/learning/accept` | AuthorityPage | `authorityRoutes` |
| `POST /api/authority/learning/dismiss` | AuthorityPage | `authorityRoutes` |

### Rotas de Workflows
| Endpoint | Frontend Use | Backend Handler |
|----------|--------------|-----------------|
| `GET /api/workflows` | WorkflowsPage, WorkflowList | `workflowRoutes` |
| `GET /api/workflows/nodes` | WorkflowsPage | `workflowRoutes` |
| `POST /api/workflows/import` | WorkflowsPage | `workflowRoutes` |
| `GET /api/workflows/:id` | WorkflowsPage | `workflowRoutes` |
| `PATCH /api/workflows/:id` | WorkflowsPage, WorkflowList | `workflowRoutes` |
| `DELETE /api/workflows/:id` | WorkflowList | `workflowRoutes` |
| `POST /api/workflows/:id/execute` | WorkflowsPage, WorkflowList | `workflowRoutes` |
| `GET /api/workflows/:id/versions` | WorkflowCanvas | `workflowRoutes` |
| `POST /api/workflows/:id/versions` | WorkflowCanvas | `workflowRoutes` |
| `GET /api/workflows/:id/executions` | WorkflowsPage | `workflowRoutes` |
| `GET /api/workflows/executions/:executionId` | WorkflowsPage | `workflowRoutes` |
| `POST /api/workflows/executions/:executionId/cancel` | WorkflowsPage | `workflowRoutes` |
| `POST /api/workflows/nl-chat` | NLChatSidebar | `workflowRoutes` |
| `GET /api/workflows/suggest` | WorkflowsPage | `workflowRoutes` |
| `POST /api/workflows/suggest/:id/dismiss` | WorkflowsPage | `workflowRoutes` |

---

## 🔧 Correções Aplicadas (2026-05-01)

### ✅ M-1: Logging de Erros em useWebSocket
**Ficheiro:** `ui/src/hooks/useWebSocket.ts:312`

**Antes:**
```typescript
} catch {}
```

**Depois:**
```typescript
} catch (err) {
  console.warn('[WS] Failed to load pending approvals:', err);
}
```

---

### ✅ M-5: WebSocket Race Condition
**Ficheiro:** `ui/src/hooks/useWebSocket.ts:615-684`

**Antes:**
```typescript
const sendMessage = useCallback((text, options) => {
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
  // ...
  wsRef.current.send(JSON.stringify(msg));
}, []);
```

**Depois:**
```typescript
const sendMessage = useCallback((text, options) => {
  try {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send message: WebSocket not connected');
      return;
    }
    // ...
    try {
      wsRef.current.send(JSON.stringify(msg));
    } catch (err) {
      console.error('[WS] Send error:', err);
      reconnectAttemptsRef.current = 1;
    }
  } catch (err) {
    console.error('[WS] sendMessage error:', err);
  }
}, []);
```

---

### ✅ L-1: Type Safety em useApi
**Ficheiro:** `ui/src/hooks/useApi.ts:14-16`

**Antes:**
```typescript
const body = await res.json().catch(() => ({}));
throw new Error((body as any).error ?? `HTTP ${res.status}`);
```

**Depois:**
```typescript
const body = await res.json().catch(() => ({}));
const error = body && typeof body === 'object' && 'error' in body
  ? (body as { error: string }).error
  : `HTTP ${res.status}`;
throw new Error(error);
```

---

### ✅ L-2: Null Safety em ProgressDashboardPage
**Ficheiro:** `ui/src/pages/ProgressDashboardPage.tsx:215`

**Antes:**
```typescript
style={{ backgroundColor: HEATMAP_COLORS[day.level] }}
```

**Depois:**
```typescript
style={{ backgroundColor: HEATMAP_COLORS[day.level ?? 0] }}
```

---

## ⏳ Correções Pendentes

### M-2: Empty Catch em AuthorityPage
**Ficheiro:** `ui/src/pages/AuthorityPage.tsx:167, 331, 486, 498, 508, 820`

### M-3: Empty Catch em GoalsPage
**Ficheiro:** `ui/src/pages/GoalsPage.tsx:81`

### M-4: Empty Catch em PipelinePage
**Ficheiro:** `ui/src/pages/PipelinePage.tsx:151-160`

### L-3 a L-8: Outros Error Handlings
Ver secção original para detalhes.

---

## ✅ Conclusão

**Estado Geral:** ✅ **SAUDÁVEL**

O sistema frontend-backend está bem estruturado:
- **100% dos endpoints** mapeados corretamente
- **WebSocket** funcional com 10 tipos de eventos
- **Services** corretamente injetados
- **TypeScript** a proteger contra erros de tipo

**Áreas de Melhoria:**
1. Logging de erros (5 medium issues)
2. Type safety (8 low issues)
3. Error handling consistente

**Nenhuma correção crítica necessária.** As páginas novas (Progress, War Room, System Status, HUD) estão corretamente integradas.

# 🚀 Jarvis Evolution: Plano de Evolução Completa

**Data:** 2026-04-30
**Status:** Planeado - Aguardando Implementação
**Visão:** Transformar o Jarvis num Sistema Operativo Cognitivo Completo

---

## 📋 Sumário Executivo

Este plano detalha a implementação de **7 grandes funcionalidades** que evoluirão o Jarvis de um assistente reativo para um verdadeiro sistema operativo cognitivo com:
- Perceção visual do ambiente do utilizador ✅
- Aprendizagem e adaptação de preferências ✅
- Sistema inteligente de notificações ✅
- Dashboard de progresso e métricas ✅
- Coordenação multi-agente visível ✅
- Testes automatizados integrados ✅
- Mudança de contexto entre projetos ✅
- Deep Memory Synthesis ✅
- HUD Overlay ✅
- Voice-First Interaction ✅
- Daily Rhythm ✅

**Tempo estimado:** 4-6 semanas de implementação
**Prioridade:** Todas as funcionalidades são complementares e podem ser implementadas em paralelo

**Estado Atual:** ✅ FASES 1-6 COMPLETAS (2026-05-01)

---

## 🧠 1. Visual Context Engine

### Contexto
Atualmente o Jarvis não "vê" o que o utilizador está a fazer. Esta funcionalidade adiciona perceção visual através de capturas de ecrã e análise via VLM.

### Funcionalidades
- Captura periódica de ecrã (com permissão do utilizador)
- Envio para VLM (Claude 3.5/4.0 com visão)
- Análise contextual: "O utilizador está a depurar?", "Que aplicação está ativa?"
- Integração com InterruptManager para deteção de erros visuais
- OCR para extrair texto de aplicações não acessíveis

### Arquitetura
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ ScreenCapture   │────▶│ VLM Analyzer     │────▶│ Context Injector│
│ Service         │     │ (Claude Vision)  │     │ (Prompt Builder)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
       │                        │                        │
       ▼                        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Período: 30s    │     │ Análise:         │     │ Injeta no       │
│ Trigger: evento │     │ - Erros visuais  │     │ system prompt   │
│ On-demand       │     │ - App ativa      │     │ do agente       │
└─────────────────┘     │ - Docs abertas   │     └─────────────────┘
                        └──────────────────┘
```

### Ficheiros a Criar
- `src/services/screen-capture.ts` - Serviço de captura de ecrã
- `src/services/vlm-analyzer.ts` - Análise de imagens via Claude API
- `src/observers/screen-observer.ts` - Observer para InterruptManager

### Ficheiros a Modificar
- `src/daemon/index.ts` - Registrar novo serviço
- `src/agents/interrupt-manager.ts` - Adicionar ScreenObserver
- `src/roles/prompt-builder.ts` - Injetar contexto visual

### Requisitos
- Permissão do utilizador para capturas
- API key Claude com visão habilitada
- Armazenamento temporário de imagens (buffer circular)
- Privacy mode (pausar capturas)

### Critérios de Aceitação
- [ ] Captura de ecrã funcional em Windows/Linux/macOS
- [ ] Análise VLM retorna contexto estruturado
- [ ] Contexto injetado no prompt do agente
- [ ] Trigger de interrupt para erros visuais detetados
- [ ] Privacy mode funcional

---

## 🎯 2. User Persona Synthesis

### Contexto
O Jarvis não aprende preferências do utilizador ao longo do tempo. Cada sessão começa "do zero".

### Funcionalidades
- Observação de padrões: "Utilizador prefere testes antes do código"
- Aprendizagem: "Sempre que edita X, depois faz Y"
- Atualização de perfil no Vault como entidade `user_preference`
- Injeção automática de preferências no system prompt
- Feedback loop: utilizador confirma/corrige preferências

### Arquitetura
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Pattern Observer│────▶│ Preference Learner│───▶│ Vault Storage   │
│ (ações do user) │     │ (ML simples)     │     │ (user_preference)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Prompt Injector  │
                        │ (system prompt)  │
                        └──────────────────┘
```

### Ficheiros a Criar
- `src/services/pattern-observer.ts` - Observa padrões do utilizador
- `src/services/preference-learner.ts` - Aprende e atualiza preferências
- `src/vault/user-preferences.ts` - CRUD de preferências no Vault

### Ficheiros a Modificar
- `src/daemon/background-agent-service.ts` - Injetar preferências
- `src/roles/prompt-builder.ts` - Adicionar secção de preferências
- `ui/src/pages/SettingsPage.tsx` - UI para gerir preferências

### Esquema Vault (user_preferences)
```sql
CREATE TABLE user_preferences (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,           -- 'coding', 'communication', 'workflow'
  name TEXT NOT NULL,               -- 'test_first', 'verbose_errors'
  value TEXT NOT NULL,              -- JSON string
  confidence REAL DEFAULT 0.5,      -- 0.0-1.0 certeza
  source TEXT,                      -- 'observed', 'explicit', 'inferred'
  observed_count INTEGER DEFAULT 1,
  last_observed_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);
```

### Critérios de Aceitação
- [ ] Observação de padrões implementada
- [ ] Preferências armazenadas no Vault
- [ ] Injeção automática no system prompt
- [ ] UI para visualizar/corrigir preferências
- [ ] Feedback loop para confirmação

---

## 🔔 3. Smart Notification System

### Contexto
Notificações são genéricas e não priorizadas. Utilizador é interrompido igualmente para tudo.

### Funcionalidades
- Classificação por urgência (crítico vs. info)
- Agrupamento de notificações relacionadas
- "Silent hours" - respeita horários de descanso
- Notificações por voz apenas para eventos críticos
- Digest periódico (resumo a cada X minutos)

### Arquitetura
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Event Sources   │────▶│ Notification     │────▶│ Delivery        │
│ (todos serviços)│     │ Classifier       │     │ Router          │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                        │
                               ▼                        ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │ Priority Queue   │     │ - Desktop       │
                        │ (agrupamento)    │     │ - Voice (TTS)   │
                        └──────────────────┘     │ - Digest        │
                                                 └─────────────────┘
```

### Ficheiros a Criar
- `src/services/notification-service.ts` - Serviço central de notificações
- `src/services/notification-classifier.ts` - Classifica prioridade
- `src/services/notification-queue.ts` - Fila e agrupamento

### Ficheiros a Modificar
- `src/daemon/ws-service.ts` - WebSocket para notificações UI
- `ui/src/components/NotificationCenter.tsx` - UI componente
- `src/config/types.ts` - Config de silent hours

### Tipos de Notificação
```typescript
type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

interface Notification {
  id: string;
  priority: NotificationPriority;
  category: 'error' | 'success' | 'info' | 'warning' | 'question';
  title: string;
  message: string;
  actions?: NotificationAction[];
  group?: string;           // Para agrupamento
  expireAfterMs?: number;   // Auto-expiração
  requireAck?: boolean;     // Requer confirmação
}
```

### Critérios de Aceitação
- [ ] Classificação de prioridade funcional
- [ ] Agrupamento de notificações relacionadas
- [ ] Silent hours configuráveis
- [ ] Notificações por voz para críticos
- [ ] Digest periódico implementado

---

## 📊 4. Progress Tracking Dashboard

### Contexto
Difícil ver progresso em tarefas de longo prazo. Não há métricas de produtividade.

### Funcionalidades
- Gráficos de progresso de goals (burn-down charts)
- Tempo gasto por tarefa/projeto
- "Velocity" do Jarvis - tarefas/hora
- Previsão de conclusão baseada em histórico
- Heatmap de atividade (estilo GitHub contributions)

### Arquitetura
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Time Tracker    │────▶│ Metrics Aggregator│───▶│ Dashboard UI    │
│ (background)    │     │ (estatísticas)   │     │ (gráficos)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Prediction Engine│
                        │ (ETA calculations)│
                        └──────────────────┘
```

### Ficheiros a Criar
- `src/services/time-tracker.ts` - Track tempo por tarefa
- `src/services/metrics-service.ts` - Agrega métricas
- `src/services/prediction-engine.ts` - Calcula ETAs
- `ui/src/pages/ProgressDashboardPage.tsx` - UI completa

### Ficheiros a Modificar
- `src/daemon/background-agent-service.ts` - Track tempo
- `src/vault/metrics.ts` - Armazenar métricas
- `ui/src/App.tsx` - Adicionar rota

### Métricas a Trackear
- Tarefas completadas por hora/dia/semana
- Tempo médio por tipo de tarefa
- Taxa de sucesso vs. falha
- Horas ativas vs. inativas
- Progresso em goals (burn-down)

### Critérios de Aceitação
- [ ] Time tracking funcional
- [ ] Dashboard com gráficos (recharts ou similar)
- [ ] Previsão de conclusão
- [ ] Heatmap de atividade
- [ ] Export de métricas (CSV/JSON)

---

## 🤖 5. Multi-Agent Coordination UI

### Contexto
Sub-agentes trabalham em silêncio. Utilizador não vê coordenação.

### Funcionalidades
- Lista de agentes ativos com status
- Logs de comunicação entre agentes
- Visualização em árvore de tarefas
- Capacidade de "promover" agente a principal
- Timeline de eventos do sistema

### Arquitetura
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Agent Orchestr. │────▶│ Coordination     │────▶│ War Room UI     │
│ (estado)        │     │ Logger           │     │ (tempo real)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Event Stream     │
                        │ (WebSocket)      │
                        └──────────────────┘
```

### Ficheiros a Criar
- `src/services/coordination-logger.ts` - Log comunicações
- `ui/src/pages/WarRoomPage.tsx` - UI "War Room"
- `ui/src/components/AgentTree.tsx` - Visualização em árvore
- `ui/src/components/EventTimeline.tsx` - Timeline de eventos

### Ficheiros a Modificar
- `src/agents/orchestrator.ts` - Emitir eventos de coordenação
- `src/daemon/ws-service.ts` - Stream eventos para UI
- `src/daemon/routes/super-jarvis.ts` - API routes

### Componentes UI
- **Agent List:** Cards com status (running, idle, blocked)
- **Task Tree:** Árvore expansível de tarefas
- **Communication Log:** Chat-style log entre agentes
- **Resource Usage:** CPU/memória por agente

### Critérios de Aceitação
- [ ] Lista de agentes em tempo real
- [ ] Árvore de tarefas visual
- [ ] Logs de comunicação visíveis
- [ ] Timeline de eventos
- [ ] Interação (promover agente, cancelar tarefa)

---

## 🧪 6. Automated Testing Service

### Contexto
Jarvis pode quebrar código sem detetar. Não há validação automática.

### Funcionalidades
- Deteção de mudanças em ficheiros de código
- Execução automática de testes (bun test)
- Report de falhas via InterruptManager
- Sugestões de correção baseadas no erro
- Modo "watch" durante desenvolvimento

### Arquitetura
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ File Watcher    │────▶│ Test Runner      │────▶│ Report Generator│
│ (code changes)  │     │ (bun test)       │     │ (InterruptMgr)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Fix Suggester    │
                        │ (LLM + erro)     │
                        └──────────────────┘
```

### Ficheiros a Criar
- `src/services/auto-test-service.ts` - Serviço de testes
- `src/services/test-runner.ts` - Wrapper bun test
- `src/services/fix-suggester.ts` - Sugere correções via LLM

### Ficheiros a Modificar
- `src/daemon/index.ts` - Registrar serviço
- `src/agents/interrupt-manager.ts` - Trigger em falha
- `src/config/types.ts` - Config de auto-test

### Configuração
```typescript
interface AutoTestConfig {
  enabled: boolean;
  watchPatterns: string[];      // ['src/**/*.ts', 'tests/**/*.test.ts']
  ignorePatterns: string[];     // ['node_modules', 'dist']
  runOnSave: boolean;
  runOnHeartbeat: boolean;
  suggestFixes: boolean;
  maxSuggestions: number;       // 3
}
```

### Critérios de Aceitação
- [ ] Deteção de mudanças em ficheiros
- [ ] Execução automática de testes
- [ ] Report de falhas com detalhes
- [ ] Sugestões de correção via LLM
- [ ] Configuração flexível

---

## 📁 7. Project Context Switching

### Contexto
Trabalhar em múltiplos projetos requer reset de contexto. Memória fica contaminada.

### Funcionalidades
- Deteção automática de mudança de diretório (git root)
- Carregamento de contexto específico do projeto
- Arquitetura, dependências, patterns do projeto
- Memória separada por projeto no Vault
- Histórico de sessões por projeto

### Arquitetura
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Directory Watcher│───▶│ Context Loader   │────▶│ Prompt Injector │
│ (cwd changes)   │     │ (projeto atual)  │     │ (agente)        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Vault (scoped)   │
                        │ project_id filter│
                        └──────────────────┘
```

### Ficheiros a Criar
- `src/services/project-context-service.ts` - Gestão de contexto
- `src/vault/project-scoped.ts` - Queries com scope
- `ui/src/components/ProjectSwitcher.tsx` - UI selector

### Ficheiros a Modificar
- `src/daemon/background-agent-service.ts` - Injetar contexto
- `src/roles/prompt-builder.ts` - Secção de projeto
- `src/vault/retrieval.ts` - Filtros por projeto

### Esquema de Contexto
```typescript
interface ProjectContext {
  id: string;
  name: string;
  rootPath: string;
  architecture: {
    patterns: string[];           // ['MVC', 'repository', 'CQRS']
    techStack: string[];          // ['React', 'Bun', 'SQLite']
    constraints: string[];        // ['No direct DB access in UI']
  };
  dependencies: Record<string, string>;
  currentGoal?: string;
  lastActiveAt: number;
}
```

### Critérios de Aceitação
- [ ] Deteção automática de git root
- [ ] Carregamento de contexto por projeto
- [ ] Injeção no system prompt
- [ ] Memória isolada no Vault
- [ ] UI para switching manual

---

## 📅 Roadmap de Implementação

### ✅ Sprint 1-6 (COMPLETOS - 2026-05-01)

**Fase 1: Fundação**
- [x] User Persona Synthesis
- [x] Project Context Switching
- [x] Smart Notification System

**Fase 2: Perceção**
- [x] Visual Context Engine
- [x] Automated Testing Service

**Fase 3: Interface**
- [x] Progress Tracking Dashboard
- [x] Multi-Agent Coordination UI

**Fase 4: Polimento**
- [x] Integração entre serviços
- [x] Otimizações de performance
- [x] Documentação e testes

**Fase 5: Advanced Features**
- [x] Deep Memory Synthesis
- [x] Ambient HUD Overlay
- [x] Voice-First Interaction
- [x] Calendar & Daily Rhythm

### 🔄 Sprint 7+: Next Steps
- [ ] Workflow Automation Engine (em progresso)
- [ ] Advanced MCP Integration
- [ ] Sidecar RPC (multi-machine)

---

## 🔗 Dependências entre Funcionalidades

```
Visual Context Engine
    └── Depende de: InterruptManager (existente)
    └── Usado por: Multi-Agent Coordination UI

User Persona Synthesis
    └── Depende de: Vault entities (existente)
    └── Usado por: Project Context Switching

Smart Notification System
    └── Depende de: WebSocketService (existente)
    └── Usado por: Progress Tracking Dashboard

Progress Tracking Dashboard
    └── Depende de: Time Tracker (novo)
    └── Independente

Multi-Agent Coordination UI
    └── Depende de: Orchestrator events (existente)
    └── Usado por: Visual Context Engine (debug)

Automated Testing Service
    └── Depende de: FileWatcher (existente)
    └── Independente

Project Context Switching
    └── Depende de: Vault retrieval (existente)
    └── Usado por: User Persona Synthesis
```

---

## 📊 Métricas de Sucesso

| Funcionalidade | Métrica | Target |
|----------------|---------|--------|
| Visual Context | Latência análise | < 5s |
| User Persona | Preferências aprendidas | > 10/semana |
| Notifications | Falso positivos | < 5% |
| Progress Dashboard | Precisão ETA | ± 20% |
| Multi-Agent UI | Agentes visíveis | 100% |
| Auto Testing | Testes executados | > 100/dia |
| Project Switch | Tempo de carga | < 1s |

---

## 🛡 Considerações de Segurança e Privacy

### Visual Context Engine
- **Privacy Mode:** Utilizador pode pausar capturas
- **Buffer Circular:** Imagens não persistem em disco
- **Redaction:** API keys e dados sensíveis são mascarados

### User Persona
- **Consentimento:** Utilizador vê e aprova preferências
- **Export/Delete:** Dados exportáveis e apagáveis
- **Scoped:** Preferências por projeto (opcional)

### Notifications
- **Silent Hours:** Respeita horários de descanso
- **Do Not Disturb:** Modo emergência desativa tudo menos crítico

---

## 📝 Notas de Implementação

### Padrões a Seguir
- Todos os serviços implementam interface `Service` (start/stop/status)
- Eventos stream via WebSocket para UI em tempo real
- Vault como fonte única de verdade para memória
- InterruptManager para eventos de alta prioridade

### Bibliotecas Sugeridas
- **Gráficos:** `recharts` ou `chart.js` (já disponível em ui/)
- **Captura de ecrã:** `screenshot-desktop` (npm)
- **OCR:** Tesseract.js ou Claude Vision
- **Time Tracking:** Implementação nativa (performance)

### Testing Strategy
- Unit tests para serviços (bun test)
- Integration tests para fluxos completos
- E2E tests para UI crítica

---

## ✅ Checklist de Validação Final

- [ ] Todos os serviços registados no daemon
- [ ] UI acessível em http://localhost:3142
- [ ] WebSocket events funcionais
- [ ] Vault queries otimizadas
- [ ] Documentação atualizada
- [ ] TypeScript sem erros
- [ ] Build UI e daemon sem warnings críticos

---

**Plano criado em:** 2026-04-30
**Status da Sprint 1:** ✅ COMPLETA

### Sprint 1 - Implementado:

| Funcionalidade | Status | Ficheiros Criados |
|----------------|--------|-------------------|
| **User Persona Synthesis** | ✅ Completo | `src/vault/user-preferences.ts`, `src/services/pattern-observer.ts`, `src/services/preference-learner.ts` |
| **Project Context Switching** | ✅ Completo | `src/vault/project-contexts.ts`, `src/services/project-context-service.ts` |
| **Smart Notification System** | ✅ Completo | `src/services/notification-service.ts` |

### Integrações Realizadas:
- ✅ `src/daemon/index.ts` - Todos os serviços registados
- ✅ `src/daemon/background-agent-service.ts` - Injeção de preferências e contexto no prompt
- ✅ `src/roles/prompt-builder.ts` - Suporte para `userPreferences` e `currentProject`
- ✅ `src/daemon/api-routes.ts` - Rotas API para preferências (`/api/preferences/*`)
- ✅ `src/daemon/routes/preferences.ts` - API completa para gestão de preferências

### Próximos Passos (Sprint 2):
1. **Visual Context Engine** - Captura de ecrã + VLM
2. **Automated Testing Service** - Testes automáticos


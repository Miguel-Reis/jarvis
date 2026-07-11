# PalKeeper

Daemon nativo Linux de gestão para um servidor dedicado de **Palworld 1.0**.

Não é um mod injetado: comunica **exclusivamente** via [REST API oficial](https://tech.palworldgame.com/api/rest-api/palwold-rest-api/) e RCON do servidor, por isso sobrevive a updates do jogo sem manutenção. Foi desenhado para correr semanas sem supervisão ao lado de um servidor gerido pelo **Pelican Panel** (binário Windows sob Proton-GE).

## Funcionalidades (Fase 1 — MVP)

- **Auto-save agendado** — `POST /save` a cada N minutos (default 15)
- **Backups** — após cada save, `tar.gz` da pasta `SaveGames/` com verificação de integridade (`Level.sav` presente e com tamanho > 0, dentro e fora do arquivo) e rotação (default: manter 48)
- **Restart agendado** — cron configurável com contagem decrescente via announce (10/5/2/1 min), save final, shutdown gracioso e novo arranque via **API do Pelican**
- **Resiliência** — retries exponenciais + circuit breaker: se o servidor estiver offline o daemon entra em modo de espera e reconecta sozinho; **nunca crasha**
- **API interna** — `/healthz` e `/status` com auth por token

Fases seguintes: watchdog de memória, tracking de sessões, boas-vindas, webhooks Discord, event planner (eventos de settings com reversão automática) e dashboard web.

## Requisitos no servidor Palworld

No `Pal/Saved/Config/WindowsServer/PalWorldSettings.ini`, dentro de `OptionSettings=(...)`:

```
AdminPassword="a-tua-password",RESTAPIEnabled=True,RESTAPIPort=8212,RCONEnabled=True,RCONPort=25575
```

Reinicia o servidor depois de alterar. Confirma com:

```bash
curl -u admin:a-tua-password http://127.0.0.1:8212/v1/api/info
```

## Instalação com Docker (host com Pelican)

1. Clona/copia esta pasta para o host (ex.: `/opt/palkeeper`).

2. Cria a configuração:

```bash
cp config.example.yaml config.yaml
# edita: savedPath, pelican.url, pelican.serverId, horários, mensagens…
```

3. Cria o `.env` com os secrets (nunca vão para o `config.yaml`):

```bash
cat > .env <<'EOF'
PALWORLD_ADMIN_PASSWORD=a-tua-password
PELICAN_API_KEY=ptlc_xxxxxxxx
PALKEEPER_API_TOKEN=um-token-aleatorio-comprido
EOF
chmod 600 .env
```

4. Ajusta o volume da pasta `Pal/Saved` no `docker-compose.yml`. Num host Pelican típico é algo como:

```
/var/lib/pelican/volumes/<uuid-do-servidor>/Pal/Saved
```

O caminho exato vê-se no painel do Pelican em **Settings → Debug Information** ou na configuração do node. O PalKeeper precisa de **leitura/escrita** (a Fase 3 edita o `PalWorldSettings.ini`).

5. Arranca:

```bash
docker compose up -d --build
docker compose logs -f
```

Deves ver `PalKeeper pronto` e `servidor Palworld ONLINE`.

### API key do Pelican

O PalKeeper usa a **Client API** do Pelican para voltar a arrancar o servidor após um shutdown gracioso:

1. No painel: **Account → API Credentials → Create API Key**
2. Guarda a chave em `PELICAN_API_KEY` no `.env`
3. `pelican.serverId` é o identificador curto do servidor (visível no URL: `/server/abc123ef`)

> **Nota:** se o Pelican estiver configurado com crash detection/auto-restart, podes usar `pelican.enabled: false` — o PalKeeper faz só o shutdown gracioso e espera que o painel reinicie o servidor.

### Sem Docker (systemd)

```bash
npm ci && npm run build
```

```ini
# /etc/systemd/system/palkeeper.service
[Unit]
Description=PalKeeper — daemon de gestão do servidor Palworld
After=network-online.target

[Service]
WorkingDirectory=/opt/palkeeper
EnvironmentFile=/opt/palkeeper/.env
Environment=PALKEEPER_CONFIG=/opt/palkeeper/config.yaml
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
User=palkeeper

[Install]
WantedBy=multi-user.target
```

## Configuração

Vê o [`config.example.yaml`](config.example.yaml) comentado. Pontos principais:

| Secção | O que faz |
|---|---|
| `palworld.restUrl` / `rcon` | Onde encontrar a REST API e o RCON do servidor |
| `palworld.savedPath` | Pasta `Pal/Saved` montada no container |
| `autosave.intervalMinutes` | Intervalo do `POST /save` (default 15) |
| `backup.path` / `backup.keep` | Pasta dos tar.gz e quantos manter (default 48) |
| `restart.cron` | Início da contagem decrescente (com `countdownMinutes: [10,5,2,1]` e cron às 06:00, o shutdown acontece às 06:10) |
| `messages.*` | Todas as mensagens visíveis aos jogadores, em PT-PT |
| `timezone` | Timezone dos agendamentos (default `Europe/Lisbon`) |

Secrets **apenas** por variáveis de ambiente: `PALWORLD_ADMIN_PASSWORD`, `PELICAN_API_KEY`, `PALKEEPER_API_TOKEN`.

## API interna

```bash
curl http://127.0.0.1:8300/healthz
curl -H "Authorization: Bearer $PALKEEPER_API_TOKEN" http://127.0.0.1:8300/status
```

`/status` devolve o estado do servidor (online/offline, circuito), o último save/backup e o resultado do último restart.

## Desenvolvimento

```bash
npm ci
npm test          # testes unitários (vitest)
npm run typecheck
npm run dev       # compila e corre

# servidor mock (Palworld + Pelican) para testar sem servidor real:
node tests/mock-server.mjs 18212 pw
```

## Estrutura

```
src/
├── clients/    # REST Palworld (retries + circuit breaker), RCON, Pelican
├── config/     # config.yaml + env, validação
├── core/       # logger, sqlite + migrations, scheduler, estado do servidor,
│               # orquestrador de restart (countdown → save → shutdown → start)
├── modules/    # autosave, backup, scheduled-restart (+ módulos das fases 2–4)
└── api/        # API interna Express
```

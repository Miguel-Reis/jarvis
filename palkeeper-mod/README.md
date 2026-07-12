# PalKeeperMod

Mod C++ (**UE4SS**) para o servidor dedicado de Palworld, que complementa o daemon [PalKeeper](../palkeeper/) com funcionalidades **dentro do jogo** — coisas que a REST API oficial não consegue fazer.

> ## ⚠️ Estado: à espera do UE4SS para o Palworld 1.0
>
> O Palworld 1.0 (10 de julho de 2026) recompilou o executável e **partiu o UE4SS** — de momento **nenhum mod injetado carrega no 1.0**. Este mod usa a API C++ estável do UE4SS, por isso ficará funcional assim que um build compatível sair, sem alterações ao código (na pior das hipóteses, ajustar os paths em `src/GameFunctions.hpp`).
>
> Acompanha: [UE4SS experimental-palworld (Okaetsu)](https://github.com/Okaetsu/RE-UE4SS) e o [RE-UE4SS com fixes para Linux/Proton no Nexus](https://www.nexusmods.com/palworld/mods/3405).

## Funcionalidades

- **Comandos de chat para jogadores** — `!help`, `!ping`, `!playtime`, `!leaderboard`, `!eventos` (dados vindos do PalKeeper via API interna)
- **Comandos de chat para admins** — `!kick <steamId>`, `!ban <steamId> [razão]`, `!broadcast <msg>`, `!save` (admins definidos por SteamID no config)
- **Tags no chat** — prefixos por jogador (ex.: `[ADMIN] Miguel: olá`), configuráveis por SteamID
- **Boas-vindas por mensagem privada** — em vez do announce global (o PalKeeper deteta o join e o mod entrega a PM; ativa `welcome.viaMod: true` no PalKeeper)
- **Relay do chat** — cada mensagem vai para o PalKeeper (registo em SQLite + opcionalmente para o Discord com `discord.notify.chat: true`)

### Arquitetura

```
jogador escreve no chat
        │ hook EnterChat_Receive (game thread)
        ▼
  PalKeeperMod ──worker thread/WinHTTP──► PalKeeper API (127.0.0.1:8300)
        ▲                                   /mod/*, /actions/*
        └── respostas por PM (game thread, via fila)
```

- HTTP **nunca** corre na game thread (worker thread + filas) — pedidos lentos não congelam o servidor
- As propriedades das structs do jogo são lidas **por nome com offsets resolvidos em runtime**, nunca por layout fixo — sobrevive melhor a patches
- Todos os nomes de UFunctions do Pal estão centralizados em `src/GameFunctions.hpp`

## Compilar

O UE4SS e os seus mods C++ compilam com **MSVC em Windows** (não há cross-compile suportado a partir de Linux).

> **Pré-requisito obrigatório (licença da Epic):** o UE4SS depende do submódulo
> privado [`Re-UE4SS/UEPseudo`](https://github.com/UE4SS-RE/RE-UE4SS/issues/577)
> (pseudo-código do Unreal Engine). Para o clonar precisas de:
> 1. Ligar a tua conta GitHub à tua conta **Epic Games** ([instruções da Epic](https://www.unrealengine.com/en-US/ue-on-github)) — dá-te acesso ao código-fonte do UE e ao UEPseudo;
> 2. Para o CI: criar um Personal Access Token (scope `repo`) nessa conta e guardá-lo no secret **`UEPSEUDO_TOKEN`** do repositório.
>
> Sem isto, o clone falha com "Permission denied"/"could not read Username" — é
> uma restrição de licença, não um erro do projeto.

### Via GitHub Actions (recomendado)

O workflow `.github/workflows/palkeeper-mod.yml` (na raiz do repo) compila num runner Windows e publica o artefacto `PalKeeperMod` (com `dlls/main.dll` + `config.json`). Corre automaticamente quando o código do mod muda, ou manualmente (workflow_dispatch) escolhendo o fork/branch do UE4SS.

### Localmente (Windows)

```powershell
git clone --recursive -b experimental-palworld https://github.com/Okaetsu/RE-UE4SS ue4ss
Copy-Item -Recurse palkeeper-mod ue4ss/cppmods/PalKeeperMod
Add-Content ue4ss/xmake.lua 'includes("cppmods/PalKeeperMod")'
cd ue4ss
xmake f -m "Game__Shipping__Win64" -y
xmake build PalKeeperMod
```

## Instalar (servidor sob Proton-GE / Pelican)

1. Instala o UE4SS no servidor (quando houver build 1.0): conteúdo em `Pal/Binaries/Win64/` — sob Proton o carregamento faz-se por proxy DLL (`dwmapi.dll`), ver o [guia de dedicated servers do pwmodding.wiki](https://pwmodding.wiki/docs/users/ue4ss/installation-server)
2. Copia o mod para `Pal/Binaries/Win64/ue4ss/Mods/PalKeeperMod/`:
   - `dlls/main.dll` (o `PalKeeperMod.dll` compilado)
   - `config.json` (baseado em [`config/palkeeper-mod.json`](config/palkeeper-mod.json))
3. Ativa o mod em `ue4ss/Mods/mods.txt`: `PalKeeperMod : 1`
4. No `config.json`, aponta `palkeeperApi.url`/`token` para o PalKeeper (o token é o mesmo `PALKEEPER_API_TOKEN`)
5. No PalKeeper, ativa `welcome.viaMod: true` (PMs de boas-vindas) e `discord.notify.chat: true` (relay do chat) se quiseres

## Resolução de problemas

- **O mod carrega mas o chat não reage** — o 1.0 pode ter renomeado funções. Vê o `UE4SS.log`: o mod escreve exatamente que UFunction não encontrou. Confirma o nome real com o Live View do UE4SS e corrige `src/GameFunctions.hpp` (um único sítio).
- **Comandos respondem "Servico indisponivel"** — o PalKeeper não está acessível no URL/token do `config.json`; testa `curl -H "Authorization: Bearer <token>" http://127.0.0.1:8300/healthz` de dentro do ambiente do servidor.
- **Sem tags/admin** — o mapeamento UID→SteamID vem do polling de `/players` do PalKeeper; confirma que o daemon está online e o jogador aparece em `GET /players`.

## Aviso honesto

Este mod foi desenvolvido **sem possibilidade de teste em runtime** (o UE4SS ainda não carrega no Palworld 1.0 e este ambiente de build não tem o jogo). O código segue a API C++ documentada do RE-UE4SS e os padrões usados por mods estabelecidos (PalDefender e afins), com os pontos frágeis isolados e bem sinalizados — mas conta com uma sessão de ajustes na primeira execução real.

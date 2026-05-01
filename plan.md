# Liar's Dice Arena — Plano de Arquitetura, Produto e Fundação Técnica

> Documento de fundação para uma plataforma online competitiva de Liar's Dice (Perudo/Dudo), inspirada em lichess.org. Foco em: MVP enxuto, escalabilidade, fair-play verificável, UX acessível e monetização ética por cosméticos.

---

## 0. Índice

1. [Visão, missão e filosofia](#1-visão-missão-e-filosofia)
2. [Regras canônicas do modo clássico](#2-regras-canônicas-do-modo-clássico)
3. [Glossário](#3-glossário)
4. [Arquitetura de alto nível](#4-arquitetura-de-alto-nível)
5. [Stack tecnológica recomendada](#5-stack-tecnológica-recomendada)
6. [RNG determinístico e sincronização 2D↔3D (núcleo do sistema)](#6-rng-determinístico-e-sincronização-2d3d-núcleo-do-sistema)
7. [Motor de física e pipeline de animação](#7-motor-de-física-e-pipeline-de-animação)
8. [Modos de renderização: 3D Full, 3D Light, 2D Light](#8-modos-de-renderização)
9. [Protocolo de rede, estado e reconexão](#9-protocolo-de-rede-estado-e-reconexão)
10. [Matchmaking, rating e fila](#10-matchmaking-rating-e-fila)
11. [Tipos de partida e controles de tempo](#11-tipos-de-partida-e-controles-de-tempo)
12. [Torneios](#12-torneios)
13. [Liar's Dice Notation (LDN) — notação padrão](#13-liars-dice-notation-ldn)
14. [Análise, replays, puzzles e treino](#14-análise-replays-puzzles-e-treino)
15. [Bots e IA](#15-bots-e-ia)
16. [Anti-trapaça e anti-conluio](#16-anti-trapaça-e-anti-conluio)
17. [Chat, moderação e comunidade](#17-chat-moderação-e-comunidade)
18. [Monetização (skins, patronos, não-pay-to-win)](#18-monetização)
19. [Acessibilidade, UX e internacionalização](#19-acessibilidade-ux-e-i18n)
20. [Mobile e multiplataforma](#20-mobile-e-multiplataforma)
21. [API pública e ecossistema](#21-api-pública-e-ecossistema)
22. [Infraestrutura, DevOps, observabilidade](#22-infraestrutura-devops-observabilidade)
23. [Legal, privacidade, jogo responsável](#23-legal-privacidade-jogo-responsável)
24. [Métricas e KPIs](#24-métricas-e-kpis)
25. [Roadmap de 18 meses](#25-roadmap-de-18-meses)
26. [Ideias fora da caixa (que você provavelmente não pensou)](#26-ideias-fora-da-caixa)
27. [Riscos e mitigações](#27-riscos-e-mitigações)

---

## 1. Visão, missão e filosofia

**Codinome de trabalho:** Liar's Dice Arena (LDA).

**Missão:** Tornar-se o lar de referência para Liar's Dice online — gratuito, rápido, justo e sem anúncios. Aquela "cidade" onde todo jogador sério cria conta.

**Princípios inegociáveis (herdados do DNA do lichess):**

- **Grátis para sempre.** Nenhuma feature de gameplay atrás de paywall. Nunca.
- **Sem anúncios.** Zero. Nem discretos.
- **Sem loot boxes.** Cosméticos vendidos diretamente, preço visível.
- **Código-fonte aberto** (AGPLv3 ou similar). Comunidade pode auditar, contribuir e forkar.
- **Fair-play verificável.** Todo resultado de dado é provavelmente justo (commit-reveal público).
- **Performance acima de bling.** Deve rodar em celular antigo tão bem quanto em desktop gamer.
- **Acessibilidade como requisito, não afterthought.** WCAG AA mínimo.

**Diferencial vs. apps existentes de Liar's Dice:** hoje o mercado é fragmentado entre apps pagos com UX datada, implementações mobile limitadas e salas de Discord. Não existe um "lichess equivalente" — uma plataforma com rating sério, torneios públicos, replays analisáveis, puzzles, open-source e ecossistema de bots/ferramentas.

---

## 2. Regras canônicas do modo clássico

> Esta é a única variante do MVP. Outras (Palifico, Common Hand, Bluff, etc.) ficam para fases futuras.

### 2.1 Setup

- 2 a 6 jogadores (MVP foca em 2–6; arquitetura permite até 8).
- Cada jogador começa com **5 dados** de 6 faces e um copo.
- Cada jogador rola seus dados em segredo (só ele vê).

### 2.2 O bid (lance)

Um lance é um par `(quantidade, valor)` significando "existem pelo menos `quantidade` dados com face `valor` entre **todos os dados em jogo**".

- `1` ("ases") é **coringa** por padrão — conta como qualquer valor, exceto quando o lance é sobre `1`.
- Em cada turno, o jogador deve **aumentar o lance** ou chamar `Dudo` (duvido).

### 2.3 Hierarquia de aumento

Dado um lance atual `(q, v)`:

1. **Mais quantidade:** qualquer `(q', v')` com `q' > q`.
2. **Mesma quantidade, face maior:** `(q, v')` com `v' > v`.
3. **Face menor:** só é permitida se a quantidade também aumentar.

### 2.4 Ações possíveis no turno

- **Aumentar o lance** (conforme §2.3).
- **Dudo / Duvido:** desafia o lance anterior. Todos revelam os dados.
  - Se o lance era **verdadeiro** (contagem real ≥ `q`): o desafiante perde **1 dado**.
  - Se era **falso** (contagem real < `q`): o fazedor do lance perde **1 dado**.
- **Calza / Exato** (opcional, toggle por sala): aposta que a contagem real é **exatamente** `q`.
  - Acerto: ganha **1 dado** de volta (limitado ao máximo inicial de 5) **ou** remove 1 do oponente (configurável).
  - Erro: perde **1 dado**.
  - No MVP, Calza fica desativado por padrão para simplicidade competitiva.

### 2.5 Fim de round / fim de jogo

- Quem perde um dado também inicia o próximo round.
- Quando um jogador fica sem dados, está **eliminado**.
- Último jogador com dados vence a partida.

### 2.6 Detalhes importantes implementados no motor

- **Empate em Calza:** padrão competitivo trata como erro do calzador.
- **Timeout:** se o jogador não age no tempo, sofre **Dudo automático** contra si (perde 1 dado). Configurável.
- **Reconexão:** tempo em pausa descontado do relógio individual (ver §9).

---

## 3. Glossário

| Termo | Significado |
|-------|-------------|
| **Bid / Lance** | Par `(quantidade, valor)` apostado no turno. |
| **Dudo** | "Duvido" — desafio ao lance anterior. |
| **Calza** | Aposta de quantidade exata. |
| **Ases / Coringas** | Dados de valor 1, que contam como qualquer valor. |
| **Round** | Ciclo que vai de "todos rolam" até alguém perder um dado. |
| **Partida (Match)** | Sequência de rounds até restar um jogador. |
| **Seat** | Posição numerada na mesa (estável durante a partida). |
| **Shaker / Copo** | Metáfora visual para o conjunto privado de dados do jogador. |
| **LDN** | Liar's Dice Notation — formato texto de registro (ver §13). |
| **Tell** | Indício comportamental (reações, timing). |
| **Pool** | Conjunto total de dados em jogo na mesa. |

---

## 4. Arquitetura de alto nível

### 4.1 Macroestrutura

```
                    ┌─────────────────────────┐
                    │    Cliente (Web/Mobile) │
                    │  ┌───────┐  ┌────────┐  │
                    │  │ 2D UI │  │ 3D UI  │  │
                    │  └───┬───┘  └────┬───┘  │
                    │      └─────┬─────┘      │
                    │       Estado local      │
                    └───────────┬─────────────┘
                                │ WebSocket (binário)
                                ▼
            ┌──────────────────────────────────────┐
            │           Edge / Gateway             │
            │   (TLS, rate-limit, sticky session)  │
            └───────────────┬──────────────────────┘
                            ▼
   ┌───────────────┐  ┌───────────────┐  ┌────────────────┐
   │ Game Server   │  │ Match/Queue   │  │ Tournament Svc │
   │ (authoritative│  │ Service       │  │                │
   │  game loop)   │  └───────┬───────┘  └────────┬───────┘
   └───────┬───────┘          │                   │
           │                  ▼                   │
           │         ┌────────────────┐           │
           └────────▶│ Redis (estado  │◀──────────┘
                     │ efêmero, PubSub)│
                     └────────┬────────┘
                              ▼
                     ┌────────────────┐
                     │   PostgreSQL   │  (persistente: usuários, partidas,
                     │                │   rating, LDN, skins, transações)
                     └────────┬───────┘
                              ▼
                     ┌────────────────┐
                     │ Object Storage │  (replays longos, avatares,
                     │  (S3/R2)       │   skins 3D .glb)
                     └────────────────┘
```

### 4.2 Princípios arquiteturais

- **Server-authoritative em tudo que importa.** Dados são sorteados e resolvidos no servidor. Cliente é "dumb terminal" com skin bonita.
- **Estado em Redis** durante a partida (acesso sub-milissegundo). Persistência no Postgres **após** a partida encerrar e nos snapshots.
- **Mensagens binárias** (Protobuf ou MessagePack) no WebSocket. Economia de banda relevante em mobile 3G/4G.
- **Horizontalidade:** cada partida é um "ator" (modelo de atores à la Erlang/Akka ou goroutines Go). Um servidor pode hospedar milhares de partidas concorrentes porque cada uma é majoritariamente I/O-bound entre turnos.
- **Sticky sessions por `matchId`**, não por usuário. Espectadores e jogadores de uma mesma partida caem no mesmo nó.
- **Stateless services** para tudo que não é a loop de partida (rating, perfil, shop, torneios).

### 4.3 Serviços

| Serviço | Responsabilidade | Linguagem sugerida |
|--------|------------------|---------------------|
| **game-server** | Loop de partida, RNG, validação de ações, broadcast de eventos | Rust ou Go |
| **matchmaking** | Filas, emparelhamento por rating, salas customizadas | Go |
| **tournament** | Arenas, Swiss, chaves eliminatórias, prêmios | Go |
| **user / auth** | Contas, OAuth, 2FA, perfis, amigos | Go ou TypeScript |
| **rating** | Cálculo Glicko-2 adaptado (ver §10) | qualquer |
| **shop / ledger** | Transações, inventário cosmético, webhooks Stripe | TypeScript |
| **replay / analysis** | Armazenamento e renderização de LDN, análise probabilística | Python (numérico) |
| **moderation** | Chat filter, anti-cheat signals, banimentos | Python |
| **web-frontend** | SPA + SSR para páginas públicas | TypeScript / Next.js |
| **bot-api** | Endpoint público para bots jogarem | Go |

---

## 5. Stack tecnológica recomendada

**Backend**
- **Rust** (`tokio`, `axum`) para o game-server (latência crítica, zero GC) **ou** **Go** (mais fácil de contratar, performance suficiente).
- **PostgreSQL 16+** com particionamento por data para tabela de matches.
- **Redis 7** (PubSub + estado efêmero + leaderboards via sorted sets).
- **NATS** ou **Redis Streams** para fila inter-serviços.

**Frontend**
- **TypeScript** obrigatório em tudo.
- **Svelte / SvelteKit** (mais leve que React, filosofia lichess-like) **ou** **React + Next.js** se preferir ecossistema.
- **Three.js** + **Rapier** (física WASM determinística) para 3D.
- **PixiJS** ou Canvas2D puro para 2D Light.
- **Tailwind CSS** para estilização utilitária.
- **Howler.js** para áudio.

**Infra**
- **Kubernetes** (EKS/GKE) + **Helm**.
- **Cloudflare** como CDN e proxy WebSocket.
- **Prometheus + Grafana + Loki + Tempo** para observabilidade.
- **Sentry** para erros de cliente.

**Mobile**
- **Capacitor** ou **Tauri Mobile** para reuso do código web — MVP.
- **Nativo (Kotlin/Swift)** para versão premium após validar PMF.

---

## 6. RNG determinístico e sincronização 2D↔3D (núcleo do sistema)

Esta é a parte mais sensível da arquitetura. Quatro problemas se encontram aqui:

1. **Justiça:** garantir que o servidor não rouba e que o jogador verifica.
2. **Sincronização entre modos:** jogador A em 3D e jogador B em 2D devem ver os mesmos resultados.
3. **Espectadores em modos diferentes** devem ver a mesma realidade (e a mesma rolagem).
4. **Replay determinístico** para análise posterior.

### 6.1 Fonte da verdade

- **Resultado dos dados é decidido exclusivamente pelo servidor.** Cliente nunca gera aleatoriedade autoritativa.
- CSPRNG no servidor (`ChaCha20` com seed do `/dev/urandom` por partida).

### 6.2 Esquema commit-reveal (provavelmente justo)

Para cada round:

1. Antes do round começar, servidor gera `server_seed_r` (256 bits).
2. Servidor publica `H(server_seed_r)` — **o compromisso**.
3. Cada cliente envia `client_seed_r` (32 bits aleatórios).
4. Quando o round termina, servidor **revela** `server_seed_r`.
5. Seed efetivo do round: `final_seed = HKDF(server_seed_r || client_seed_1 || ... || client_seed_n || matchId || round_number)`.
6. Os valores dos dados são derivados determinística e publicamente do `final_seed`.

Qualquer pessoa pode, depois, recalcular e verificar que o servidor não trapaceou. Cliente oficial exibe um selo "✔ verificado" ao final de cada partida.

### 6.3 Geração dos valores dos dados

```
dado_i = 1 + (PRF(final_seed, "dice", player_id, die_index) mod 6)
```

Onde `PRF` é HMAC-SHA256. Determinístico, uniforme, auditável.

### 6.4 Sincronização 2D↔3D — o truque chave

A rolagem 3D é **puro teatro visual**. Ela **nunca** decide o valor do dado. O valor já foi decidido pelo servidor.

**Pipeline:**

1. Servidor envia, no início do round:
   - `dice_commitments` (hashes por jogador, para fair-play)
   - `physics_seed` (64 bits): controla trajetória da animação
   - `roll_duration_ms` (ex: 1800ms) — igual para todos
2. Cliente 3D:
   - Alimenta `physics_seed` no simulador Rapier determinístico.
   - Gera forças iniciais pseudoaleatórias (posição do copo, impulso, spin).
   - Simula `roll_duration_ms - 150ms`.
   - Nos últimos 150ms, aplica **rotação corretiva** para garantir que cada dado descanse com a face correta para cima (imperceptível se bem ajustado).
3. Cliente 2D Light:
   - Anima "shake" do copo e "pop" dos dados, com o mesmo `roll_duration_ms`.
   - Timing dos sprites usa `physics_seed` também — assim o "jeito" da rolagem casa entre modos (quem mudar 2D↔3D no meio da partida vê continuidade).
4. Jogador só vê seus próprios dados (os outros são "copos fechados").

**Por que essa abordagem é correta:**

- **Determinismo preserva justiça:** seed do servidor é a autoridade; física é estética.
- **Custo de CPU baixo:** correção final é 2–3 quaternions, não re-simulação.
- **Espectadores veem a mesma realidade:** todos recebem os mesmos dados do servidor, independentemente do modo.
- **Replay funciona:** `physics_seed` é salvo no LDN, então replay 6 meses depois mostra exatamente a mesma animação.

### 6.5 Transparência

Página pública `/fair-play` explica o esquema com exemplos executáveis. Um CLI open-source permite que qualquer usuário recompute qualquer partida a partir do LDN.

---

## 7. Motor de física e pipeline de animação

### 7.1 Arquitetura dual: estética + resultado

```
Servidor decide resultado → Cliente anima com física → Cliente snap-corrige para o resultado
```

### 7.2 Stack de física

- **Rapier** (Rust compilado para WASM) — determinístico cross-plataforma, roda a 60fps em celular médio.
- Alternativa mais leve: **Cannon-es**, menos determinística; usar apenas como fallback no modo 3D Light.

### 7.3 Pipeline de rolagem (3D Full)

1. **Pre-roll:** copo desce na tela, anima "chacoalhar" (spring animation no UI thread).
2. **Release:** servidor envia `{physics_seed, duration, dice_count}`.
3. **Throw:** 5 dados spawnam no copo, forças iniciais derivadas do seed (variação de ±15% em magnitude, ±30° em direção).
4. **Simulate:** Rapier roda steps fixos de 16.67ms.
5. **Settle detection:** por dado, quando velocidade linear e angular < ε, marca como "em repouso".
6. **Reveal correction:** nos 150ms finais, interpolar a orientação do dado (slerp) para que a face-alvo (vinda do servidor) fique para cima. 150ms é curto o bastante para ser invisível em quaternions.
7. **Fade-in da UI** com os valores dos dados do próprio jogador.

### 7.4 Nível de detalhe (LOD)

- **3D Full:** modelos com 500–1500 polígonos por dado, sombras dinâmicas, normal maps, bloom leve.
- **3D Light:** 200–400 polígonos, sombra "blob" (círculo escuro pré-renderizado), sem bloom, física com substeps reduzidos, 30fps alvo. Mesa simplificada.
- **2D Light:** SVG/Canvas. Dados são sprites de face única; animação é shuffle + snap. Sub-50KB de assets iniciais.

### 7.5 Sincronização de relógio entre clientes

Se 6 jogadores assistem ao mesmo round em dispositivos diferentes, o início da animação é carimbado com `t_roll = server_time + 200ms buffer`. Cada cliente ajusta para seu clock-skew (calibrado em conexão inicial) e inicia a animação no mesmo momento absoluto. Sem isso, vira circo — um vê resultado 400ms antes do outro.

---

## 8. Modos de renderização

### 8.1 Três modos, um estado

| Modo | Público-alvo | Assets | Render | Física | FPS alvo |
|------|--------------|--------|--------|--------|----------|
| **3D Full** | Desktop, conexão boa | ~15MB inicial | WebGL2, Three.js | Rapier full | 60 |
| **3D Light** | Laptop básico, celular high-end | ~4MB inicial | WebGL1 fallback | Rapier reduzido | 30–60 |
| **2D Light** | Celular antigo, dados móveis, modo "jogo no trabalho" | <300KB inicial | SVG/Canvas2D | Nenhuma, animação CSS | 60 sem esforço |

### 8.2 Troca de modo em tempo real

- Usuário pode trocar o modo **em qualquer momento**, inclusive no meio da partida.
- O estado é uno; apenas o render layer muda.
- Preferência salva por perfil + auto-detecção inicial (device capability check: `WebGLRenderingContext.MAX_TEXTURE_SIZE`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`).

### 8.3 Modo "trabalho"

Flag "discreto" no 2D Light: interface minimalista, paleta monocromática, sem sons. Para quando o jogador está jogando escondido do chefe. Este é o tipo de feature que constrói afeição pela plataforma.

---

## 9. Protocolo de rede, estado e reconexão

### 9.1 Transporte

- **WebSocket** com mensagens **Protobuf** (compacto, esquematizado).
- Heartbeat a cada 15s.
- Fallback para SSE + long-polling em redes corporativas que bloqueiam WS.

### 9.2 Modelo de eventos

Servidor emite eventos imutáveis, cliente reduz sobre estado local (padrão event-sourcing):

```proto
message GameEvent {
  uint64 sequence = 1;       // ordenação total
  uint64 timestamp_ms = 2;
  oneof payload {
    RoundStart round_start = 10;
    DiceRolled dice_rolled = 11;   // contém só dados do próprio jogador
    DicePublic dice_public = 12;   // só contagens públicas, por jogador
    BidPlaced bid_placed = 13;
    DudoCalled dudo_called = 14;
    RoundResolved round_resolved = 15;
    PlayerEliminated player_eliminated = 16;
    MatchEnded match_ended = 17;
    ChatMessage chat = 20;
    TimerTick timer_tick = 30;
  }
}
```

Cliente envia apenas **comandos** (`PlaceBid`, `CallDudo`, `CallCalza`, `OfferDraw`, `Resign`, `SendChat`).

### 9.3 Estado público vs. privado

- **Público** (todos veem): quem joga, quantos dados cada um tem, lance atual, histórico de lances, relógios.
- **Privado** (só o dono): os valores dos seus 5 dados.

Dois canais:
- `match:{id}:public` — todos os eventos que qualquer um pode ver (broadcast).
- `user:{uid}:private` — evento com os dados privados do jogador (unicast criptografado ao canal TLS).

### 9.4 Reconexão

- Tolerância de **60s** para reconexão sem penalidade.
- Servidor mantém estado em Redis com TTL.
- Ao reconectar, cliente envia `last_seen_sequence` e servidor manda delta de eventos.
- Timer do jogador **pausa** durante desconexão (para não punir queda de internet) — até um máximo de 60s por partida. Depois disso, timer volta a correr.
- Se desconectar no turno: "graça" de 10s antes do timer tomar nota.

### 9.5 Anti-ataque básico

- Rate limit de comandos: 5/s por conexão.
- Mensagens de chat: 1 por segundo, até 3 mensagens pendentes no buffer.
- Tamanho máximo de mensagem: 4KB.
- Assinatura HMAC opcional para clientes bot.

---

## 10. Matchmaking, rating e fila

### 10.1 Por que Elo/Glicko "puro" não funciona

Liar's Dice é **multiplayer assimétrico** (2–6 jogadores por partida, eliminação progressiva). Isso quebra pressupostos do Elo 1v1.

**Solução:** **TrueSkill** (Bayesiano, Microsoft Research) **ou** **Glicko-2 multiplayer** adaptado. Recomendação: começar com TrueSkill — bem documentado e bibliotecas open-source maduras.

- Skill = `(μ, σ)` por jogador.
- Rating exibido = `μ - 3σ` (rating conservador estilo Xbox Live).
- Partidas em mesa de 2 atualizam como 1v1; mesas maiores usam ranking final (1º, 2º, 3º, eliminado).

### 10.2 Categorias de rating

- **Bullet:** <30s por lance.
- **Blitz:** 30–90s por lance.
- **Rápido:** 1.5–4min por lance.
- **Clássico:** >4min por lance.
- **Correspondência:** 1 lance por dia.

Cada categoria tem rating independente. Nomenclatura herdada de xadrez online para familiaridade.

### 10.3 Fila

- Jogador escolhe categoria + tamanho de mesa (2, 3, 4, 5, 6).
- Matchmaking procura em janela de rating ±100, alargando 50 pontos por 15s de espera.
- Espera mediana alvo: <20s para modos populares em horários de pico.
- **Anti-sandbagging:** quem reduzir rating artificialmente (perder de propósito) é penalizado via detecção de padrão (ver §16).

### 10.4 Partidas não-ranqueadas

Disponíveis sempre como "casual". Não afetam rating. Úteis para amigos com diferença grande de skill.

---

## 11. Tipos de partida e controles de tempo

### 11.1 Tipos

| Tipo | Descrição |
|------|-----------|
| **Quick Match** | Clique único, fila padrão (Blitz, 4 jogadores). |
| **Ranked** | Afeta rating, fila por categoria. |
| **Casual** | Sem rating. |
| **Custom Room** | Sala privada com link compartilhável. Configurações livres. |
| **Private vs Friend** | Desafio direto pelo perfil. |
| **Correspondence** | Longa duração, 1 turno por dia/horas. Até 16 partidas simultâneas por jogador. |
| **Spectate** | Entrar em qualquer partida pública como observador. |
| **vs Bot** | Treino contra IA em vários níveis (ver §15). |

### 11.2 Controles de tempo

Dois relógios por jogador, independentes:

- **Relógio de turno:** quanto tempo o jogador tem para fazer **este** lance.
- **Relógio de reserva (banco):** tempo acumulado ao longo da partida (estilo xadrez byoyomi/increment).

**Presets sugeridos:**

- **Hiper-bullet:** 15s por turno + 3s increment.
- **Bullet:** 30s + 5s.
- **Blitz:** 60s + 10s.
- **Rápido:** 3min + 30s.
- **Clássico:** 10min + 60s.
- **Correspondência:** 1 dia por turno, 7 dias de banco.

### 11.3 Custom

Sala customizada permite:
- Número de dados iniciais (3 a 7).
- Calza on/off.
- Ases-coringa on/off.
- Timer custom.
- Senha de sala.
- Spectators on/off.
- Registro no LDN on/off (para partidas privadas casuais).

---

## 12. Torneios

### 12.1 Formatos

1. **Arena (estilo lichess):** duração fixa (ex: 90min). Jogadores pareados continuamente. Berserk disponível (metade do tempo por +50% pontos). Ranking por pontuação acumulada.
2. **Swiss:** N rodadas, pareamento por pontuação, sem eliminação.
3. **Simples Eliminação:** chaveado.
4. **Dupla Eliminação.**
5. **Round Robin** (mini, entre amigos).
6. **Liga Sazonal:** divisões promoção/rebaixamento, a cada 30 dias.

### 12.2 Infraestrutura

- Arenas grandes (>1000 jogadores) exigem *sharding* — separar em subpools que se mesclam no ranking final.
- Tournament Service coordena; game-servers executam as partidas.
- Chat do torneio em canal global do evento (moderado).

### 12.3 Prêmios

- **Troféus cosméticos** (permanentes no perfil).
- **Medalhas** (podem ser exibidas ao lado do nome por 30 dias).
- **Patron months** (para finalistas em arenas oficiais).
- Nunca dinheiro real vindo da plataforma (evita classificação como jogo de azar em muitas jurisdições; ver §23).

---

## 13. Liar's Dice Notation (LDN)

**Por que notação importa:** sem formato textual padrão não há replays exportáveis, análise offline, banco de partidas públicas, livros de abertura (sim, Liar's Dice tem teoria), torneios importáveis, nem ecossistema de bots. PGN fez isso pelo xadrez; LDN precisa existir para LD.

### 13.1 Design

Formato texto plano, `.ldn`, UTF-8. Cabeçalho em tags estilo PGN, corpo em linhas turno-a-turno.

### 13.2 Exemplo

```
[Event "Weekly Blitz #142"]
[Site "liarsdicearena.org"]
[Date "2026.05.03"]
[Round "3"]
[White "Alice"]      # seat 0
[P1 "Bob"]           # seat 1
[P2 "Carla"]         # seat 2
[P3 "Diego"]         # seat 3
[Result "Alice"]
[TimeControl "60+10"]
[Variant "Classic"]
[Wildcard "Aces"]
[Calza "Off"]
[ServerSeedHash "sha256:3f2a..."]
[ServerSeedReveal "a91f..."]
[ClientSeeds "0x1234,0xabcd,0x0f0f,0x7777"]
[PhysicsSeed "0x8badf00d"]

1. R { A:[3,3,1,5,6] B:[2,4,4,6,1] C:[1,1,2,3,6] D:[5,5,5,2,4] }
   A 2x5 ; Bob 3x5 ; Carla 4x5 ; Diego dudo!
   => real=5(5s)+3(1s)=8, claim=4 → claim verdadeiro → Diego -1d

2. R { A:[1,2,3,4,6] B:[3,6,6,6] C:[1,2,5,5,5] D:[2,3,4] }
   B 3x6 ; Carla 4x5 ; Diego 5x5 ; Alice dudo!
   => real=3(5s)+2(1s)=5, claim=5 → claim verdadeiro → Alice -1d
...

{MatchEnd: Alice (5 dados), all others eliminated}
```

### 13.3 Especificação resumida

- `R { ... }` = resultado da rolagem (privado durante jogo, revelado no arquivo final).
- Lances: `<Jogador> <q>x<v>` ou `<Jogador> dudo!` / `<Jogador> calza!`.
- `;` separa lances no mesmo round.
- Metadados crypto permitem verificação provavelmente-justa offline.

### 13.4 Ferramentas do ecossistema

- Parser/emitter em Rust + bindings JS (referência).
- CLI `ldn` com subcomandos: `verify`, `replay`, `stats`, `diff`.
- Endpoint público `GET /match/{id}.ldn`.

---

## 14. Análise, replays, puzzles e treino

### 14.1 Replay

- Qualquer partida pública é replayável infinitamente.
- Timeline scrubbable.
- Modo "ao vivo" (reproduz com tempos reais) e "rápido" (pulando pausas).
- Toggle "mostrar tudo" (após fim, ver dados de todos) vs. "perspectiva de X".

### 14.2 Motor de análise (análise post-mortem)

Para cada lance do jogador, computar:

- **Probabilidade do lance ser verdadeiro**, dado seus dados (informação privada) e o pool (informação pública).
- **Expected Value (EV)** de: subir lance / chamar Dudo / calzar.
- **Classificação do lance:** excelente / bom / impreciso / erro / blunder (espelho direto do lichess chess analysis).
- **Gráfico de "accuracy" ao longo da partida** por jogador.
- **Heatmap de faróis:** lances que foram blefe detectados/não detectados.

Isso é computável porque após o fim da partida o LDN tem informação completa — o motor pode calcular condicionais exatas.

### 14.3 Puzzles

Tipo lichess puzzles, mas probabilísticos:

> "Você tem `[2,2,5,5,6]`. Lance atual: Alice chamou `5x5`. É sua vez. Qual a jogada ótima em EV?"
> Opções: `6x5` / `Dudo` / `3x6` / `Calza 5`.

- Banco de puzzles gerado automaticamente de partidas ranqueadas altas com jogadas marcadas como pivotais pelo motor.
- **Puzzle Rush:** resolver máximo em 3min, 5min, 10min.
- **Storm mode:** puzzles infinitos, erros acumulam penalidade de tempo.
- **Puzzle of the Day.**

### 14.4 Treino específico

- **Probability trainer:** "Com 4 dados desconhecidos, qual a chance de haver ao menos 3 cincos (contando coringas)?"
- **Tell trainer:** vídeos de reações (opcionais, cosmético).
- **Opening theory:** primeiro lance do round tem meta-teoria (ex: lances muito baixos em round inicial com 5 dados cada dão pouca informação e são quase sempre verdadeiros).
- **Endgame trainer:** 1v1 com 1 ou 2 dados restantes — situações tensas onde o cálculo é exato.

### 14.5 Insights pessoais

Painel no perfil com estatísticas:

- **Taxa de blefe:** % dos seus lances que foram falsos.
- **Taxa de blefe bem-sucedido:** % dos blefes não chamados.
- **Taxa de detecção:** % de `Dudo` corretos.
- **Lance médio por dado no pool:** calibração do jogador.
- **Desempenho por valor** (você é melhor com 5s? Com 6s?).
- **Curva de performance por hora do dia.**

---

## 15. Bots e IA

### 15.1 Níveis

- **Nível 1 (Novato):** lances aleatórios válidos, Dudo com probabilidade fixa.
- **Nível 3 (Casual):** cálculo de probabilidade exato, sem modelo de blefe.
- **Nível 5 (Intermediário):** cálculo de probabilidade + blefe básico (blefa X% em lances Y).
- **Nível 7 (Avançado):** Monte Carlo tree search + modelagem de oponente.
- **Nível 9 (Mestre):** CFR (Counterfactual Regret Minimization) treinado em milhões de partidas auto-jogadas. Equilíbrio de Nash aproximado.

### 15.2 API pública para bots humanos

Como lichess tem BOT account tier:

- Conta marcada `BOT`, não pode jogar em partidas humanas ranqueadas (fila separada `Bot Arena`).
- OAuth token restrito.
- Endpoints REST + streaming WebSocket.
- Quota generosa (milhares de partidas/dia).

Isso atrai pesquisadores de IA e cria ecossistema (como Maia/Leela fizeram com xadrez).

### 15.3 Torneios de bots

Eventos mensais exclusivos para bots, com ranking paralelo. Cria hype em comunidades de ML.

---

## 16. Anti-trapaça e anti-conluio

Liar's Dice tem **duas superfícies de ataque** que xadrez não tem tanto:

1. **Informação privada:** se o cliente puder ver dados de outros, tudo acaba.
2. **Jogos multiplayer são vulneráveis a conluio** (dois jogadores dividindo informação de dados via Discord).

### 16.1 Defesas fundamentais

- **Dados privados nunca são enviados a clientes errados.** Auditoria do protocolo.
- **Cliente oficial não tem memória "esquecível"** — screenshots ficam à responsabilidade do jogador. Mas: dados privados **nunca** são escritos em logs de cliente.
- **Sala vs. amigos:** em partidas ranqueadas, **jogadores com histórico muito amigo não podem ser pareados** (filtro). Em customs, é livre.

### 16.2 Detecção de conluio

Sinais telemétricos:

- Dois jogadores que aparecem juntos em >X% das mesas públicas.
- Padrão de lances que "ajuda" consistentemente outro jogador.
- IPs, fingerprints de navegador, timing de cliques correlacionados.
- Contas criadas no mesmo dia, do mesmo IP.
- Modelos probabilísticos: comparar jogada real vs. jogada ótima dado apenas informação pública. Se for ótima demais condicionalmente em quando outro jogador específico está na mesa, é red flag.

Pipeline:

1. Sinais coletados em tempo real → Kafka / Redis Streams.
2. Batch diário processa em ClickHouse, produz scores de suspeita.
3. Casos acima de threshold entram em fila humana de revisão.
4. Moderadores com ferramentas dedicadas (ver partidas anotadas, confrontar).
5. Penalidades graduais: aviso → lockout ranked → ban temporário → ban permanente.

### 16.3 Detecção de trapaça single-player

- Jogadores com performance estatística "impossível" (accuracy de Dudo muito acima do teórico em amostras grandes).
- Timing sobre-humano (resposta em <200ms consistentemente em decisões não triviais).
- Transferência de rating (nova conta sobe estranhamente rápido).

### 16.4 Sandbagging

Detecção de perda proposital de rating para predar iniciantes. Baseado em:

- Perdas "suspeitamente rápidas" em sequência.
- Correlação entre queda de rating e aumento de win rate depois.

Penalidade: rating congelado para baixo enquanto win rate for anormalmente alto.

---

## 17. Chat, moderação e comunidade

### 17.1 Chat em partida

- Opcional ("Chat off" por padrão para partidas ranqueadas — evita tilt).
- Filtro de palavrões por idioma (lista curada por voluntários).
- Menções automáticas detectadas e limitadas (proteção contra assédio).
- Toggle de "chat zen" (só emotes pré-definidos: 👍 👎 😂 🤔 🎲 — como Hearthstone).

### 17.2 Fórum e blog

- Blog oficial com notas de atualizações, análise de torneios, perfis de jogadores.
- Fórum categorizado (geral, ajuda, teoria, bots, dev, feedback).
- Sistema de reputação leve (upvotes não compram nada; só visibilidade).

### 17.3 Moderação

- **Reports in-game** (assédio, conluio, trapaça, nome impróprio).
- **Time de mods voluntários** com permissões graduais.
- **Public moderation log** (casos resolvidos, sem dados pessoais). Transparência constrói confiança.

### 17.4 Integrações

- **Discord OAuth:** login e servidor oficial.
- **Twitch extension:** viewers votam "blefe ou não?" em live streams enquanto o jogador decide.
- **YouTube chapters automáticos** via LDN exportado.

---

## 18. Monetização

### 18.1 Princípios

1. **Nenhuma vantagem competitiva à venda.** Cosmético puro.
2. **Transparência radical de preço e uso de fundos** (relatório anual).
3. **Patron tier** para quem quiser doar sem querer cosmético.
4. **Sem loot boxes.** Tudo preço fechado.
5. **Skins criadas por artistas ganham royalty** (20–40% do preço) — cria ecossistema e qualidade.

### 18.2 SKUs cosméticos

**Skins de dados:**
- Madeira, osso, mármore, vidro, neon, pixel-art, origami, galáxia, piratas, etc.
- Tiers: comum (R$5), raro (R$15), épico (R$30), lendário/animado (R$50–80).
- Visíveis em modo 3D Full e 3D Light. No 2D Light, viram pattern do sprite.

**Skins de copo / shaker:**
- Couro, metal, dragão gravado, vidro transparente (sim, de brincadeira — só mostra os dados do jogador).

**Skins de mesa:**
- Tavernas medievais, nave espacial, praia, sala vitoriana, sala cyberpunk.

**Avatares e molduras de perfil.**

**Animações de vitória** (emotes pós-partida, tipo Fortnite dances, mas discretos).

**Packs de sons:**
- "Dungeon master", "Pirate cove", "ASMR", "8-bit", "Minimalista silencioso".

**Temas de interface (skins do próprio site).**

**Tokens de torneio** (apenas para torneios casuais cosméticos; nunca para ranqueados — esses são sempre gratuitos).

### 18.3 Patron tier

- R$15/mês, R$40/trimestre, R$150/ano.
- Benefícios: **apenas cosméticos e quality-of-life** (badge no nome, cor do nome, tema exclusivo, ver mais estatísticas históricas, uploads de avatar maiores). **Nada competitivo.**
- Nome no Wall of Supporters.

### 18.4 Presentes

- Poder enviar skins de presente a outro jogador (constrói comunidade).

### 18.5 Eventos sazonais

- Skins limitadas de Halloween, Natal, etc. Sem FOMO tóxico — ficam disponíveis por 30 dias, voltam no próximo ano.

### 18.6 Governança financeira

- Relatório anual público de receita e gastos.
- Reservas financeiras para 18 meses de operação (sobrevivência).
- Excedente reinvestido em infra, bolsas para moderadores, torneios com prêmios cosméticos.

---

## 19. Acessibilidade, UX e i18n

### 19.1 Acessibilidade

- **Contraste AAA** no 2D Light.
- **Modo daltônico:** paletas substitutas (Deuteranopia, Protanopia, Tritanopia). Dados usam **número + forma + cor**, nunca só cor.
- **Leitor de tela completo** para ações de jogo: "Alice subiu para 3 cincos. Sua vez."
- **Navegação por teclado** completa (shortcuts estilo lichess: `space` para confirmar lance, `d` para Dudo, etc.).
- **Modo redução de movimento:** física 3D desativa, dados aparecem sem rolagem.
- **Legendas para sons importantes.**
- **Tamanho de fonte ajustável** até 200% sem quebra de layout.

### 19.2 Microcopy e onboarding

- Tutorial interativo de 3 minutos: regras, primeira partida contra bot, explicação do Dudo.
- **Tool-tips contextuais** nos primeiros lances ("este lance é possível porque…").
- **Assistente de probabilidade toggle-avel** para iniciantes (mostra EV do lance sugerido, em partidas casuais).

### 19.3 Internacionalização

- Core: pt-BR, en-US, es-ES, es-MX (já que LD é huge na América Latina — Peru, Bolívia, Chile, Argentina).
- Ondas seguintes: fr, de, it, zh-CN, ja, ko, ru.
- Plataforma de tradução colaborativa (Crowdin ou self-hosted Weblate).
- Nomes locais aceitos (Perudo, Dudo, Cacho, Pico, Liar's Dice) com preferência por usuário.

---

## 20. Mobile e multiplataforma

### 20.1 Web-first

Site funciona perfeitamente em mobile browser. PWA instalável. Push notifications para:
- Sua vez em partida de correspondência.
- Amigo te desafiou.
- Início de torneio que você se inscreveu.
- Nunca para marketing/engajamento.

### 20.2 Apps nativos (fase 2)

- **iOS e Android** via Capacitor inicialmente; migração para React Native ou nativo quando houver PMF.
- Integração com Game Center / Play Games (opcional).

### 20.3 Desktop

- Versão **Tauri** (binário ~15MB) para desktop com janela customizada, tray icon, modo full-screen cinema para partidas casuais.

---

## 21. API pública e ecossistema

### 21.1 Endpoints

- `REST` para leitura (perfis, rating, partidas, torneios).
- `WebSocket` para bots jogarem e para ferramentas de broadcasting.
- OAuth 2.0 + PKCE.

### 21.2 Clientes oficiais

- JavaScript/TypeScript: `ldarena-js`.
- Python: `ldarena-py`.
- Rust: `ldarena-rs`.
- CLI: `ldarena-cli` (jogar pelo terminal — cult following garantido).

### 21.3 Widgets embutíveis

- Embed de partida ao vivo para blogs.
- Badge de rating para assinaturas de fórum.
- Puzzle do dia embutível.

### 21.4 Broadcasting API

Dados estruturados para streamers/produtores de conteúdo cobrirem torneios. Inclui replay sincronizado, overlay de probabilidades em tempo real, perfis dos jogadores.

---

## 22. Infraestrutura, DevOps, observabilidade

### 22.1 Ambientes

- `dev` → `staging` (dados sintéticos) → `production`.
- Feature flags (Unleash ou similar) para lançamentos graduais.

### 22.2 CI/CD

- Todo PR roda: testes unitários, integração, e2e (Playwright em cenários de partida completa).
- Deploy canário (5% → 25% → 100%).
- Rollback automático se error rate subir 2x baseline.

### 22.3 Observabilidade

- Métricas críticas:
  - P50/P95/P99 de latência de ação-para-broadcast.
  - Partidas ativas concorrentes.
  - Tempo médio de matchmaking.
  - Taxa de desconexão dentro de partidas.
  - Taxa de reports / 1000 partidas.
- SLO: 99.9% disponibilidade do game-server, 99.5% fim-a-fim.
- Alertas pageáveis: latência p99 > 300ms, error rate > 0.5%, fila de matchmaking > 60s mediana.

### 22.4 Capacidade

Estimativa de custos MVP para 10k DAU / 1k MAU pagantes:
- 3 × c6i.large game-servers: ~US$250/mês.
- RDS Postgres db.t4g.medium multi-AZ: ~US$150/mês.
- Redis ElastiCache t4g.small: ~US$40/mês.
- Cloudflare: US$0 (free tier atende).
- S3: <US$50/mês.
- Observabilidade (Grafana Cloud): ~US$100/mês.
- **Total infra inicial: ~US$600/mês.** Muito viável via patronos.

---

## 23. Legal, privacidade, jogo responsável

### 23.1 Classificação

- **Não é jogo de azar.** Sem dinheiro real como prêmio. Cosméticos não são resgatáveis em dinheiro. Skins presenteáveis, não comerciáveis em marketplace secundário (evita "skin gambling").
- Classificação etária: **12+** em lojas de app (temática de blefe, nada mais).

### 23.2 Privacidade

- **LGPD (BR) + GDPR (EU) + CCPA (CA) compliance** desde o dia 1.
- Dados mínimos (email + senha ou OAuth).
- Exportação e deleção por self-service.
- Sem rastreamento para terceiros.
- Analytics internos anônimos (Plausible ou similar self-hosted).

### 23.3 Jogo responsável

- **Limites de sessão opcionais** ("te avisar após 2h jogando").
- **Cooldown opcional** entre partidas ranqueadas após sequência de derrotas (redução de tilt).
- **Auto-exclusão temporária** (24h, 7d, 30d, 365d) com um clique.
- Links para recursos de jogo responsável e saúde mental.

### 23.4 Termos

- ToS claro, em português simples.
- Política de chargeback clara (skin virtual não tem reembolso após uso, mas suporte caso a caso).

---

## 24. Métricas e KPIs

**North Star Metric:** **Partidas Completadas por DAU Ativo**. Captura engajamento real melhor que MAU.

**Métricas de produto:**
- D1, D7, D30 retention.
- Tempo médio até primeira partida (novos).
- % de novos que completam onboarding.
- % de contas que fazem segunda partida no mesmo dia.

**Métricas de qualidade:**
- Tempo mediano de matchmaking por categoria.
- Taxa de partidas completadas sem desconexão.
- Latência p95 fim-a-fim.
- Reports / 1000 partidas.
- Tempo médio de triagem de report.

**Métricas de negócio (se houver):**
- Conversão para patron (%).
- LTV de patron.
- Receita por skin top-20.
- Razão cosmético / patron na receita.

---

## 25. Roadmap de 18 meses

### Fase 0 — Fundação (meses 1–3)
- Regras e motor de jogo em Rust puro (sem rede).
- Test suite exaustiva (property-based testing com `proptest`).
- Especificação LDN v0.1.
- Protótipo 2D Light jogável local.

### Fase 1 — MVP Online (meses 4–6)
- Game-server com WebSocket.
- Contas e matchmaking básico (Blitz, 4 jogadores).
- 2D Light em produção.
- Sistema de rating (TrueSkill).
- Replay básico.
- Chat simples com filtro.
- **Lançamento em alpha privado (invite).**

### Fase 2 — Beta público (meses 7–9)
- 3D Light.
- Salas customizadas, espectadores.
- Puzzles geração automática.
- Bots nível 1–5.
- Perfis e amigos.
- Torneio Arena.
- **Lançamento em beta público.**

### Fase 3 — Polimento e receita (meses 10–12)
- 3D Full com física Rapier.
- Loja de skins v1.
- Patron tier.
- Análise post-mortem do motor.
- API pública v1.
- App mobile PWA polida.
- **Lançamento 1.0.**

### Fase 4 — Expansão (meses 13–18)
- Bots nível 7+ e arena de bots.
- Correspondência.
- Mais formatos de torneio (Swiss, ligas).
- Apps nativos iOS/Android.
- Integração Twitch.
- Primeira temporada com prêmios cosméticos grandes.
- Variantes opcionais (Palifico, Common Hand — fora do escopo deste doc mas planejável).

---

## 26. Ideias fora da caixa

Coisas que raramente aparecem em pitches de "lichess para X" mas que são exatamente o tipo de detalhe que decide se o produto tem alma:

1. **Modo "Blefe Replay":** ao final de uma partida, você pode replicar a mesma partida mas trocando suas decisões. Motor recalcula os outros jogadores com IA clone. "E se eu tivesse chamado Dudo no terceiro lance?"

2. **Hand Reveal cinemática:** quando o Dudo acontece, a revelação dos dados dos 6 copos é um momento dramático. Em 3D Full, cada copo levanta com timing ligeiramente diferente para maximizar suspense. Adicionar **controle de volume de dramaticidade** no settings (off / sutil / normal / filme).

3. **Voz pré-definida (sem chat de voz aberto):** 8 sons tipo "Hmmm...", "Essa é boa...", "Acho que vou...", gravados por dubladores em vários idiomas. Expressa personalidade sem risco de toxicidade.

4. **Tells opcionais:** se ambos os jogadores optarem, pequenos sinais visuais aparecem baseados em padrões de lance (um brilho sutil quando o jogador blefa com frequência atípica). Vira um meta-jogo de leitura. Disabled em partidas ranqueadas sérias por default.

5. **Modo Profético:** jogador anota antes de revelar "eu acho que existem 4 cincos". Ao final, sistema pontua a calibração (estilo Brier score). Gera um sub-rating "leitor de mesa" paralelo ao rating principal.

6. **Mesa Cega:** modo onde você não vê quantos dados cada oponente tem. Escurece a assimetria informacional. Variante experimental.

7. **Modo Narrador:** durante replays, um narrador IA gera comentário tipo esporte. Útil para content creators.

8. **Diário de bordo automático do jogador:** após cada partida, resumo textual curto gerado por IA: "Você venceu Alice e Bob. Seu blefe em 4x6 no round 3 foi especialmente ousado mas bem timed." Cria ritual diário.

9. **Partida assíncrona "Pub":** entra em uma mesa pública e sai a qualquer hora — outro jogador te substitui. A mesa nunca morre, existe por dias com rotação de jogadores. Tipo um bar virtual sempre aberto.

10. **Calibração de rating contra bot inicial:** novo usuário faz 10 partidas contra bots de dificuldades variadas. Sistema infere rating inicial com 2-3 sigma de incerteza em vez de partir de 1500 puro.

11. **"Shadow mode":** jogador pode observar uma partida em andamento e registrar em paralelo como ele teria jogado cada lance. Não afeta a partida real; no fim recebe análise comparativa.

12. **Opening book comunitário:** compilação das estatísticas de primeiro lance por categoria e tamanho de mesa. Tipo ECO de xadrez: "A Abertura Boliviana (2x2 com 5 jogadores): taxa de vitória 54.3%". Comunidade dá nome e comenta.

13. **Integração com dados físicos (BLE dice):** parceria com fabricantes de dados eletrônicos Bluetooth. Jogador rola dado real, app lê resultado. Partidas híbridas presencial/online. Futurista mas tecnicamente viável.

14. **Tournament scheduler inteligente:** cria torneios em horários ótimos por fuso horário dos usuários online, não por "horário de Brasília".

15. **Streamer mode:** esconde ratings, nomes, balanço de inventário — para evitar snipers em streams ao vivo.

16. **Autopsy feature:** em partidas perdidas, um modal opcional "quer revisar sua pior jogada?" com o motor já destacando. Clique único, reduz frustração, transforma derrota em aprendizado.

17. **Duelo "Best of N":** formato de curta série (melhor de 3, 5, 7). Muito requisitado em comunidade competitiva.

18. **"Mesa silenciosa":** flag de sala onde ninguém pode chatear, só jogar. Zen.

19. **Skin-swap rápido:** atalho (`Ctrl+K`) abre paleta para trocar skin de dado em 2s mid-game. Jogadores adoram customizar.

20. **Replay sharing com carimbo de momento:** "veja a partida a partir do round 4" via URL com query param `#r=4&t=127s`. Viral em Twitter.

21. **Puzzle generator by invite:** você compartilha situação da sua partida como puzzle: "o que você teria feito aqui?" Amigo resolve. Gera discussão.

22. **Anti-doom-scrolling:** após 5 derrotas seguidas, o sistema **gentilmente sugere** uma pausa ou partida casual. Não bloqueia, só cuida. Diferencial ético real.

23. **Contribuidor da semana:** destaque no blog para quem contribuiu com código, tradução, skin, puzzle. Ecossistema se alimenta de reconhecimento.

24. **Exportação de partida como GIF/vídeo:** 1 clique e tem um mp4 de 15s com a última rodada. Compartilhamento social orgânico.

25. **"Skin de caridade":** skins cuja receita integral vai para uma ONG votada pela comunidade. Alinha os valores e diferencia monetariamente.

---

## 27. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| **Matchmaking vazio nos primeiros meses** | Alta | Alto | Bots realistas preenchem; parcerias com comunidades LD; campanha de seed de torneios semanais. |
| **Custos de infra escalando além do esperado** | Média | Alto | Arquitetura escalável horizontal desde o dia 1; cache agressivo; monitoramento de custo por partida. |
| **Conluio em torneios de prestígio** | Alta | Médio | Ferramentas de detecção (§16) prontas antes do primeiro torneio ranqueado grande. |
| **Classificação legal como jogo de azar** | Baixa | Crítica | Consultoria jurídica; zero conversão de cosméticos para dinheiro; disclaimers claros. |
| **Toxicidade em chat** | Alta | Médio | Chat off por default em ranqueadas; report rápido; moderação ativa; opção "chat zen". |
| **Performance em mobile antigo** | Média | Alto | 2D Light obrigatoriamente <300KB inicial, 60fps em dispositivo de R$500. |
| **Trapaça via info-leak no cliente** | Média | Crítica | Auditoria de protocolo; pen-test contínuo; bug bounty. |
| **Competidor com marketing agressivo** | Média | Médio | Moat por comunidade + código aberto + qualidade técnica. Lichess sobreviveu a Chess.com por isso. |
| **Skin artist ecosystem não decolar** | Média | Baixo | Começar com artistas internos; abrir gradualmente; royalties competitivos. |
| **Física determinística quebrar em nova versão de browser** | Baixa | Alto | Snapshot de resultados em CI por navegador + versão; regressão visual com Percy/Chromatic. |

---

## Apêndice A — Fluxo completo de uma partida (sequência resumida)

```
1. Alice clica "Quick Match Blitz 4p".
2. matchmaking-svc coloca na fila.
3. ~15s depois, 4 jogadores pareados (Alice, Bob, Carla, Diego).
4. tournament-svc / matchmaking cria matchId, aloca em game-server shard-3.
5. game-server inicializa estado: 4 players × 5 dados, seats aleatorizados.
6. Gera server_seed_R1, publica hash.
7. Recebe client_seeds.
8. Sorteia dados, envia via unicast a cada player (só o dele) + broadcast "todos rolaram".
9. Clientes animam rolagem (2D ou 3D, mesmo physics_seed).
10. Alice (seat 0) abre com lance "2x4". Envia PlaceBid.
11. Servidor valida, faz broadcast BidPlaced.
12. Loop até alguém chamar Dudo.
13. Diego chama Dudo no lance "5x6" de Carla.
14. Servidor revela dados de todos (broadcast DicePublic).
15. Conta: 3x6 + 1x1 = 4. Claim 5 era falso. Carla perde 1 dado.
16. Servidor revela server_seed_R1; todos podem verificar.
17. Ratings recalculados ao final da partida.
18. LDN gerado e disponível em /match/{id}.ldn.
19. Replay público disponível imediatamente.
20. Análise computada em background (~5s), disponível no perfil.
```

---

## Apêndice B — Estrutura sugerida de repositório (monorepo)

```
liars-dice-arena/
├── apps/
│   ├── game-server/        # Rust
│   ├── matchmaking/        # Go
│   ├── tournament/         # Go
│   ├── user-svc/           # Go
│   ├── rating/             # Rust
│   ├── shop/               # TypeScript
│   ├── replay/             # Python
│   ├── moderation/         # Python
│   ├── web/                # SvelteKit
│   └── bot-api/            # Go
├── packages/
│   ├── ldn/                # Rust + bindings JS
│   ├── game-rules/         # lógica pura, zero I/O (fonte da verdade)
│   ├── protocol/           # .proto files + geração
│   └── rng/                # commit-reveal, PRF utils
├── clients/
│   ├── web-2d/
│   ├── web-3d/
│   └── cli/
├── infra/
│   ├── helm/
│   ├── terraform/
│   └── grafana-dashboards/
└── docs/
    ├── rfc/                # design documents
    ├── ldn-spec.md
    └── fair-play.md
```

---

## Apêndice C — Checklist de pré-lançamento

- [ ] Motor de jogo com test suite coverage > 95%.
- [ ] LDN spec v1.0 publicada.
- [ ] Fair-play explainer page pronta com verificador funcional.
- [ ] Onboarding de 3min validado com >20 usuários novos.
- [ ] 5 bots funcionando, níveis 1–5.
- [ ] Load test: 1000 partidas concorrentes sem degradação.
- [ ] Playwright e2e: cenários de desconexão, reconexão, timeout, Dudo falso/verdadeiro, eliminação, final de partida.
- [ ] Accessibility audit (axe) sem violações críticas.
- [ ] Página de privacidade + ToS revisados por advogado.
- [ ] Sistema de report + fila de moderação operacional.
- [ ] Documentação de API pública publicada.
- [ ] Bug bounty program ativo (HackerOne ou próprio).
- [ ] Canal Discord oficial + 3 mods voluntários.
- [ ] Plano de escalabilidade para 10x crescimento em 2 semanas.
- [ ] Backup e disaster recovery testados (RTO < 4h, RPO < 15min).

---

**Fim do documento v0.1.**
*Este documento é vivo. Cada decisão de arquitetura merece ser registrada em RFC antes de ser implementada. Cada feature merece um spec próprio.*

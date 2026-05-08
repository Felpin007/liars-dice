# Liar's Dice Arena

Beta jogável de uma arena online de **Liar's Dice** inspirado na clareza, velocidade e espírito aberto de plataformas como lichess. O projeto combina modo local contra bots, lobby online, convites por link, pareamento rápido, partidas autoritativas e integração opcional com Supabase para login, perfil, avatar, amigos, notificações, progressão, rating e histórico.

## Estado do projeto

Este repositório ainda está em fase inicial, mas já possui uma base funcional:

- interface web navegável;
- partida local contra bots;
- regras principais de Liar's Dice/Dudo;
- Calza opcional;
- relógio por turno;
- renderização 2D e modo 3D opcional;
- backend local com REST + SSE;
- salas públicas e privadas;
- convites por link;
- fila de pareamento rápido;
- partidas online com servidor autoritativo;
- login com Google via Supabase Auth;
- perfil persistente com avatar;
- amigos por solicitação, inbox de notificações e reports;
- XP, nível e estatísticas persistidas;
- rating ranqueado com Glicko-2 MVP;
- histórico recente de partidas;
- RNG com commit-reveal para verificação de fair-play;
- exportação de partida em LDN;
- QR local real para convites;
- configurações locais com áudio sintético;
- smoke test para sintaxe, fluxo autoritativo, social, moderação, QR, bots e rating.

O alvo atual é uma beta pública inicial na Vercel, para baixa escala, com Supabase como estado compartilhado. Antes de promover produção, rode o schema completo, configure as variáveis de ambiente e valide `/api/health`.

## Como rodar

Requisitos:

- Node.js 18 ou superior.

Instale as dependências fixadas:

```bash
npm install
```

Depois inicie o servidor:

```bash
npm start
```

Depois acesse:

```text
http://localhost:8080
```

Para rodar o mesmo comando em modo de desenvolvimento:

```bash
npm run dev
```

## Testes

```bash
npm test
```

O smoke test atual valida:

- sintaxe dos arquivos JavaScript em `server/` e `js/`;
- criação de uma partida autoritativa;
- visão privada por jogador;
- lance básico;
- resolução de Dudo;
- revelação do seed ao final do round;
- pedidos de amizade, aceite, recusa e cooldown;
- notificações e marcação de leitura;
- XP, nível e Glicko-2 em partida ranqueada elegível;
- fila ranqueada exigindo login e janela de rating;
- bloqueio de links/termos moderados em perfil/report;
- QR real gerado pelo backend;
- settings locais e áudio sintético respeitando mute/volume;
- diferença de decisão entre bots avançados.

## Estrutura

```text
.
├── assets/              # imagens e recursos visuais
├── css/                 # estilos da interface
├── js/                  # cliente web, UI, bots, regras locais e fluxo online
├── scripts/             # scripts auxiliares e smoke tests
├── server/              # backend HTTP, lobby, sessão, SSE e jogo autoritativo
├── index.html           # aplicação web
├── package.json         # scripts do projeto
└── plan.md              # plano técnico e de produto
```

## Backend

O backend fica em `server/` e usa Node.js com poucas dependências focadas em QR e moderação. Ele oferece:

- servidor HTTP;
- rotas REST sob `/api`;
- eventos em tempo real via Server-Sent Events;
- sessão assinada em cookie;
- proteção CSRF para métodos inseguros;
- validação de origem;
- rate limit simples em memória;
- salas, convites e fila;
- partidas autoritativas;
- persistência opcional em Supabase;
- amigos, notificações, reports, XP e rating ranqueado;
- limpeza periódica de clientes, salas, sessões e partidas expiradas.

Por padrão, o servidor escuta em:

```text
0.0.0.0:8080
```

É possível alterar a porta com:

```bash
PORT=3000 npm start
```

No Windows PowerShell:

```powershell
$env:PORT=3000; npm start
```

## Supabase

A integração com Supabase é opcional. Sem as variáveis de ambiente, o jogo continua funcionando como convidado local.

Com Supabase configurado, o projeto habilita:

- login com Google;
- perfil público;
- nome de usuário;
- bio;
- imagem de perfil;
- XP e nível;
- rating inicial de 1500, RD 350 e volatilidade 0.06;
- amigos e notificações persistentes;
- vitórias, derrotas, partidas e sequência;
- histórico recente;
- exclusão definitiva de conta com limpeza de dados pessoais;
- persistência de partidas finalizadas;
- registro de ações da partida para replay/auditoria futura.

### Passos manuais

1. Crie um projeto em https://supabase.com.

2. No Supabase, abra **SQL Editor** e rode todo o arquivo:

```text
supabase/schema.sql
```

Esse script cria as tabelas de perfil, partidas, runtime, reports, amigos e notificações, ativa RLS onde aplicável e cria o bucket público `avatars`.

3. Ative login com Google:

- Supabase Dashboard;
- Authentication;
- Providers;
- Google;
- habilite o provider;
- preencha Client ID e Client Secret do Google Cloud.

4. Configure as URLs de redirect no Supabase:

Em **Authentication > URL Configuration**, adicione:

```text
http://localhost:8080
```

Quando publicar na Vercel, adicione também a URL real do deploy, por exemplo:

```text
https://seu-projeto.vercel.app
```

5. Copie as chaves do Supabase:

- Project URL;
- anon public key;
- service_role key.

6. Crie um arquivo `.env` na raiz do projeto usando `.env.example` como base:

```env
PORT=8080
SESSION_SECRET=troque-por-um-segredo-longo
PUBLIC_BASE_URL=http://localhost:8080
CRON_SECRET=troque-por-outro-segredo-longo
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-anon-key
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
SUPABASE_AVATAR_BUCKET=avatars
```

7. Reinicie o servidor:

```bash
npm start
```

8. Abra o site e clique no chip de perfil no topo. O modal deve mostrar o botão **Entrar com Google**.

9. Valide o diagnóstico local:

```text
http://localhost:8080/api/health
```

O bloco `persistence` deve indicar `configured: true`, `profilesTable: true`, `matchesTables: true`, `socialTables: true` e `avatarBucket: true`.
Para um deploy publico na Vercel, o bloco `runtime.tables` tambem deve indicar as tabelas de runtime e `productionReady` deve ser `true`.

### Checklist para Vercel manual

- Configure as variáveis de ambiente do `.env.example` no projeto da Vercel.
- Rode novamente `supabase/schema.sql`; ele cria tambem `sessions`, `presence`, `rooms`, `queue_entries`, `active_matches` e `reports`.
- Configure `PUBLIC_BASE_URL` com a URL publica e `CRON_SECRET` com um segredo longo.
- Adicione a URL de produção em **Supabase > Authentication > URL Configuration**.
- Adicione a URL de callback do Supabase no cliente OAuth do Google.
- Rode `/api/health` no deploy e confira `productionReady: true`.
- Faça login, salve perfil com avatar, jogue uma partida e confira o histórico.

### Segurança das chaves

`SUPABASE_ANON_KEY` pode ir para o browser. `SUPABASE_SERVICE_ROLE_KEY` nunca pode ir para o cliente.

O servidor usa a service role apenas no backend para:

- criar/atualizar perfis;
- salvar partidas finalizadas;
- atualizar XP, rating e estatísticas;
- criar pedidos de amizade, amizades, notificações e reports;
- excluir conta pelo endpoint autenticado do backend.

O arquivo `.env` é ignorado pelo Git e o servidor estático bloqueia acesso a dotfiles e arquivos sensíveis.

## Jogo autoritativo

O modo online não confia no cliente para resolver a partida. O servidor:

- cria o round;
- gera as mãos privadas;
- valida lances;
- resolve Dudo, Calza e timeout;
- controla relógio;
- envia snapshots personalizados para cada jogador.

Antes da revelação, cada cliente recebe apenas a própria mão. As mãos dos outros jogadores aparecem como dados ocultos.

## Fair-play

O projeto usa um fluxo de commit-reveal:

1. o servidor gera um seed secreto;
2. publica o hash do seed no início do round;
3. deriva os dados a partir do seed final;
4. revela o seed quando o round termina;
5. o cliente pode verificar se o hash revelado bate com o compromisso inicial.

Esse modelo torna o resultado auditável sem revelar dados privados antes da hora.

## Cliente

O cliente fica em `js/` e é carregado diretamente por `index.html`. As principais áreas são:

- `game.js`: regras locais puras;
- `bot.js`: tomada de decisão dos bots;
- `rng.js`: commit-reveal e derivação determinística;
- `ui.js`: renderização 2D/3D e atualização visual;
- `app.*.js`: bootstrap, diálogos, bindings, fluxo local e integração online;
- `ldn.js`: exportação em Liar's Dice Notation.

## Scripts

```bash
npm start
```

Inicia o servidor local.

```bash
npm run dev
```

Alias para iniciar o servidor local durante desenvolvimento.

```bash
npm test
```

Executa o smoke test.

## Runtime Vercel

Em Vercel, o backend roda como Function Node e usa Supabase como estado compartilhado de runtime. O cliente sincroniza lobby e partidas por polling:

- `/api/snapshot` atualiza lobby, fila, sala e partida ativa;
- `/api/match/:id` atualiza a partida autoritativa;
- `/api/cron/cleanup` limpa dados expirados e exige `CRON_SECRET`;
- SSE continua disponível no servidor local, mas não é o caminho principal em produção Vercel.

Bots, timeout e passagem de round sao resolvidos de forma lazy quando uma action, polling ou cron toca a partida.

## Limitações conhecidas

- o runtime publico inicial mira baixa escala e usa Supabase como estado compartilhado;
- polling substitui realtime permanente em produção Vercel;
- Glicko-2 é MVP, ainda sem temporadas, pools separados ou anti-abuso sofisticado;
- login/perfil dependem de Supabase configurado;
- reconexão depende dos snapshots de runtime ainda dentro do TTL;
- sem testes end-to-end;
- moderação inicial bloqueia links/termos básicos e tem reports, mas sem painel operacional completo;
- sem internacionalização formal.

## Convenções atuais

- Código, nomes de funções, chaves de API e enums técnicos ficam preferencialmente em inglês.
- Texto exibido para o usuário fica em português.
- O backend deve continuar autoritativo para partidas online.
- Dependências devem ser adicionadas com cuidado e só quando removerem complexidade real.
- O cliente nunca grava resultado/rating diretamente no Supabase; o backend autoritativo persiste o resultado.

## Roadmap curto

- ampliar testes de regras e servidor;
- padronizar enums internos em inglês;
- centralizar mensagens da UI;
- melhorar reconexão de partida;
- separar pools/temporadas de rating;
- adicionar painel de moderação;
- avaliar Redis/Upstash ou game server dedicado conforme escala;
- automatizar checklist de preview Vercel.

## Licença

O plano do projeto prevê uma licença aberta compatível com AGPLv3. Adicione o arquivo `LICENSE` antes de publicar uma versão pública formal.

# Liar's Dice Arena

Protótipo jogável de uma arena online de **Liar's Dice** inspirado na clareza, velocidade e espírito aberto de plataformas como lichess. O projeto combina modo local contra bots, lobby online, convites por link, pareamento rápido e partidas autoritativas servidas por um backend Node.js sem dependências externas.

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
- RNG com commit-reveal para verificação de fair-play;
- exportação de partida em LDN;
- smoke test para sintaxe e fluxo autoritativo básico.

Ainda não é uma aplicação pronta para produção. Faltam persistência em banco, autenticação real, rating, reconexão robusta, moderação, testes amplos e infraestrutura de deploy.

## Como rodar

Requisitos:

- Node.js 18 ou superior.

Instale nada: o projeto atual é zero-deps.

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

O teste atual valida:

- sintaxe dos arquivos JavaScript em `server/` e `js/`;
- criação de uma partida autoritativa;
- visão privada por jogador;
- lance básico;
- resolução de Dudo;
- revelação do seed ao final do round.

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

O backend fica em `server/` e usa apenas módulos nativos do Node.js. Ele oferece:

- servidor HTTP;
- rotas REST sob `/api`;
- eventos em tempo real via Server-Sent Events;
- sessão assinada em cookie;
- proteção CSRF para métodos inseguros;
- validação de origem;
- rate limit simples em memória;
- salas, convites e fila;
- partidas autoritativas;
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

## Limitações conhecidas

- estado mantido apenas em memória;
- sem banco de dados;
- sem login persistente;
- sem rating real;
- sem histórico público de partidas;
- sem reconexão robusta;
- sem testes end-to-end;
- sem deploy configurado;
- sem fluxo completo de moderação;
- sem internacionalização formal.

## Convenções atuais

- Código, nomes de funções, chaves de API e enums técnicos ficam preferencialmente em inglês.
- Texto exibido para o usuário fica em português.
- O backend deve continuar autoritativo para partidas online.
- Dependências devem ser adicionadas com cuidado e só quando removerem complexidade real.

## Roadmap curto

- ampliar testes de regras e servidor;
- padronizar enums internos em inglês;
- centralizar mensagens da UI;
- melhorar reconexão de partida;
- criar persistência mínima;
- preparar deploy experimental.

## Licença

O plano do projeto prevê uma licença aberta compatível com AGPLv3. Adicione o arquivo `LICENSE` antes de publicar uma versão pública formal.

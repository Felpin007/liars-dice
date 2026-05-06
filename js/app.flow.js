// App flow — criação de partida, rounds e resolução das ações
(() => {
  const app = window.LDAApp;
  const { BOT_NAMES, PLAYER_COLORS, TURN_TIME_MS } = app.constants;

  function normalizeClockConfig(options = {}) {
    const rawTurnTimeMs = Number(options.turnTimeMs);
    const rawMinutes = Number(options.minutes);
    const turnTimeMs = Number.isFinite(rawTurnTimeMs) && rawTurnTimeMs > 0
      ? rawTurnTimeMs
      : Number.isFinite(rawMinutes) && rawMinutes > 0
        ? rawMinutes * 60_000
        : TURN_TIME_MS;

    const rawIncrementMs = Number(options.incrementMs);
    const rawIncrementSeconds = Number(options.incrementSeconds ?? options.increment);
    const incrementMs = Number.isFinite(rawIncrementMs) && rawIncrementMs >= 0
      ? rawIncrementMs
      : Number.isFinite(rawIncrementSeconds) && rawIncrementSeconds >= 0
        ? rawIncrementSeconds * 1000
        : 0;

    return {
      turnTimeMs,
      incrementMs,
      minutes: Math.max(1, Math.round(turnTimeMs / 60_000)),
      incrementSeconds: Math.max(0, Math.round(incrementMs / 1000)),
    };
  }

  async function startGame(options = {}) {
    if (app.state.startingMatch) return;

    const activeSession = ++app.state.sessionId;
    app.state.busy = false;
    app.state.timeoutLock = false;
    app.state.startingMatch = true;
    app.showGame();
    UI.setMode3d(app.$("#cfg-3d").checked);

    try {
      await newMatch(activeSession, options);
    } catch (err) {
      console.error(err);
      if (!app.isSessionActive(activeSession)) return;
      app.showMenu();
      app.openDialog("Nao foi possivel iniciar a partida", app.startupErrorHtml(err));
    } finally {
      if (app.isSessionActive(activeSession)) app.state.startingMatch = false;
    }
  }

  async function newMatch(activeSession, options = {}) {
    if (!app.isSessionActive(activeSession)) return;

    const numBots = options.numBots ?? Math.max(1, Math.min(5, Number(app.$("#cfg-bots").value)));
    const level = options.level ?? Number(app.$("#cfg-level").value);
    const startingDice = options.startingDice ?? Number(app.$("#cfg-dice").value);
    const calzaEnabled = options.calzaEnabled ?? app.$("#cfg-calza").checked;
    const wildAces = options.wildAces ?? app.$("#cfg-wild").checked;
    const clockConfig = normalizeClockConfig(options);

    let names = Array.isArray(options.playerNames) && options.playerNames.length
      ? options.playerNames.slice()
      : null;

    if (!names) {
      names = ["Você"];
      const shuffled = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < numBots; i++) names.push(shuffled[i]);
    }

    const match = app.setMatch(Game.newMatch({
      playerNames: names,
      startingDice,
      wildAces,
      calzaEnabled,
      matchId: options.matchId || `M-${Date.now().toString(36)}`,
    }));

    if (Number.isInteger(options.startSeat) && match.players[options.startSeat]) {
      match.startSeat = options.startSeat;
      match.turnSeat = options.startSeat;
    }

    match.turnTimeMs = clockConfig.turnTimeMs;
    match.incrementMs = clockConfig.incrementMs;
    match.clock = { currentSeat: null, startedAt: 0, startedRemainingMs: clockConfig.turnTimeMs };
    match.players.forEach((player, index) => {
      player.isBot = options.botSeats ? options.botSeats.includes(index) : index !== 0;
      player.botLevel = index === 0 ? 0 : level;
      player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];
      player.timeLeftMs = clockConfig.turnTimeMs;
      player.uiTimeLeftMs = clockConfig.turnTimeMs;
      player.lastActionTimeMs = clockConfig.turnTimeMs;
      player.lastAction = null;
    });
    match._revealAll = false;
    match.rounds = [];
    match.lastAction = null;
    match.timeoutResolvingSeat = null;

    app.state.lastStartOptions = {
      ...options,
      numBots,
      level,
      startingDice,
      calzaEnabled,
      wildAces,
      minutes: clockConfig.minutes,
      incrementSeconds: clockConfig.incrementSeconds,
    };

    app.$("#log").innerHTML = "";
    UI.appendLog("ev-round", `<b>Partida iniciada</b> · ${names.length} jogadores · ${startingDice} dados · ${wildAces ? "coringas ON" : "coringas OFF"}${calzaEnabled ? " · Calza" : ""} · relógio ${clockConfig.minutes}+${clockConfig.incrementSeconds}`);

    await startRound(activeSession);
  }

  async function startRound(activeSession) {
    const match = app.getMatch();
    if (!match || !app.isSessionActive(activeSession)) return;

    app.clearTurnClock();
    const commitment = await RNG.createCommitment();
    if (!app.getMatch() || !app.isSessionActive(activeSession)) return;

    const clientSeeds = match.players.map(() => RNG.toHex(RNG.randomBytes(4)));
    const finalSeed = await RNG.deriveFinalSeed({
      serverSeedHex: commitment.seedHex,
      clientSeedsHex: clientSeeds,
      matchId: match.matchId,
      round: match.round + 1,
    });
    if (!app.getMatch() || !app.isSessionActive(activeSession)) return;

    const physicsSeed = await RNG.derivePhysicsSeed(finalSeed);
    if (!app.getMatch() || !app.isSessionActive(activeSession)) return;

    match.commitment = {
      hashHex: commitment.hashHex,
      seedHex: commitment.seedHex,
      clientSeeds,
      physicsSeed,
      finalSeedHex: RNG.toHex(finalSeed),
    };

    const hands = {};
    for (const player of match.players) {
      if (!player.alive) {
        hands[player.id] = [];
        continue;
      }
      hands[player.id] = await RNG.rollHand(finalSeed, player.id, player.dice.length);
      if (!app.getMatch() || !app.isSessionActive(activeSession)) return;
    }

    Game.startRound(match, hands);
    match._revealAll = false;
    match.rounds.push({
      number: match.round,
      hands: Game.snapshotHands(match),
      startedAlive: match.players.filter((player) => player.alive).map((player) => player.seat),
      bids: [],
      outcome: null,
      commitmentHash: commitment.hashHex,
    });

    UI.appendLog("ev-round", `<b>Round ${match.round}</b> · compromisso sha256:${commitment.hashHex.slice(0, 12)}…`);
    UI.removeRevealOverlays?.();
    UI.setCurrentQ(1);
    UI.setSelectedFace(2);
    app.refreshLiveClock();
    UI.renderAll();
    UI.updateLive(match);
    UI.shakeDice();

    await tickTurn(activeSession);
  }

  async function tickTurn(activeSession) {
    const match = app.getMatch();
    if (!match || !app.isSessionActive(activeSession) || match.phase !== "bidding") return;

    const player = match.players[match.turnSeat];
    const turnRound = match.round;
    const turnSeat = player.seat;
    if (!player.alive) {
      match.turnSeat = Game.nextAliveSeat(match, match.turnSeat);
      return tickTurn(activeSession);
    }

    app.startTurnClock(player.seat);
    UI.renderAll();
    UI.updateLive(match);
    if (app.getPlayerTimeLeft(player.seat) <= 0) {
      return app.handleTurnTimeout(player.seat, activeSession);
    }
    if (!player.isBot) return;

    app.state.busy = true;
    await app.sleep(600 + Math.random() * 500);
    if (!app.getMatch() || !app.isSessionActive(activeSession) || match.phase !== "bidding" || match.turnSeat !== turnSeat || match.round !== turnRound) {
      app.state.busy = false;
      return;
    }

    const action = Bot.chooseAction(match, player.seat, player.botLevel);
    app.state.busy = false;
    await performAction(player.seat, action, activeSession);
  }

  async function performAction(seat, action, activeSession) {
    const match = app.getMatch();
    if (!match || !app.isSessionActive(activeSession)) return;
    if (match.phase !== "bidding" || match.turnSeat !== seat) return;
    if (app.getPlayerTimeLeft(seat) <= 0) {
      return app.handleTurnTimeout(seat, activeSession);
    }

    const round = match.rounds[match.rounds.length - 1];
    if (action.type === "bid") {
      const result = Game.placeBid(match, seat, action.bid);
      if (!result.ok) {
        if (seat === 0) UI.showRevealBanner(app.errorMsg(result.error), "bad");
        return;
      }

      const timeLeftMs = app.commitActionTime(seat);
      const bidEntry = match.bidHistory[match.bidHistory.length - 1];
      if (bidEntry) bidEntry.timeLeftMs = timeLeftMs;
      if (match.currentBid) match.currentBid.timeLeftMs = timeLeftMs;

      round.bids.push({ type: "bid", seat, q: action.bid.q, v: action.bid.v, timeLeftMs });
      app.setLastAction({ type: "bid", seat, bid: { q: action.bid.q, v: action.bid.v }, timeLeftMs });
      UI.appendLog("ev-bid", app.bidLogHtml(seat, action.bid, timeLeftMs));
      UI.renderAll();
      UI.updateLive(match);
      await app.sleep(250);
      if (!app.getMatch() || !app.isSessionActive(activeSession)) return;
      await tickTurn(activeSession);
      return true;
    }

    if (action.type === "dudo") {
      const result = Game.resolveDudo(match, seat);
      if (!result.ok) {
        if (seat === 0) UI.showRevealBanner(app.errorMsg(result.error), "bad");
        return;
      }

      const timeLeftMs = app.commitActionTime(seat);
      round.bids.push({ type: "dudo", seat, timeLeftMs });
      app.setLastAction({ type: "dudo", seat, bid: { ...result.event.bid }, timeLeftMs });
      round.outcome = result.event;
      await handleResolution(result.event, "dudo", activeSession, timeLeftMs);
      return true;
    }

    if (action.type === "calza") {
      const result = Game.resolveCalza(match, seat);
      if (!result.ok) {
        if (seat === 0) UI.showRevealBanner(app.errorMsg(result.error), "bad");
        return;
      }

      const timeLeftMs = app.commitActionTime(seat);
      round.bids.push({ type: "calza", seat, timeLeftMs });
      app.setLastAction({ type: "calza", seat, bid: { ...result.event.bid }, timeLeftMs });
      round.outcome = result.event;
      await handleResolution(result.event, "calza", activeSession, timeLeftMs);
      return true;
    }

    return false;
  }

  async function handleTurnTimeout(seat, activeSession) {
    const match = app.getMatch();
    if (!match || !app.isSessionActive(activeSession)) return;
    if (match.phase !== "bidding" || match.turnSeat !== seat) return;
    if (match.timeoutResolvingSeat === seat) return;

    const player = match.players[seat];
    if (!player || !player.alive) return;

    match.timeoutResolvingSeat = seat;
    app.state.busy = false;

    try {
      app.clearTurnClock();
      player.timeLeftMs = 0;
      player.uiTimeLeftMs = 0;
      player.lastActionTimeMs = 0;

      const result = Game.resolveTimeout(match, seat);
      if (!result.ok) return;

      const round = match.rounds[match.rounds.length - 1];
      if (round) {
        round.bids.push({ type: "timeout", seat, timeLeftMs: 0 });
        round.outcome = result.event;
      }

      app.setLastAction({ type: "timeout", seat, bid: result.event.bid ? { ...result.event.bid } : null, timeLeftMs: 0 });
      await handleResolution(result.event, "timeout", activeSession, 0);
    } finally {
      if (app.getMatch() === match) match.timeoutResolvingSeat = null;
    }
  }

  async function handleResolution(event, kind, activeSession, actionTimeLeft) {
    const match = app.getMatch();
    if (!match || !app.isSessionActive(activeSession)) return;

    match._revealAll = true;
    const bidHtmlText = app.bidHtml(event.bid);
    if (kind === "dudo") {
      UI.appendLog("ev-dudo", `<b>${app.esc(match.players[event.challengerSeat].name)}</b> ${app.actionTimeHtml(actionTimeLeft)} chamou DUDO contra ${bidHtmlText}`);
      const verdict = event.claimTrue
        ? `Lance verdadeiro (real = ${event.real}). ${app.esc(match.players[event.challengerSeat].name)} perde 1 dado.`
        : `Lance falso (real = ${event.real}). ${app.esc(match.players[event.bid.seat].name)} perde 1 dado.`;
      UI.appendLog("ev-dudo", `→ ${verdict}`);
    } else if (kind === "calza") {
      UI.appendLog("ev-calza", `<b>${app.esc(match.players[event.callerSeat].name)}</b> ${app.actionTimeHtml(actionTimeLeft)} chamou CALZA em ${bidHtmlText}`);
      const verdict = event.exact
        ? `Calza correto! Real = ${event.real}. ${app.esc(match.players[event.callerSeat].name)} ganha 1 dado.`
        : `Calza errado. Real = ${event.real}. ${app.esc(match.players[event.callerSeat].name)} perde 1 dado.`;
      UI.appendLog("ev-calza", `→ ${verdict}`);
    } else if (kind === "timeout") {
      const playerName = app.esc(match.players[event.timedOutSeat].name);
      UI.appendLog("ev-dudo", `<b>${playerName}</b> ${app.actionTimeHtml(actionTimeLeft)} ficou sem tempo.`);
      const detail = event.bid
        ? `→ ${playerName} perde 1 dado. Lance atual: ${bidHtmlText}.`
        : `→ ${playerName} perde 1 dado antes de qualquer lance.`;
      UI.appendLog("ev-dudo", detail);
    }

    if (event.eliminatedSeat != null) {
      UI.appendLog("ev-round", `☠ ${app.esc(match.players[event.eliminatedSeat].name)} foi eliminado.`);
    }

    UI.renderAll();
    UI.updateLive(match);
    await UI.playRevealSequence?.(match, event, kind);
    await app.sleep(650);
    if (!app.getMatch() || !app.isSessionActive(activeSession)) return;

    UI.appendLog("ev-round", `seed revelado: ${match.commitment.seedHex.slice(0, 24)}…  (verificável)`);

    if (match.phase === "ended") {
      app.clearTurnClock();
      app.refreshLiveClock();
      const winner = match.winnerSeat != null ? match.players[match.winnerSeat].name : "—";
      UI.appendLog("ev-end", `🏆 Fim: vencedor = ${app.esc(winner)}`);
      UI.renderAll();
      UI.updateLive(match);
      UI.showMatchResult?.(match, { localSeat: 0 });
      return;
    }

    await startRound(activeSession);
  }

  Object.assign(app, {
    startGame,
    newMatch,
    startRound,
    tickTurn,
    performAction,
    handleTurnTimeout,
    handleResolution,
  });
})();

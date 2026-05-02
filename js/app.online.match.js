// App online match sync — acoes, snapshots e mapeamento de assentos
(() => {
  const app = window.LDAApp;

  async function sendOnlineAction(action) {
    const matchId = app.state.online.activeMatchId;
    const serverSeat = app.state.online.localToServerSeat?.[0];
    if (!matchId || !Number.isInteger(serverSeat)) return;
    const payload = await app.api(`/api/match/${encodeURIComponent(matchId)}/action`, {
      method: "POST",
      body: {
        seat: serverSeat,
        action,
      },
    });
    if (payload.snapshot) applyServerMatchSnapshot(payload.snapshot);
  }

  function setupSeatMappingFromSnapshot(snapshot) {
    const playerSeats = snapshot.players.map((player) => player.seat);
    const selfSeat = Number.isInteger(snapshot.selfSeat) ? snapshot.selfSeat : playerSeats[0];
    const localToServerSeat = [selfSeat, ...playerSeats.filter((seat) => seat !== selfSeat)];
    const serverToLocalSeat = [];
    localToServerSeat.forEach((serverSeat, localSeat) => {
      serverToLocalSeat[serverSeat] = localSeat;
    });
    app.state.online.localToServerSeat = localToServerSeat;
    app.state.online.serverToLocalSeat = serverToLocalSeat;
  }

  function toLocalSeat(serverSeat) {
    if (serverSeat == null) return serverSeat;
    const local = app.state.online.serverToLocalSeat?.[serverSeat];
    return Number.isInteger(local) ? local : serverSeat;
  }

  function remapBid(bid) {
    if (!bid) return null;
    return { ...bid, seat: toLocalSeat(bid.seat) };
  }

  function remapAction(action) {
    if (!action) return null;
    return {
      ...action,
      seat: toLocalSeat(action.seat),
      bid: remapBid(action.bid),
    };
  }

  function remapOutcome(outcome) {
    if (!outcome) return null;
    return {
      ...outcome,
      challengerSeat: toLocalSeat(outcome.challengerSeat),
      callerSeat: toLocalSeat(outcome.callerSeat),
      timedOutSeat: toLocalSeat(outcome.timedOutSeat),
      loserSeat: toLocalSeat(outcome.loserSeat),
      eliminatedSeat: toLocalSeat(outcome.eliminatedSeat),
      bid: remapBid(outcome.bid),
      hands: Array.isArray(outcome.hands)
        ? outcome.hands.map((hand) => ({ ...hand, seat: toLocalSeat(hand.seat) }))
        : outcome.hands,
    };
  }

  function renderServerLog(log) {
    const list = app.$("#log");
    if (!list || !Array.isArray(log)) return;
    list.innerHTML = log.map((entry) => {
      const cls = {
        bid: "ev-bid",
        dudo: "ev-dudo",
        calza: "ev-calza",
        timeout: "ev-dudo",
        end: "ev-end",
      }[entry.type] || "ev-round";
      if (entry.type === "bid" && entry.bid && Number.isInteger(entry.seat)) {
        const localSeat = toLocalSeat(entry.seat);
        const localBid = remapBid(entry.bid);
        return `<li class="${cls}">${app.bidLogHtml(localSeat, localBid, entry.timeLeftMs || 0)}</li>`;
      }
      if (entry.type === "bid") {
        const parsed = String(entry.text || "").match(/^(.*?)\s+fez lance\s+(\d+)\s*x\s*([1-6])\.?$/i);
        if (parsed) {
          const [, rawName, q, v] = parsed;
          const bid = { q: Number(q), v: Number(v) };
          return `<li class="${cls}">
            <div class="log-turn-head">
              <span class="log-turn-label">Turno de ${app.esc(rawName)}</span>
              ${app.actionTimeHtml(entry.timeLeftMs || 0)}
            </div>
            <div class="log-turn-detail">→ ${app.esc(rawName)} fez um lance: ${app.bidHtml(bid)}</div>
          </li>`;
        }
      }
      return `<li class="${cls}">${app.esc(entry.text)}</li>`;
    }).join("");
    list.scrollTop = list.scrollHeight;
  }

  function applyServerMatchSnapshot(snapshot) {
    if (!snapshot || snapshot.matchId !== app.state.online.activeMatchId) return;
    if (snapshot.seq < app.state.online.lastSnapshotSeq) return;
    app.state.online.lastSnapshotSeq = snapshot.seq;
    if (!app.state.online.localToServerSeat || !app.state.online.serverToLocalSeat) {
      setupSeatMappingFromSnapshot(snapshot);
    }

    const localToServerSeat = app.state.online.localToServerSeat;
    const playersBySeat = new Map(snapshot.players.map((player) => [player.seat, player]));
    const colors = app.constants.PLAYER_COLORS;
    const players = localToServerSeat.map((serverSeat, localSeat) => {
      const source = playersBySeat.get(serverSeat) || {
        seat: serverSeat,
        name: `Jogador ${serverSeat + 1}`,
        dice: [],
        diceCount: 0,
        alive: false,
        isBot: false,
        botLevel: 0,
        timeLeftMs: 0,
        lastActionTimeMs: 0,
      };
      return {
        id: localSeat,
        seat: localSeat,
        serverSeat,
        name: localSeat === 0 ? "Você" : source.name,
        dice: Array.isArray(source.dice) ? source.dice.slice() : new Array(source.diceCount || 0).fill(0),
        diceCount: source.diceCount,
        alive: source.alive,
        isBot: source.isBot,
        botLevel: source.botLevel,
        color: colors[localSeat % colors.length],
        timeLeftMs: source.timeLeftMs,
        uiTimeLeftMs: source.timeLeftMs,
        lastActionTimeMs: source.lastActionTimeMs,
      };
    });

    const localTurnSeat = toLocalSeat(snapshot.turnSeat);
    const clock = snapshot.phase === "bidding" && Number.isInteger(localTurnSeat)
      ? {
          currentSeat: localTurnSeat,
          startedAt: app.getNow(),
          startedRemainingMs: Math.max(0, snapshot.clock?.timeRemainingMs || 0),
        }
      : { currentSeat: null, startedAt: 0, startedRemainingMs: 0 };

    const match = app.setMatch({
      matchId: snapshot.matchId,
      authoritative: true,
      config: snapshot.config,
      players,
      round: snapshot.round,
      turnSeat: localTurnSeat,
      startSeat: toLocalSeat(snapshot.startSeat),
      currentBid: remapBid(snapshot.currentBid),
      bidHistory: (snapshot.bidHistory || []).map(remapBid),
      roundLog: [],
      matchLog: [],
      phase: snapshot.phase,
      winnerSeat: toLocalSeat(snapshot.winnerSeat),
      rounds: (snapshot.rounds || []).map((round) => ({
        ...round,
        startedAlive: (round.startedAlive || []).map(toLocalSeat),
        hands: (round.hands || []).map((hand) => ({ ...hand, seat: toLocalSeat(hand.seat) })),
        bids: (round.bids || []).map(remapBid),
        outcome: remapOutcome(round.outcome),
      })),
      commitment: snapshot.commitment,
      turnTimeMs: snapshot.turnTimeMs,
      incrementMs: snapshot.incrementMs,
      clock,
      _revealAll: snapshot.revealAll,
      lastAction: remapAction(snapshot.lastAction),
      timeoutResolvingSeat: null,
    });

    app.refreshLiveClock();
    renderServerLog(snapshot.log);
    UI.renderAll();
    UI.updateLive(match);
    if (snapshot.phase === "ended") {
      const winner = Number.isInteger(match.winnerSeat) && match.players[match.winnerSeat]
        ? match.players[match.winnerSeat].name
        : "-";
      UI.showRevealBanner(`Partida encerrada — vencedor: ${winner}`, "ok");
    }
  }

  function launchAuthoritativeMatch(payload) {
    if (!payload?.authoritative || !payload.snapshot) {
      return launchMatchedPrototype(payload);
    }
    if (app.state.online.authoritative && app.state.online.activeMatchId === payload.matchId) {
      applyServerMatchSnapshot(payload.snapshot);
      return;
    }
    const activeSession = ++app.state.sessionId;
    app.state.busy = false;
    app.state.timeoutLock = false;
    app.state.online.activeMatchId = payload.matchId;
    app.state.online.activeSession = activeSession;
    app.state.online.authoritative = true;
    app.state.online.lastSnapshotSeq = -1;
    app.state.online.localToServerSeat = null;
    app.state.online.serverToLocalSeat = null;

    const dialog = app.$("#dlg");
    if (dialog?.open) dialog.close();
    app.$("#log").innerHTML = "";
    app.showGame();
    UI.setMode3d(app.$("#cfg-3d").checked);
    setupSeatMappingFromSnapshot(payload.snapshot);
    applyServerMatchSnapshot(payload.snapshot);
  }

  async function launchMatchedPrototype(payload) {
    const localName = app.state.online.username;
    const localHuman = (payload.humanPlayers || []).find((player) => player.clientId === app.state.online.clientId);
    const localServerSeat = localHuman ? localHuman.seat : Math.max(0, payload.playerNames.indexOf(localName));
    const serverSeats = payload.playerNames.map((_, seat) => seat);
    const localToServerSeat = [localServerSeat, ...serverSeats.filter((seat) => seat !== localServerSeat)];
    const serverToLocalSeat = [];
    localToServerSeat.forEach((serverSeat, localSeat) => {
      serverToLocalSeat[serverSeat] = localSeat;
    });

    const playerNames = localToServerSeat.map((serverSeat, localSeat) => {
      return localSeat === 0 ? "Você" : payload.playerNames[serverSeat];
    });
    const botSeats = [];
    const serverBotSeats = new Set(payload.botSeats || []);
    localToServerSeat.forEach((serverSeat, localSeat) => {
      if (serverBotSeats.has(serverSeat)) botSeats.push(localSeat);
    });

    app.state.online.activeMatchId = payload.matchId;
    app.state.online.activeSession = app.state.sessionId + 1;
    app.state.online.localToServerSeat = localToServerSeat;
    app.state.online.serverToLocalSeat = serverToLocalSeat;

    await app.startGame({
      matchId: payload.matchId,
      playerNames,
      botSeats,
      startSeat: serverToLocalSeat[payload.startSeat] ?? 0,
      level: Number(app.$("#cfg-level").value),
      startingDice: Number(app.$("#cfg-dice").value),
      wildAces: app.$("#cfg-wild").checked,
      calzaEnabled: app.$("#cfg-calza").checked,
      minutes: Number(payload.minutes || 5),
      incrementSeconds: Number(payload.increment || 0),
    });
  }

  app.onlineMatch = {
    launchAuthoritativeMatch,
    applyServerMatchSnapshot,
  };

  Object.assign(app, {
    sendOnlineAction,
    applyServerMatchSnapshot,
  });
})();

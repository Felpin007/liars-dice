// Motor de regras puro — Liar's Dice Classic (plan §2)
// Zero I/O: recebe estado, retorna estado novo + eventos.

const Game = (() => {

  function newMatch({ playerNames, startingDice = 5, wildAces = true, calzaEnabled = false, matchId }) {
    const players = playerNames.map((name, i) => ({
      id: i,
      seat: i,
      name,
      dice: new Array(startingDice).fill(0), // preenchido no round_start
      alive: true,
      isBot: false, // setado externamente
    }));
    return {
      matchId,
      config: { startingDice, wildAces, calzaEnabled },
      players,
      round: 0,
      turnSeat: 0,
      startSeat: 0, // quem abre o round
      currentBid: null, // { q, v, seat }
      bidHistory: [],   // lista de { seat, q, v } do round
      roundLog: [],     // logs textuais
      matchLog: [],
      phase: "lobby",   // lobby | rolling | bidding | resolving | ended
      winnerSeat: null,
      rounds: [],       // histórico para LDN: { number, hands, bids, outcome }
      commitment: null, // { hashHex, seedHex (após reveal), clientSeeds, physicsSeed, finalSeedHex }
    };
  }

  function totalDiceInPool(state) {
    return state.players.reduce((s, p) => s + (p.alive ? p.dice.length : 0), 0);
  }

  function alivePlayers(state) {
    return state.players.filter(p => p.alive);
  }

  function nextAliveSeat(state, fromSeat) {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const s = (fromSeat + step) % n;
      if (state.players[s].alive) return s;
    }
    return fromSeat;
  }

  // §2.3 — validação de aumento:
  // qualquer lance com quantidade maior é válido;
  // com a mesma quantidade, a face precisa subir.
  function isValidRaise(prev, next, wildAces) {
    if (!next || typeof next.q !== "number" || typeof next.v !== "number") return false;
    if (next.q < 1 || next.v < 1 || next.v > 6) return false;
    if (!prev) return true;
    if (next.q > prev.q) return true;
    if (next.q === prev.q && next.v > prev.v) return true;
    return false;
  }

  // menor lance estritamente maior que `prev` para um valor `v` dado
  function minRaiseForValue(prev, v, wildAces) {
    if (!prev) return { q: 1, v };
    if (v > prev.v) return { q: prev.q, v };
    return { q: prev.q + 1, v };
  }

  // Contagem real no pool com regra de coringa
  function countInPool(state, v) {
    let count = 0;
    for (const p of state.players) {
      if (!p.alive) continue;
      for (const d of p.dice) {
        if (d === v) count++;
        else if (state.config.wildAces && v !== 1 && d === 1) count++;
      }
    }
    return count;
  }

  function startRound(state, hands) {
    state.round += 1;
    state.phase = "bidding";
    state.currentBid = null;
    state.bidHistory = [];
    state.roundLog = [];
    for (const p of state.players) {
      if (!p.alive) continue;
      const h = hands[p.id];
      p.dice = h.slice();
    }
    state.turnSeat = state.startSeat;
    // garante que turnSeat está em jogador vivo
    if (!state.players[state.turnSeat].alive) {
      state.turnSeat = nextAliveSeat(state, state.turnSeat);
      state.startSeat = state.turnSeat;
    }
    return { type: "round_start", round: state.round, startSeat: state.startSeat };
  }

  function placeBid(state, seat, bid) {
    if (state.phase !== "bidding") return { ok: false, error: "phase" };
    if (state.turnSeat !== seat) return { ok: false, error: "not-your-turn" };
    if (!isValidRaise(state.currentBid, bid, state.config.wildAces)) {
      return { ok: false, error: "invalid-raise" };
    }
    const maxQ = totalDiceInPool(state);
    if (bid.q > maxQ) return { ok: false, error: "above-pool" };
    state.currentBid = { q: bid.q, v: bid.v, seat };
    state.bidHistory.push({ seat, q: bid.q, v: bid.v });
    state.turnSeat = nextAliveSeat(state, seat);
    return { ok: true, event: { type: "bid", seat, q: bid.q, v: bid.v } };
  }

  function resolveDudo(state, challengerSeat) {
    if (state.phase !== "bidding") return { ok: false, error: "phase" };
    if (!state.currentBid) return { ok: false, error: "no-bid" };
    const bid = state.currentBid;
    const real = countInPool(state, bid.v);
    const claimTrue = real >= bid.q;
    const loserSeat = claimTrue ? challengerSeat : bid.seat;
    const loser = state.players[loserSeat];
    loser.dice.pop();
    if (loser.dice.length === 0) loser.alive = false;
    const outcome = {
      type: "dudo_resolved",
      challengerSeat,
      bid: { ...bid },
      real,
      claimTrue,
      loserSeat,
      eliminatedSeat: loser.alive ? null : loserSeat,
      hands: snapshotHands(state),
    };
    finalizeRound(state, loserSeat);
    return { ok: true, event: outcome };
  }

  function resolveCalza(state, callerSeat) {
    if (!state.config.calzaEnabled) return { ok: false, error: "calza-disabled" };
    if (state.phase !== "bidding") return { ok: false, error: "phase" };
    if (!state.currentBid) return { ok: false, error: "no-bid" };
    const bid = state.currentBid;
    const real = countInPool(state, bid.v);
    const exact = real === bid.q;
    const caller = state.players[callerSeat];
    let eliminated = null;
    if (exact) {
      // §2.4 — acerto: ganha 1 dado (até limite)
      if (caller.dice.length < state.config.startingDice) caller.dice.push(0);
    } else {
      caller.dice.pop();
      if (caller.dice.length === 0) { caller.alive = false; eliminated = callerSeat; }
    }
    const outcome = {
      type: "calza_resolved",
      callerSeat, bid: { ...bid }, real, exact,
      eliminatedSeat: eliminated,
      hands: snapshotHands(state),
    };
    // quem chamou calza inicia o próximo round (se ainda vivo), senão próximo
    finalizeRound(state, callerSeat);
    return { ok: true, event: outcome };
  }

  function resolveTimeout(state, timedOutSeat) {
    if (state.phase !== "bidding") return { ok: false, error: "phase" };
    if (state.turnSeat !== timedOutSeat) return { ok: false, error: "not-your-turn" };

    const player = state.players[timedOutSeat];
    if (!player || !player.alive) return { ok: false, error: "player-dead" };

    if (player.dice.length > 0) player.dice.pop();
    if (player.dice.length === 0) player.alive = false;

    const outcome = {
      type: "timeout_resolved",
      timedOutSeat,
      loserSeat: timedOutSeat,
      bid: state.currentBid ? { ...state.currentBid } : null,
      eliminatedSeat: player.alive ? null : timedOutSeat,
      hands: snapshotHands(state),
    };
    finalizeRound(state, timedOutSeat);
    return { ok: true, event: outcome };
  }

  function snapshotHands(state) {
    return state.players.map(p => ({ seat: p.seat, name: p.name, dice: p.dice.slice(), alive: p.alive }));
  }

  function finalizeRound(state, loserOrCaller) {
    const alive = alivePlayers(state);
    if (alive.length <= 1) {
      state.phase = "ended";
      state.winnerSeat = alive.length === 1 ? alive[0].seat : null;
    } else {
      state.phase = "resolving";
      // próximo round começa com loserOrCaller (ou próximo vivo se ele saiu)
      const p = state.players[loserOrCaller];
      state.startSeat = p.alive ? loserOrCaller : nextAliveSeat(state, loserOrCaller);
    }
  }

  // Limites do "stepper" de quantidade para o UI
  function qBounds(state, chosenV) {
    const prev = state.currentBid;
    const pool = totalDiceInPool(state);
    const min = minRaiseForValue(prev, chosenV, state.config.wildAces).q;
    return { min: Math.min(min, pool), max: pool };
  }

  return {
    newMatch, startRound, placeBid, resolveDudo, resolveCalza, resolveTimeout,
    isValidRaise, minRaiseForValue, countInPool, totalDiceInPool,
    nextAliveSeat, alivePlayers, snapshotHands, qBounds,
  };
})();

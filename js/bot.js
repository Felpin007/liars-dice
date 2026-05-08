// Bots — plan §15
// Nível 1: aleatório válido
// Nível 3: probabilidade básica, pouco blefe
// Nível 8: probabilidade + pressão + leitura do histórico recente

const Bot = (() => {
  const LEVEL_PROFILES = {
    2: { callBelow: 0.28, target: 0.86, minP: 0.18, maxExtra: 2, firstBidCap: 0.5, pressure: 0.12, support: 0.03, random: 0.08 },
    3: { callBelow: 0.34, target: 0.8, minP: 0.24, maxExtra: 3, firstBidCap: 0.56, pressure: 0.22, support: 0.04, random: 0 },
    4: { callBelow: 0.4, target: 0.74, minP: 0.28, maxExtra: 4, firstBidCap: 0.6, pressure: 0.36, support: 0.05, random: 0 },
    5: { callBelow: 0.44, target: 0.7, minP: 0.31, maxExtra: 4, firstBidCap: 0.64, pressure: 0.52, support: 0.06, bluff: 0.08, calza: 0.34, random: 0 },
    6: { callBelow: 0.47, target: 0.67, minP: 0.34, maxExtra: 5, firstBidCap: 0.68, pressure: 0.72, support: 0.07, bluff: 0.1, calza: 0.31, random: 0 },
    7: { callBelow: 0.49, target: 0.64, minP: 0.36, maxExtra: 5, firstBidCap: 0.72, pressure: 0.92, support: 0.08, bluff: 0.11, calza: 0.29, reads: true, random: 0 },
    8: { callBelow: 0.5, target: 0.61, minP: 0.38, maxExtra: 6, firstBidCap: 0.78, pressure: 1.12, support: 0.09, bluff: 0.08, calza: 0.28, reads: true, deep: true, random: 0 },
  };

  function profileFor(level) {
    return LEVEL_PROFILES[Math.max(2, Math.min(8, Number(level) || 3))] || LEVEL_PROFILES[3];
  }

  // Binomial tail: P(X >= k) onde X ~ Binomial(n, p)
  function binomTail(n, k, p) {
    if (k <= 0) return 1;
    if (k > n) return 0;
    // usa recorrência estável
    const q = 1 - p;
    // calcula P(X = i) iterativamente
    let pi = Math.pow(q, n);
    let cumLess = pi;
    for (let i = 1; i < k; i++) {
      pi = pi * (n - i + 1) / i * (p / q);
      cumLess += pi;
    }
    return Math.max(0, Math.min(1, 1 - cumLess));
  }

  // Probabilidade de "há pelo menos q dados com valor v no pool", dados os dados próprios
  function probBidTrue(ownDice, totalPool, bid, wildAces) {
    const own = ownCount(ownDice, bid, wildAces);
    const unknown = totalPool - ownDice.length;
    const needed = bid.q - own;
    if (needed <= 0) return 1;
    if (unknown <= 0) return 0;
    const p = bid.v === 1 ? (1 / 6) : (wildAces ? (2 / 6) : (1 / 6));
    return binomTail(unknown, needed, p);
  }

  function ownCount(ownDice, bid, wildAces) {
    return ownDice.reduce((count, die) => count + (die === bid.v || (wildAces && bid.v !== 1 && die === 1) ? 1 : 0), 0);
  }

  // Gera todos os lances válidos (bounded para não explodir)
  function enumerateRaises(state, wildAces, profile = profileFor(3)) {
    const prev = state.currentBid;
    const pool = Game.totalDiceInPool(state);
    const list = [];
    for (let v = 1; v <= 6; v++) {
      const min = Game.minRaiseForValue(prev, v, wildAces).q;
      const maxReasonable = Math.min(pool, prev ? prev.q + profile.maxExtra : Math.ceil(pool * profile.firstBidCap));
      for (let q = min; q <= maxReasonable; q++) {
        if (Game.isValidRaise(prev, { q, v }, wildAces)) list.push({ q, v });
      }
    }
    return list;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function adjustedPreviousProbability(state, seat, prev, baseP, profile, wildAces) {
    if (!profile.reads || !prev) return baseP;
    const pool = Game.totalDiceInPool(state);
    const me = state.players[seat];
    const support = ownCount(me.dice, prev, wildAces);
    const history = state.bidHistory || [];
    const bidderBids = history.filter((bid) => bid.seat === prev.seat);
    const earlierByBidder = bidderBids.slice(0, Math.max(0, bidderBids.length - 1));
    let adjusted = baseP;

    if (earlierByBidder.some((bid) => bid.v === prev.v)) adjusted += 0.04;
    if (support >= 2) adjusted += 0.03;
    if (support === 0 && prev.q >= Math.ceil(pool * 0.45)) adjusted -= 0.04;

    const previousBid = history.length > 1 ? history[history.length - 2] : null;
    if (previousBid && support === 0 && prev.q - previousBid.q >= 2) adjusted -= 0.06;
    if (profile.deep && support === 0 && prev.q >= Math.ceil(pool * 0.6)) adjusted -= 0.05;
    return clamp01(adjusted);
  }

  function scoreRaise(state, seat, bid, p, profile, wildAces) {
    const pool = Game.totalDiceInPool(state);
    const prev = state.currentBid;
    const minQ = Game.minRaiseForValue(prev, bid.v, wildAces).q;
    const support = ownCount(state.players[seat].dice, bid, wildAces);
    const target = profile.target;
    const pressure = bid.q / Math.max(1, pool);
    let score = 0;

    score -= Math.abs(p - target) * 1.45;
    score += pressure * profile.pressure;
    score += Math.min(4, support) * profile.support;
    score += (bid.v / 6) * 0.035;
    if (prev && bid.q === minQ) score += profile.deep ? 0.08 : 0.03;
    if (!prev && bid.q <= 1) score -= profile.deep ? 0.55 : 0.25;
    if (p < profile.minP) score -= (profile.minP - p) * (profile.deep ? 4.2 : 2.6);
    if (bid.q > pool * 0.78 && p < target) score -= 0.22;
    if (profile.bluff && p >= profile.minP && p < target) {
      score += profile.bluff * (target - Math.abs(p - target));
    }
    return score;
  }

  function chooseAction(state, seat, level) {
    const me = state.players[seat];
    const own = me.dice;
    const pool = Game.totalDiceInPool(state);
    const prev = state.currentBid;
    const wild = state.config.wildAces;
    const profile = profileFor(level);

    // Nível 1: aleatório
    if (level <= 1) {
      if (prev && Math.random() < 0.25) return { type: "dudo" };
      const raises = enumerateRaises(state, wild, profile);
      if (raises.length === 0) return { type: "dudo" };
      return { type: "bid", bid: raises[Math.floor(Math.random() * raises.length)] };
    }

    if (level === 2 && Math.random() < profile.random) {
      const raises = enumerateRaises(state, wild, profile);
      if (!raises.length) return { type: "dudo" };
      return { type: "bid", bid: raises[Math.floor(Math.random() * raises.length)] };
    }

    // Enumera raises e calcula P(true) de cada
    const raises = enumerateRaises(state, wild, profile);
    let best = null;
    for (const r of raises) {
      const p = probBidTrue(own, pool, r, wild);
      const score = scoreRaise(state, seat, r, p, profile, wild);
      if (!best || score > best.score) best = { bid: r, score, p };
    }

    // Decisão final
    if (prev) {
      const baseP = probBidTrue(own, pool, prev, wild);
      const pTrue = adjustedPreviousProbability(state, seat, prev, baseP, profile, wild);
      const support = ownCount(own, prev, wild);
      let callBelow = profile.callBelow;
      if (profile.reads && support === 0 && prev.q >= Math.ceil(pool * 0.5)) callBelow += 0.04;
      if (profile.deep && support >= 2) callBelow -= 0.03;
      if (pTrue <= callBelow) {
        return { type: "dudo" };
      }
      if (state.config.calzaEnabled && profile.calza) {
        const pExact = probExact(own, pool, prev, wild);
        if (pExact > profile.calza && pTrue > callBelow + 0.08) return { type: "calza" };
      }
    }
    if (!best) return { type: "dudo" };
    return { type: "bid", bid: best.bid };
  }

  function probExact(ownDice, totalPool, bid, wildAces) {
    const own = ownDice.reduce((c, d) => c + (d === bid.v || (wildAces && bid.v !== 1 && d === 1) ? 1 : 0), 0);
    const unknown = totalPool - ownDice.length;
    const needed = bid.q - own;
    if (needed < 0 || needed > unknown) return 0;
    const p = bid.v === 1 ? (1 / 6) : (wildAces ? (2 / 6) : (1 / 6));
    // P(X = needed) em Binomial(unknown, p)
    return binomCoef(unknown, needed) * Math.pow(p, needed) * Math.pow(1 - p, unknown - needed);
  }

  function binomCoef(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return r;
  }

  return { chooseAction, probBidTrue, probExact, binomTail };
})();

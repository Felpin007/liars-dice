// Bots — plan §15
// Nível 1: aleatório válido
// Nível 3: probabilidade exata, pouco blefe
// Nível 5: probabilidade + blefe oportunista + leitura de contexto

const Bot = (() => {

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
    const own = ownDice.reduce((c, d) => c + (d === bid.v || (wildAces && bid.v !== 1 && d === 1) ? 1 : 0), 0);
    const unknown = totalPool - ownDice.length;
    const needed = bid.q - own;
    if (needed <= 0) return 1;
    if (unknown <= 0) return 0;
    const p = bid.v === 1 ? (1 / 6) : (wildAces ? (2 / 6) : (1 / 6));
    return binomTail(unknown, needed, p);
  }

  // Gera todos os lances válidos (bounded para não explodir)
  function enumerateRaises(state, wildAces) {
    const prev = state.currentBid;
    const pool = Game.totalDiceInPool(state);
    const list = [];
    for (let v = 1; v <= 6; v++) {
      const min = Game.minRaiseForValue(prev, v, wildAces).q;
      const maxReasonable = Math.min(pool, prev ? prev.q + 4 : Math.ceil(pool * 0.6));
      for (let q = min; q <= maxReasonable; q++) {
        if (Game.isValidRaise(prev, { q, v }, wildAces)) list.push({ q, v });
      }
    }
    return list;
  }

  function chooseAction(state, seat, level) {
    const me = state.players[seat];
    const own = me.dice;
    const pool = Game.totalDiceInPool(state);
    const prev = state.currentBid;
    const wild = state.config.wildAces;

    // Nível 1: aleatório
    if (level <= 1) {
      if (prev && Math.random() < 0.25) return { type: "dudo" };
      const raises = enumerateRaises(state, wild);
      if (raises.length === 0) return { type: "dudo" };
      return { type: "bid", bid: raises[Math.floor(Math.random() * raises.length)] };
    }

    // Avalia Dudo primeiro
    let dudoScore = -1;
    if (prev) {
      const pTrue = probBidTrue(own, pool, prev, wild);
      // chamar Dudo ganha se pTrue < 0.5 (regra mais simples)
      dudoScore = 1 - pTrue;
    }

    // Enumera raises e calcula P(true) de cada
    const raises = enumerateRaises(state, wild);
    let best = null;
    for (const r of raises) {
      const p = probBidTrue(own, pool, r, wild);
      // score: queremos lance que seja plausivelmente verdadeiro (p alto), mas não trivial
      // penaliza lances "óbvios" que dão informação demais e lances muito arriscados
      const risk = 1 - p; // chance de ser desafiado com sucesso
      let score = p;
      // nível 3: favorece segurança
      // nível 5: adiciona bluff — lances com p baixo mas próximos a 0.35-0.45 podem pegar oponente de surpresa
      if (level >= 5) {
        const bluffBand = (p > 0.28 && p < 0.5) ? 0.15 * (0.4 - Math.abs(p - 0.4)) : 0;
        score += bluffBand;
        // leitura: se o jogador que fez o lance anterior é "ousado" (lance alto), punir com dudo mais cedo
      }
      // penaliza lances na borda do pool (muito arriscados)
      if (r.q > pool * 0.75) score -= 0.15;
      if (!best || score > best.score) best = { bid: r, score, p };
    }

    // Decisão final
    if (prev) {
      // calcula melhor lance vs dudo
      const bestRaiseScore = best ? best.score : -1;
      // threshold de Dudo por nível
      const thresh = level >= 5 ? 0.58 : level >= 3 ? 0.62 : 0.7;
      if (dudoScore > thresh && dudoScore > bestRaiseScore + 0.05) {
        return { type: "dudo" };
      }
      // calza (se habilitado): chama só se P(exato) for ≥ 0.35 e nível alto
      if (state.config.calzaEnabled && level >= 5) {
        const pExact = probExact(own, pool, prev, wild);
        if (pExact > 0.35) return { type: "calza" };
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

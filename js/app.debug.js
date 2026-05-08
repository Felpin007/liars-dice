// App debug export — trilha completa para analisar partidas contra bots/online
(() => {
  const app = window.LDAApp;

  function roundMs(value) {
    return Math.max(0, Math.round(Number(value) || 0));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function playerSnapshot(player) {
    return {
      seat: player.seat,
      serverSeat: player.serverSeat ?? null,
      name: player.name,
      isBot: Boolean(player.isBot),
      botLevel: player.botLevel || 0,
      alive: Boolean(player.alive),
      diceCount: player.diceCount ?? player.dice?.length ?? 0,
      dice: Array.isArray(player.dice) ? player.dice.slice() : [],
      timeLeftMs: roundMs(player.timeLeftMs),
      lastActionTimeMs: roundMs(player.lastActionTimeMs),
    };
  }

  function ensureDebug(match, source = "local") {
    if (!match) return null;
    if (match.debugTrace) return match.debugTrace;
    const now = new Date();
    match.debugTrace = {
      schemaVersion: 1,
      source,
      matchId: match.matchId || match.id || "",
      createdAt: now.toISOString(),
      performanceOriginMs: typeof performance !== "undefined" ? performance.now() : Date.now(),
      lastDecisionAtMs: null,
      events: [],
    };
    return match.debugTrace;
  }

  function elapsedMs(debug) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return roundMs(now - (debug.performanceOriginMs || now));
  }

  function pushEvent(match, type, data = {}, options = {}) {
    const debug = ensureDebug(match, options.source || (match.authoritative ? "online" : "local"));
    if (!debug) return null;
    const atMs = elapsedMs(debug);
    const entry = {
      index: debug.events.length,
      type,
      atMs,
      wallClockAt: new Date().toISOString(),
      ...clone(data),
    };
    if (options.decision) {
      entry.intervalSincePreviousDecisionMs = debug.lastDecisionAtMs == null ? null : roundMs(atMs - debug.lastDecisionAtMs);
      debug.lastDecisionAtMs = atMs;
    }
    debug.events.push(entry);
    return entry;
  }

  function initMatchDebug(match, source = "local", options = {}) {
    if (!match) return null;
    const debug = ensureDebug(match, source);
    debug.source = source;
    debug.matchId = match.matchId || match.id || "";
    debug.initialOptions = clone(options);
    pushEvent(match, "match_created", {
      config: clone(match.config),
      turnTimeMs: roundMs(match.turnTimeMs),
      incrementMs: roundMs(match.incrementMs),
      players: match.players.map(playerSnapshot),
    });
    updateDebugExportButton();
    return debug;
  }

  function recordRoundStart(match) {
    if (!match) return;
    pushEvent(match, "round_start", {
      round: match.round,
      startSeat: match.startSeat,
      turnSeat: match.turnSeat,
      commitmentHash: match.commitment?.hashHex || null,
      players: match.players.map(playerSnapshot),
      hands: match.players.map((player) => ({
        seat: player.seat,
        name: player.name,
        dice: Array.isArray(player.dice) ? player.dice.slice() : [],
      })),
    });
  }

  function recordTurnStart(match, seat) {
    if (!match || !match.players?.[seat]) return;
    pushEvent(match, "turn_start", {
      round: match.round,
      seat,
      player: playerSnapshot(match.players[seat]),
      currentBid: clone(match.currentBid),
      startedRemainingMs: roundMs(match.clock?.startedRemainingMs),
    });
  }

  function clockDecisionMeta(match, seat, meta = {}) {
    const timeLeftMs = meta.timeLeftMs;
    const startedRemainingMs = roundMs(meta.startedRemainingMs ?? match.clock?.startedRemainingMs ?? match.players?.[seat]?.timeLeftMs ?? match.turnTimeMs);
    const incrementMs = roundMs(match.incrementMs);
    const elapsedBeforeIncrementMs = meta.decisionMs != null
      ? roundMs(meta.decisionMs)
      : roundMs(startedRemainingMs - Math.max(0, roundMs(timeLeftMs) - incrementMs));
    return {
      startedRemainingMs,
      timeLeftMs: roundMs(timeLeftMs),
      incrementMs,
      decisionMs: elapsedBeforeIncrementMs,
    };
  }

  function recordAction(match, seat, action, meta = {}) {
    if (!match || !match.players?.[seat]) return;
    const timing = clockDecisionMeta(match, seat, meta);
    pushEvent(match, "action", {
      round: match.round,
      seat,
      player: playerSnapshot(match.players[seat]),
      action: clone(action),
      previousBid: clone(meta.previousBid),
      result: clone(meta.result),
      ...timing,
    }, { decision: true });
  }

  function recordResolution(match, outcome, kind) {
    if (!match) return;
    pushEvent(match, "resolution", {
      round: match.round,
      kind,
      outcome: clone(outcome),
      players: match.players.map(playerSnapshot),
    });
    if (match.phase === "ended") recordMatchEnd(match);
  }

  function recordMatchEnd(match) {
    if (!match) return;
    if (match.debugTrace?.endedAt) {
      updateDebugExportButton();
      return;
    }
    const winner = Number.isInteger(match.winnerSeat) ? match.players[match.winnerSeat] : null;
    pushEvent(match, "match_end", {
      winnerSeat: match.winnerSeat ?? null,
      winnerName: winner?.name || null,
      players: match.players.map(playerSnapshot),
    });
    match.debugTrace.endedAt = new Date().toISOString();
    updateDebugExportButton();
  }

  function recordSnapshot(match, snapshot) {
    if (!match || !snapshot) return;
    pushEvent(match, "server_snapshot", {
      seq: snapshot.seq,
      round: snapshot.round,
      phase: snapshot.phase,
      turnSeat: snapshot.turnSeat,
      winnerSeat: snapshot.winnerSeat ?? null,
      currentBid: clone(snapshot.currentBid),
      lastAction: clone(snapshot.lastAction),
      clock: clone(snapshot.clock),
    }, { source: "online" });
    if (snapshot.phase === "ended") recordMatchEnd(match);
  }

  function plainLog() {
    return Array.from(document.querySelectorAll("#log li")).map((item, index) => ({
      index,
      className: item.className,
      text: item.innerText || item.textContent || "",
      html: item.innerHTML,
    }));
  }

  function compactMatch(match) {
    return {
      matchId: match.matchId || match.id || "",
      authoritative: Boolean(match.authoritative),
      phase: match.phase,
      round: match.round,
      winnerSeat: match.winnerSeat ?? null,
      config: clone(match.config),
      turnTimeMs: roundMs(match.turnTimeMs),
      incrementMs: roundMs(match.incrementMs),
      players: match.players.map(playerSnapshot),
      currentBid: clone(match.currentBid),
      bidHistory: clone(match.bidHistory || []),
      rounds: clone(match.rounds || []),
      lastAction: clone(match.lastAction),
      commitment: clone(match.commitment),
    };
  }

  function buildDebugExport(match = app.getMatch()) {
    if (!match) return null;
    if (match.phase === "ended") recordMatchEnd(match);
    const debug = ensureDebug(match, match.authoritative ? "online" : "local");
    return {
      exportedAt: new Date().toISOString(),
      app: {
        userAgent: navigator.userAgent,
        url: location.href,
      },
      summary: {
        matchId: match.matchId || match.id || "",
        source: debug.source,
        phase: match.phase,
        winnerSeat: match.winnerSeat ?? null,
        winnerName: Number.isInteger(match.winnerSeat) ? match.players[match.winnerSeat]?.name || null : null,
        rounds: match.rounds?.length || 0,
        players: match.players.map((player) => ({
          seat: player.seat,
          name: player.name,
          isBot: Boolean(player.isBot),
          botLevel: player.botLevel || 0,
        })),
      },
      timeline: clone(debug.events),
      visualLog: plainLog(),
      match: compactMatch(match),
    };
  }

  function debugFileName(match) {
    const id = String(match?.matchId || match?.id || "match").replace(/[^\w.-]+/g, "-").slice(0, 80);
    return `liars-debug-${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  }

  function exportDebugText(match = app.getMatch()) {
    return JSON.stringify(buildDebugExport(match), null, 2);
  }

  function downloadDebugExport(match = app.getMatch()) {
    if (!match) return;
    const text = exportDebugText(match);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = debugFileName(match);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function openDebugExportDialog() {
    const match = app.getMatch();
    if (!match) return;
    const text = exportDebugText(match);
    app.openDialog("Exportar debug da partida", `
      <p>JSON completo da partida, com timeline, log visual, mãos, seeds reveladas e tempo de decisão por ação.</p>
      <div class="match-config-actions">
        <button id="debug-copy" type="button" class="btn">Copiar JSON</button>
        <button id="debug-download" type="button" class="btn btn-primary">Baixar JSON</button>
      </div>
      <pre>${app.esc(text)}</pre>
    `);
    app.$("#debug-copy")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        app.$("#debug-copy").textContent = "Copiado";
      } catch {
        app.$("#debug-copy").textContent = "Copie pelo texto abaixo";
      }
    });
    app.$("#debug-download")?.addEventListener("click", () => downloadDebugExport(match));
  }

  function updateDebugExportButton() {
    const button = app.$("#btn-debug-export");
    const match = app.getMatch?.();
    if (!button) return;
    button.classList.toggle("hidden", !(match && match.phase === "ended"));
  }

  Object.assign(app, {
    buildDebugExport,
    downloadDebugExport,
    exportDebugText,
    initMatchDebug,
    openDebugExportDialog,
    recordDebugAction: recordAction,
    recordDebugMatchEnd: recordMatchEnd,
    recordDebugResolution: recordResolution,
    recordDebugRoundStart: recordRoundStart,
    recordDebugSnapshot: recordSnapshot,
    recordDebugTurnStart: recordTurnStart,
    updateDebugExportButton,
  });
})();

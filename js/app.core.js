// App core — estado compartilhado, utilitários e relógio da partida
window.LDAApp = (() => {
  const $ = (s) => document.querySelector(s);

  const state = {
    match: null,
    busy: false,
    sessionId: 0,
    startingMatch: false,
    liveTicker: null,
    timeoutLock: false,
    lastStartOptions: null,
    online: {
      ready: false,
      backendAvailable: false,
      clientId: null,
      csrfToken: "",
      username: "",
      inviteOrigin: "",
      stats: { online: 0, matches: 0 },
      rooms: [],
      currentRoom: null,
      currentQueue: null,
      eventSource: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      reconnecting: false,
      heartbeatId: null,
      snapshotPollId: null,
      matchPollId: null,
      pollingSnapshot: false,
      pollingMatch: false,
      searchStartedAt: 0,
      activeMatchId: null,
      activeSession: null,
      authoritative: false,
      lastSnapshotSeq: 0,
      lastRevealKey: "",
      pendingActiveMatch: null,
      localToServerSeat: null,
      serverToLocalSeat: null,
    },
    account: {
      configured: false,
      client: null,
      session: null,
      user: null,
      profile: null,
      history: [],
      friends: [],
      friendRequests: [],
      notifications: [],
      unreadNotifications: 0,
      avatarBucket: "avatars",
      refreshAfterMatchId: null,
    },
  };

  const constants = {
    BOT_NAMES: ["Alice", "Bob", "Carla", "Diego", "Eva", "Fátima", "Gael", "Helena"],
    PLAYER_COLORS: ["#e4b14f", "#63c871", "#5c95ff", "#b475ff", "#ff7c92", "#53d3ca"],
    TURN_TIME_MS: 20000,
  };

  function getMatch() {
    return state.match;
  }

  function setMatch(nextMatch) {
    state.match = nextMatch;
    return state.match;
  }

  function isSessionActive(id) {
    return id === state.sessionId;
  }

  function setScreen(inGame) {
    document.body.classList.toggle("game-active", inGame);
    $("#menu").classList.toggle("hidden", inGame);
    $("#game-layout").classList.toggle("hidden", !inGame);
    $("#menu-topbar-actions").classList.toggle("hidden", inGame);
    $("#game-nav").classList.toggle("hidden", !inGame);
    $("#btn-menu").classList.toggle("hidden", !inGame);
    $("#btn-new").classList.toggle("hidden", !inGame);
    $("#btn-fair").classList.toggle("hidden", !inGame);
    $("#btn-ldn").classList.toggle("hidden", !inGame);
    $("#wrap-toggle-3d").classList.toggle("hidden", !inGame);
    window.LDAApp?.updateDebugExportButton?.();
  }

  function showMenu() {
    state.sessionId += 1;
    state.busy = false;
    state.startingMatch = false;
    state.timeoutLock = false;
    state.online.activeMatchId = null;
    state.online.activeSession = null;
    state.online.authoritative = false;
    state.online.lastSnapshotSeq = 0;
    state.online.localToServerSeat = null;
    state.online.serverToLocalSeat = null;
    UI.setMode3d(false);
    $("#log").innerHTML = "";
    state.match = null;
    setScreen(false);
  }

  function showGame() {
    setScreen(true);
  }

  function ensureLiveTicker() {
    if (state.liveTicker) return;
    state.liveTicker = setInterval(() => {
      const match = state.match;
      if (!match || match.phase !== "bidding") return;
      const now = getNow();
      refreshLiveClock(now);
      UI.updateLive(match);

      if (!match.clock || match.clock.currentSeat == null || state.timeoutLock) return;
      const currentSeat = match.clock.currentSeat;
      if (getPlayerTimeLeft(currentSeat, now) > 0) return;
      if (state.online.authoritative) return;
      if (typeof window.LDAApp?.handleTurnTimeout !== "function") return;

      state.timeoutLock = true;
      Promise.resolve(window.LDAApp.handleTurnTimeout(currentSeat, state.sessionId))
        .catch((error) => console.error(error))
        .finally(() => {
          if (state.match && state.match.phase === "bidding") state.timeoutLock = false;
        });
    }, 100);
  }

  function getNow() {
    return performance.now();
  }

  function clearTurnClock() {
    const match = state.match;
    if (!match) return;
    match.clock.currentSeat = null;
    match.clock.startedAt = 0;
  }

  function getPlayerTimeLeft(seat, now = getNow()) {
    const match = state.match;
    if (!match) return 0;
    const player = match.players[seat];
    if (!player) return 0;

    const fallback = player.timeLeftMs ?? match.turnTimeMs ?? constants.TURN_TIME_MS;
    if (match.phase === "bidding" && match.clock && match.clock.currentSeat === seat && match.clock.startedAt) {
      return Math.max(0, match.clock.startedRemainingMs - (now - match.clock.startedAt));
    }
    return Math.max(0, fallback);
  }

  function refreshLiveClock(now = getNow()) {
    const match = state.match;
    if (!match) return;
    match.players.forEach((player) => {
      player.uiTimeLeftMs = getPlayerTimeLeft(player.seat, now);
    });
  }

  function startTurnClock(seat) {
    const match = state.match;
    if (!match) return;
    match.clock.currentSeat = seat;
    match.clock.startedRemainingMs = Math.max(0, match.players[seat].timeLeftMs ?? match.turnTimeMs ?? constants.TURN_TIME_MS);
    match.clock.startedAt = getNow();
    refreshLiveClock(match.clock.startedAt);
  }

  function commitActionTime(seat, options = {}) {
    const match = state.match;
    if (!match) return 0;

    const { applyIncrement = true } = options;
    const left = getPlayerTimeLeft(seat);
    const player = match.players[seat];
    const incrementMs = applyIncrement ? Math.max(0, match.incrementMs || 0) : 0;
    const nextLeft = Math.max(0, left + incrementMs);
    player.timeLeftMs = nextLeft;
    player.uiTimeLeftMs = nextLeft;
    player.lastActionTimeMs = nextLeft;
    clearTurnClock();
    return nextLeft;
  }

  function setLastAction(action) {
    const match = state.match;
    if (!match) return;
    match.lastAction = action;
    if (action && action.seat != null && match.players[action.seat]) {
      match.players[action.seat].lastAction = action;
    }
  }

  function bidHtml(bid) {
    const match = state.match;
    return UI.renderBidMarkup(bid, { wildAces: match && match.config ? match.config.wildAces : false, mini: true });
  }

  function actionTimeHtml(ms) {
    return `<span class="log-time">⏱ ${UI.formatTime(ms)}</span>`;
  }

  function playerLabel(seat) {
    const match = state.match;
    if (!match || !match.players[seat]) return "—";
    return seat === 0 ? "Você" : match.players[seat].name;
  }

  function bidLogHtml(seat, bid, timeLeftMs) {
    const who = playerLabel(seat);
    return `
      <div class="log-turn-head">
        <span class="log-turn-label">Turno de ${esc(who)}</span>
        ${actionTimeHtml(timeLeftMs)}
      </div>
      <div class="log-turn-detail">→ ${esc(who)} fez um lance: ${bidHtml(bid)}</div>`;
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function errorMsg(code) {
    return {
      "invalid-raise": "Lance inválido: precisa aumentar o anterior.",
      "not-your-turn": "Não é sua vez.",
      "no-bid": "Não há lance para desafiar.",
      "phase": "Fase inválida.",
      "above-pool": "Quantidade maior que o total de dados em jogo.",
      login_required: "Entre com Google para usar este recurso.",
      profile_not_found: "Usuário não encontrado.",
      already_friends: "Vocês já são amigos.",
      request_pending: "Já existe um pedido pendente.",
      friend_cooldown: "Pedido recusado recentemente. Tente novamente depois de 24 horas.",
      friend_self: "Você não pode adicionar a si mesmo.",
      username_blocked: "Esse usuário não pode ser usado.",
      username_link_blocked: "Esse usuário não pode conter link.",
      profile_text_blocked: "Texto bloqueado pela moderação.",
      profile_text_link_blocked: "Perfil não pode conter links externos.",
      invalid_report: "Revise o report: alvo, motivo e detalhes precisam ser válidos.",
      supabase_schema_missing: "O Supabase esta com tabelas faltando. Rode o schema.sql completo.",
    }[code] || (`Erro: ${code}`);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    $,
    state,
    constants,
    getMatch,
    setMatch,
    isSessionActive,
    setScreen,
    showMenu,
    showGame,
    ensureLiveTicker,
    getNow,
    clearTurnClock,
    getPlayerTimeLeft,
    refreshLiveClock,
    startTurnClock,
    commitActionTime,
    setLastAction,
    bidHtml,
    actionTimeHtml,
    playerLabel,
    bidLogHtml,
    esc,
    errorMsg,
    sleep,
  };
})();

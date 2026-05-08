// App online bootstrap — eventos SSE, heartbeat e inicializacao
(() => {
  const app = window.LDAApp;

  function setConnectionStatus(text) {
    if (!text) return;
    if (app.state.online.authoritative && app.state.online.activeMatchId) {
      UI.showRevealBanner(text, "bad");
      return;
    }
    if (!app.state.account.profile) {
      const rankEl = app.$("#menu-profile-rank");
      if (rankEl) rankEl.textContent = text;
    }
  }

  function clearReconnectTimer() {
    if (app.state.online.reconnectTimer) {
      clearTimeout(app.state.online.reconnectTimer);
      app.state.online.reconnectTimer = null;
    }
  }

  function stopPolling() {
    if (app.state.online.snapshotPollId) clearInterval(app.state.online.snapshotPollId);
    if (app.state.online.matchPollId) clearInterval(app.state.online.matchPollId);
    app.state.online.snapshotPollId = null;
    app.state.online.matchPollId = null;
    app.state.online.pollingSnapshot = false;
    app.state.online.pollingMatch = false;
  }

  async function pollSnapshotNow() {
    if (!app.state.online.ready || app.state.online.pollingSnapshot) return;
    app.state.online.pollingSnapshot = true;
    try {
      const snapshot = await app.api("/api/snapshot", { method: "GET" });
      app.state.online.backendAvailable = true;
      app.onlineCommon.applySnapshot(snapshot);
    } catch (error) {
      app.state.online.backendAvailable = false;
      console.warn("Snapshot indisponivel:", error.message);
    } finally {
      app.state.online.pollingSnapshot = false;
    }
  }

  async function pollActiveMatchNow() {
    const matchId = app.state.online.activeMatchId;
    if (!app.state.online.ready || !matchId || app.state.online.pollingMatch) return;
    app.state.online.pollingMatch = true;
    try {
      const payload = await app.api(`/api/match/${encodeURIComponent(matchId)}`, { method: "GET" });
      app.state.online.backendAvailable = true;
      if (payload.snapshot) app.applyServerMatchSnapshot(payload.snapshot);
    } catch (error) {
      app.state.online.backendAvailable = false;
      console.warn("Partida indisponivel:", error.message);
    } finally {
      app.state.online.pollingMatch = false;
    }
  }

  function startPolling() {
    if (app.state.online.snapshotPollId) return;
    app.state.online.snapshotPollId = setInterval(pollSnapshotNow, 2000);
    app.state.online.matchPollId = setInterval(pollActiveMatchNow, 1000);
  }

  function scheduleReconnect() {
    if (!app.state.online.ready || app.state.online.reconnectTimer) return;
    app.state.online.reconnecting = true;
    app.state.online.reconnectAttempts += 1;
    const delay = Math.min(20_000, 1000 * Math.pow(1.7, app.state.online.reconnectAttempts - 1));
    setConnectionStatus("Reconectando...");
    app.state.online.reconnectTimer = window.setTimeout(() => {
      app.state.online.reconnectTimer = null;
      connectEvents();
    }, delay);
  }

  function connectEvents() {
    if (!app.state.online.ready) return;

    clearReconnectTimer();
    if (app.state.online.eventSource) {
      app.state.online.eventSource.close();
    }

    const source = new EventSource("/api/events");
    app.state.online.eventSource = source;

    source.onopen = () => {
      app.state.online.backendAvailable = true;
      app.state.online.reconnecting = false;
      app.state.online.reconnectAttempts = 0;
    };

    source.addEventListener("bootstrap", (event) => {
      app.state.online.backendAvailable = true;
      app.state.online.reconnecting = false;
      app.state.online.reconnectAttempts = 0;
      app.onlineCommon.applySnapshot(JSON.parse(event.data));
    });

    source.addEventListener("home.update", (event) => {
      const payload = JSON.parse(event.data);
      app.onlineCommon.setStats(payload.stats);
      app.onlineCommon.renderRooms(payload.rooms);
    });

    source.addEventListener("room.update", (event) => {
      const payload = JSON.parse(event.data);
      app.state.online.currentRoom = payload.room;
      app.onlineCommon.setStats(payload.stats);
      app.onlineCommon.renderRooms(payload.rooms);
      app.onlineRooms.syncRoomDialog(payload.room, app.absoluteInviteLink(payload.room.code));
    });

    source.addEventListener("invite.received", (event) => {
      const payload = JSON.parse(event.data);
      app.openDialog(
        "Convite recebido",
        `<div class="invite-result">
          <div class="invite-summary">
            <strong>${app.esc(payload.from)} enviou um convite.</strong>
            <p>Abra o desafio abaixo e entre direto na sala.</p>
            <div class="invite-summary-chips">
              <span class="invite-chip">${app.esc(payload.room.title)}</span>
              <span class="invite-chip">${payload.room.minutes}+${payload.room.increment}</span>
            </div>
          </div>
          <div class="match-config-actions">
            <button id="accept-invite-now" type="button" class="btn btn-primary btn-big">Entrar na sala</button>
          </div>
        </div>`
      );

      app.$("#accept-invite-now")?.addEventListener("click", async () => {
        try {
          await app.joinOnlineRoom(payload.code);
        } catch (error) {
          app.openDialog("Convite inválido", `<p>${app.esc(error.message)}</p>`);
        }
      });
    });

    source.addEventListener("queue.update", (event) => {
      const payload = JSON.parse(event.data);
      app.state.online.currentQueue = payload.queue || null;
      app.onlineCommon.setStats(payload.stats);
      if (payload.queue) {
        app.onlineQueue.showSearchView(payload.queue, "Aguardando jogadores compatíveis…");
      }
    });

    source.addEventListener("queue.matchFound", (event) => {
      const payload = JSON.parse(event.data);
      app.state.online.currentQueue = null;
      app.onlineQueue.setSearchStatus(payload.autoFilledWithBots ? "Mesa fechada com bots para a partida." : "Pareamento encontrado.");
      window.setTimeout(() => {
        app.onlineQueue.hideSearchView();
        app.onlineMatch.launchAuthoritativeMatch(payload);
      }, 1400);
    });

    source.addEventListener("match.started", (event) => {
      const payload = JSON.parse(event.data);
      app.onlineMatch.launchAuthoritativeMatch(payload);
    });

    source.addEventListener("match.snapshot", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.matchId !== app.state.online.activeMatchId) return;
      app.applyServerMatchSnapshot(payload.snapshot);
    });

    source.addEventListener("game.action", (event) => {
      if (app.state.online.authoritative) return;
      const payload = JSON.parse(event.data);
      if (payload.matchId !== app.state.online.activeMatchId) return;
      const activeSession = app.state.online.activeSession;
      if (activeSession == null) return;
      const localSeat = app.state.online.serverToLocalSeat?.[payload.seat];
      if (!Number.isInteger(localSeat)) return;
      app.performAction(localSeat, payload.action, activeSession);
    });

    source.onerror = () => {
      if (app.state.online.eventSource === source) {
        source.close();
        startPolling();
        pollSnapshotNow();
        scheduleReconnect();
      }
    };
  }

  function startHeartbeat() {
    if (app.state.online.heartbeatId) {
      clearInterval(app.state.online.heartbeatId);
    }

    app.state.online.heartbeatId = setInterval(async () => {
      if (!app.state.online.csrfToken) return;
      try {
        const payload = await app.api("/api/heartbeat", {
          method: "POST",
        });
        app.state.online.backendAvailable = true;
        app.onlineCommon.setStats(payload.stats);
      } catch {
        app.state.online.backendAvailable = false;
      }
    }, 15_000);
  }

  async function bootstrapOnline() {
    const preferredName = app.onlineCommon.storedUsername() || app.onlineCommon.defaultUsername();
    try {
      const supabaseAccessToken = await app.supabaseAuth?.accessToken?.();
      const snapshot = await app.api("/api/bootstrap", {
        method: "POST",
        body: {
          username: preferredName,
          supabaseAccessToken,
        },
      });
      app.state.online.ready = true;
      app.state.online.backendAvailable = true;
      app.onlineCommon.applySnapshot(snapshot);
      localStorage.removeItem("lda.clientId");
      connectEvents();
      startPolling();
      startHeartbeat();
      app.onlineRooms.handleInviteRoute();
    } catch (error) {
      console.warn("Backend offline:", error);
      app.state.online.lastError = error.message || String(error);
      app.state.online.backendAvailable = false;
      const rankEl = app.$("#menu-profile-rank");
      if (rankEl) rankEl.textContent = error.message === "supabase_schema_missing" ? "Supabase incompleto" : "Modo local · Offline";
    }
  }

  Object.assign(app, {
    bootstrapOnline,
    pollSnapshotNow,
    pollActiveMatchNow,
    startOnlinePolling: startPolling,
    stopOnlinePolling: stopPolling,
  });
})();

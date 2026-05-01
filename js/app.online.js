// App online bootstrap — eventos SSE, heartbeat e inicializacao
(() => {
  const app = window.LDAApp;

  function connectEvents() {
    if (!app.state.online.ready) return;

    if (app.state.online.eventSource) {
      app.state.online.eventSource.close();
    }

    const source = new EventSource("/api/events");
    app.state.online.eventSource = source;

    source.addEventListener("bootstrap", (event) => {
      app.state.online.backendAvailable = true;
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
      app.state.online.backendAvailable = false;
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
      const snapshot = await app.api("/api/bootstrap", {
        method: "POST",
        body: {
          username: preferredName,
        },
      });
      app.state.online.ready = true;
      app.state.online.backendAvailable = true;
      app.onlineCommon.applySnapshot(snapshot);
      localStorage.removeItem("lda.clientId");
      connectEvents();
      startHeartbeat();
      app.onlineRooms.handleInviteRoute();
    } catch (error) {
      console.warn("Backend offline:", error);
      app.state.online.backendAvailable = false;
      const rankEl = app.$("#menu-profile-rank");
      if (rankEl) rankEl.textContent = "Modo local · Offline";
    }
  }

  Object.assign(app, {
    bootstrapOnline,
  });
})();

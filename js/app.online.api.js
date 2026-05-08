// App online API/common — fetch, perfil, estatisticas e lista de salas
(() => {
  const app = window.LDAApp;
  const STORAGE_USERNAME = "lda.username";

  function isUnsafeMethod(method) {
    return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method || "GET").toUpperCase());
  }

  async function api(path, options = {}) {
    const method = options.method || "GET";
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    const token = await app.supabaseAuth?.accessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (isUnsafeMethod(method) && app.state.online.csrfToken) {
      headers["X-CSRF-Token"] = app.state.online.csrfToken;
    }

    const init = {
      ...options,
      method,
      headers,
      credentials: "same-origin",
    };

    if (options.body && typeof options.body !== "string") {
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.error === "auth_required" && !options.__retriedAuth && path !== "/api/bootstrap") {
        await app.bootstrapOnline?.({ reconnectOnly: true });
        return api(path, { ...options, __retriedAuth: true });
      }
      throw new Error(payload.error || payload.message || `Falha em ${path}`);
    }
    return payload;
  }

  function storedUsername() {
    return localStorage.getItem(STORAGE_USERNAME) || "";
  }

  function defaultUsername() {
    const suffix = Math.random().toString(36).slice(2, 6);
    return `Jogador-${suffix}`;
  }

  function setProfile(profile) {
    if (!profile) return;
    app.state.online.clientId = profile.clientId;
    app.state.online.username = profile.username;
    app.state.online.avatarUrl = profile.avatarUrl || "";
    localStorage.setItem(STORAGE_USERNAME, profile.username);
    if (!app.state.account.profile) {
      const nameEl = app.$("#menu-profile-name");
      const rankEl = app.$("#menu-profile-rank");
      if (nameEl) nameEl.textContent = profile.displayName || profile.username;
      if (rankEl) rankEl.textContent = profile.supabaseUserId ? "Conta conectada" : "Lobby online · Casual";
    }
  }

  function setStats(stats) {
    app.state.online.stats = stats || { online: 0, matches: 0 };
    const onlineText = `${app.state.online.stats.online} online`;
    const matchesText = `${app.state.online.stats.matches} partidas`;
    const topOnline = app.$("#brand-online");
    const topMatches = app.$("#brand-matches");
    if (topOnline) topOnline.textContent = onlineText;
    if (topMatches) topMatches.textContent = matchesText;

    const searchOnline = app.$("#menu-search-online");
    const searchMatches = app.$("#menu-search-matches");
    if (searchOnline) searchOnline.textContent = String(app.state.online.stats.online);
    if (searchMatches) searchMatches.textContent = String(app.state.online.stats.matches);
  }

  function setInviteOriginFromLink(link) {
    try {
      app.state.online.inviteOrigin = new URL(link).origin;
    } catch {}
  }

  function renderRooms(rooms) {
    app.state.online.rooms = Array.isArray(rooms) ? rooms : [];
    const list = app.$("#rooms-list");
    const empty = app.$("#rooms-empty");
    if (!list) return;

    list.innerHTML = app.state.online.rooms.map((room) => `
      <div class="room-row">
        <div class="room-main">
          <span class="room-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#icon-user"></use></svg></span>
          <div>
            <strong>${app.esc(room.title)}</strong>
            <small>${app.esc(room.description)}</small>
          </div>
        </div>
        <div class="room-badges">
          <span class="room-badge">${room.matchType === "ranqueada" ? "Rating aberto" : "Rating livre"}</span>
          <span class="room-badge">${room.minutes}+${room.increment}</span>
          <span class="room-badge ${room.matchType === "ranqueada" ? "ranked" : "friendly"}">${room.matchType === "ranqueada" ? "Ranqueada" : "Amistosa"}</span>
        </div>
        <span class="room-meta">${room.memberCount} / ${room.maxPlayers}</span>
        <button class="room-enter" type="button" data-room-join="${room.code}">Entrar</button>
      </div>
    `).join("");

    if (empty) empty.classList.toggle("hidden", app.state.online.rooms.length > 0);

    list.querySelectorAll("[data-room-join]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await app.joinOnlineRoom(button.dataset.roomJoin);
        } catch (error) {
          app.openDialog("Nao foi possivel entrar", `<p>${app.esc(error.message)}</p>`);
        }
      });
    });
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.security?.csrfToken) {
      app.state.online.csrfToken = snapshot.security.csrfToken;
    }
    setProfile(snapshot.profile);
    if (snapshot.links?.inviteOrigin) {
      app.state.online.inviteOrigin = snapshot.links.inviteOrigin;
    }
    setStats(snapshot.stats);
    renderRooms(snapshot.rooms);
    app.state.online.currentQueue = snapshot.queue || null;
    app.state.online.currentRoom = snapshot.currentRoom || null;
    app.state.online.pollingOnly = Boolean(snapshot.runtime?.pollingOnly);

    if (snapshot.currentRoom) {
      app.onlineRooms.syncRoomDialog(snapshot.currentRoom, app.absoluteInviteLink(snapshot.currentRoom.code));
    }
    if (snapshot.activeMatch?.authoritative && snapshot.activeMatch.snapshot) {
      window.setTimeout(() => app.onlineMatch?.launchAuthoritativeMatch(snapshot.activeMatch), 0);
    }
    app.refreshAccount?.().catch((error) => console.warn("Perfil persistente indisponivel:", error));
    app.refreshSocial?.().catch((error) => console.warn("Social indisponivel:", error));
  }

  app.onlineCommon = {
    api,
    storedUsername,
    defaultUsername,
    setStats,
    setInviteOriginFromLink,
    renderRooms,
    applySnapshot,
  };

  Object.assign(app, { api });
})();

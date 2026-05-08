// App online rooms — criacao, convites e modal de sala
(() => {
  const app = window.LDAApp;

  async function createOnlineLobby(kind, config) {
    const payload = await app.api("/api/rooms", {
      method: "POST",
      body: {
        kind: kind === "friend" ? "challenge" : "room",
        config,
      },
    });
    app.state.online.currentRoom = payload.room;
    if (payload.link) app.onlineCommon.setInviteOriginFromLink(payload.link);
    if (payload.links?.inviteOrigin) app.state.online.inviteOrigin = payload.links.inviteOrigin;
    renderRoomDialog(payload.room, payload.link);
    return payload;
  }

  async function joinOnlineRoom(code, options = {}) {
    const payload = await app.api(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
    });
    app.state.online.currentRoom = payload.room;
    if (payload.link) app.onlineCommon.setInviteOriginFromLink(payload.link);
    if (payload.links?.inviteOrigin) app.state.online.inviteOrigin = payload.links.inviteOrigin;
    if (!options.silent) renderRoomDialog(payload.room, payload.link);
    return payload;
  }

  async function leaveOnlineRoom(code) {
    await app.api(`/api/rooms/${encodeURIComponent(code)}/leave`, {
      method: "POST",
    });
    app.state.online.currentRoom = null;
  }

  async function startOnlineRoom(code) {
    const payload = await app.api(`/api/rooms/${encodeURIComponent(code)}/start`, {
      method: "POST",
    });
    app.onlineMatch.launchAuthoritativeMatch(payload);
    return payload;
  }

  async function inviteUserToRoom(code, username) {
    return app.api(`/api/rooms/${encodeURIComponent(code)}/invite`, {
      method: "POST",
      body: { username },
    });
  }

  function absoluteInviteLink(code) {
    const origin = app.state.online.inviteOrigin || window.location.origin;
    return `${origin}/invite/${encodeURIComponent(code)}`;
  }

  function qrImage(link) {
    return `/api/qr?data=${encodeURIComponent(link)}`;
  }

  function roomSummaryChips(room) {
    return [
      gameTypeText(room.gameType),
      `${room.minutes}+${room.increment}`,
      room.matchType === "ranqueada" ? "Ranqueada" : "Amistosa",
      `${room.memberCount}/${room.maxPlayers}`,
    ].map((chip) => `<span class="invite-chip">${app.esc(chip)}</span>`).join("");
  }

  function gameTypeText(gameType) {
    return {
      "classic-4": "Clássico · 4p",
      "duel-2": "Duelo · 2p",
      "arena-6": "Arena · 6p",
      "private-4": "Privada · 4p",
    }[gameType] || "Clássico";
  }

  function roomDialogHtml(room, link) {
    const members = room.members.map((member) => `
      <li class="invite-member${member.isHost ? " is-host" : ""}">
        <span>${app.esc(member.username)}</span>
        <small>${member.isHost ? "Host" : "Na sala"}</small>
      </li>
    `).join("");

    return `
      <div class="invite-result" data-room-code="${room.code}">
        <div class="invite-summary">
          <strong>${app.esc(room.title)}</strong>
          <p>${app.esc(room.description)}</p>
          <div class="invite-summary-chips">${roomSummaryChips(room)}</div>
        </div>

        <div class="invite-link-card">
          <span class="match-label">Link do convite</span>
          <div class="invite-link-row">
            <input id="invite-link-input" class="invite-link-input" type="text" readonly value="${app.esc(link)}" />
            <button id="invite-copy" type="button" class="btn">Copiar link</button>
          </div>
        </div>

        <div class="invite-share-grid">
          <div class="invite-qr-card">
            <span class="match-label">QR code</span>
            <div class="invite-qr-live">
              <img src="${qrImage(link)}" alt="QR code do convite" />
            </div>
            <small>Escaneie para abrir o convite.</small>
          </div>

          <div class="invite-user-card">
            <span class="match-label">${room.kind === "challenge" ? "Convide um usuário específico" : "Convide um usuário Liar's Dice"}</span>
            <div class="invite-user-row">
              <input id="invite-user-input" class="invite-user-input" type="text" placeholder="nome_do_usuario" />
              <button id="invite-user-button" type="button" class="btn btn-primary">${room.kind === "challenge" ? "Desafiar" : "Enviar convite"}</button>
            </div>
            <p id="invite-user-feedback" class="invite-feedback">Quem entrar por este link cai direto nesta sala.</p>
          </div>
        </div>

        <div class="invite-room-card">
          <span class="match-label">Jogadores na sala</span>
          <ul class="invite-members">${members}</ul>
        </div>

        <div class="match-config-actions">
          ${room.isHost ? '<button id="room-start-button" type="button" class="btn btn-primary">Iniciar partida</button>' : ""}
          <button id="room-leave-button" type="button" class="btn">Sair da sala</button>
        </div>
      </div>
    `;
  }

  function bindRoomDialog(room, link) {
    const root = app.$("#dlg-content");
    if (!root) return;
    root.dataset.roomCode = room.code;

    root.querySelector("#invite-copy")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        await navigator.clipboard.writeText(link);
        button.textContent = "Link copiado";
      } catch {
        button.textContent = "Copie manualmente";
      }
    });

    root.querySelector("#invite-user-button")?.addEventListener("click", async () => {
      const input = root.querySelector("#invite-user-input");
      const feedback = root.querySelector("#invite-user-feedback");
      const username = input?.value.trim();
      if (!username) {
        if (feedback) feedback.textContent = "Digite um usuário para enviar o convite.";
        return;
      }
      try {
        const result = await inviteUserToRoom(room.code, username);
        if (feedback) {
          feedback.textContent = result.delivered
            ? `Convite enviado para @${username}.`
            : `@${username} não está online agora. Compartilhe o link manualmente.`;
        }
      } catch (error) {
        if (feedback) feedback.textContent = error.message;
      }
    });

    root.querySelector("#room-leave-button")?.addEventListener("click", async () => {
      try {
        await leaveOnlineRoom(room.code);
        app.$("#dlg").close();
      } catch (error) {
        app.openDialog("Nao foi possivel sair", `<p>${app.esc(error.message)}</p>`);
      }
    });

    root.querySelector("#room-start-button")?.addEventListener("click", async () => {
      try {
        await startOnlineRoom(room.code);
      } catch (error) {
        app.openDialog("Nao foi possivel iniciar", `<p>${app.esc(error.message)}</p>`);
      }
    });
  }

  function renderRoomDialog(room, link) {
    app.openDialog(room.kind === "challenge" ? "Desafio privado" : "Sala de espera", roomDialogHtml(room, link));
    bindRoomDialog(room, link);
  }

  function syncRoomDialog(room, link) {
    const dialog = app.$("#dlg");
    const content = app.$("#dlg-content");
    if (!dialog?.open || !content || content.dataset.roomCode !== room.code) return;
    content.innerHTML = roomDialogHtml(room, link);
    bindRoomDialog(room, link);
  }

  async function handleInviteRoute() {
    const match = window.location.pathname.match(/^\/invite\/([^/]+)/);
    if (!match || !app.state.online.backendAvailable) return;
    try {
      await joinOnlineRoom(match[1], { silent: false });
      window.history.replaceState({}, "", "/");
    } catch (error) {
      app.openDialog("Convite inválido", `<p>${app.esc(error.message)}</p>`);
    }
  }

  app.onlineRooms = {
    renderRoomDialog,
    syncRoomDialog,
    handleInviteRoute,
  };

  Object.assign(app, {
    createOnlineLobby,
    joinOnlineRoom,
    leaveOnlineRoom,
    startOnlineRoom,
    inviteUserToRoom,
    absoluteInviteLink,
  });
})();

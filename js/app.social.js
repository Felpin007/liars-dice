// App social — amigos e notificacoes in-app
(() => {
  const app = window.LDAApp;

  function requireProfileMessage() {
    return `<div class="rooms-empty">Entre com Google para usar amigos e notificações persistentes.</div>`;
  }

  function renderFriendsRail() {
    const list = document.querySelector(".friends-list");
    if (!list) return;
    const profile = app.state.account.profile;
    if (!profile) {
      list.innerHTML = requireProfileMessage();
      return;
    }
    const friends = app.state.account.friends || [];
    const pending = (app.state.account.friendRequests || []).filter((request) => request.status === "pending" && request.targetProfileId === profile.id);
    if (!friends.length && !pending.length) {
      list.innerHTML = `<div class="rooms-empty">Nenhum amigo ainda. Envie um pedido pelo botão Ver todos.</div>`;
      return;
    }
    list.innerHTML = [
      ...pending.slice(0, 2).map((request) => `
        <div class="friend-row">
          <span class="friend-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#icon-user"></use></svg></span>
          <div class="friend-main"><strong>${app.esc(request.requesterUsername)}</strong><small>Pedido pendente</small></div>
          <span>novo</span>
        </div>`),
      ...friends.slice(0, 4).map((friend) => `
        <div class="friend-row">
          <span class="friend-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#icon-user"></use></svg></span>
          <div class="friend-main"><strong>${app.esc(friend.username)}</strong><small class="online">Amigo</small></div>
          <span>ver</span>
        </div>`),
    ].join("");
  }

  function updateNotificationBadge() {
    const badge = app.$("#notification-badge");
    if (!badge) return;
    const unread = Number(app.state.account.unreadNotifications || 0);
    badge.textContent = unread > 9 ? "9+" : String(unread);
    badge.classList.toggle("hidden", unread <= 0);
  }

  async function refreshSocial() {
    if (!app.state.account.profile) {
      app.state.account.friends = [];
      app.state.account.friendRequests = [];
      app.state.account.notifications = [];
      app.state.account.unreadNotifications = 0;
      renderFriendsRail();
      updateNotificationBadge();
      return;
    }
    try {
      const [friends, notifications] = await Promise.all([
        app.api("/api/friends"),
        app.api("/api/notifications"),
      ]);
      app.state.account.friends = friends.friends || [];
      app.state.account.friendRequests = friends.requests || [];
      app.state.account.notifications = notifications.notifications || [];
      app.state.account.unreadNotifications = notifications.unread || 0;
      renderFriendsRail();
      updateNotificationBadge();
    } catch (error) {
      console.warn("Social indisponivel:", error.message);
    }
  }

  function requestRows() {
    const profile = app.state.account.profile;
    const requests = app.state.account.friendRequests || [];
    const incoming = requests.filter((request) => request.status === "pending" && request.targetProfileId === profile?.id);
    if (!incoming.length) return `<div class="profile-empty">Nenhum pedido pendente.</div>`;
    return incoming.map((request) => `
      <div class="profile-history-row">
        <div><strong>${app.esc(request.requesterUsername)}</strong><small>quer adicionar você</small></div>
        <span>
          <button type="button" class="btn" data-friend-response="decline" data-request-id="${app.esc(request.id)}">Recusar</button>
          <button type="button" class="btn btn-primary" data-friend-response="accept" data-request-id="${app.esc(request.id)}">Aceitar</button>
        </span>
      </div>`).join("");
  }

  function friendRows() {
    const friends = app.state.account.friends || [];
    if (!friends.length) return `<div class="profile-empty">Nenhum amigo confirmado.</div>`;
    return friends.map((friend) => `
      <div class="profile-history-row">
        <div><strong>${app.esc(friend.username)}</strong><small>Amigo desde ${new Date(friend.createdAt).toLocaleDateString()}</small></div>
        <button type="button" class="btn" data-remove-friend="${app.esc(friend.profileId)}">Remover</button>
      </div>`).join("");
  }

  async function openFriendsDialog() {
    if (!app.state.account.profile) {
      app.openDialog("Amigos", `<p>Entre com Google para adicionar amigos.</p><button id="friends-login" type="button" class="btn btn-primary">Entrar com Google</button>`);
      app.$("#friends-login")?.addEventListener("click", () => app.supabaseAuth.signInWithGoogle());
      return;
    }
    await refreshSocial();
    app.openDialog("Amigos", `
      <div class="profile-shell">
        <div class="invite-user-row">
          <input id="friend-username-input" class="invite-user-input" type="text" placeholder="username exato" />
          <button id="friend-request-send" type="button" class="btn btn-primary">Enviar pedido</button>
        </div>
        <p id="friend-feedback" class="invite-feedback">Se a pessoa recusar, você poderá reenviar depois de 24 horas.</p>
        <h3>Pedidos recebidos</h3>
        ${requestRows()}
        <h3>Amigos</h3>
        ${friendRows()}
      </div>`);
    app.$("#friend-request-send")?.addEventListener("click", sendFriendRequestFromDialog);
    document.querySelectorAll("[data-friend-response]").forEach((button) => {
      button.addEventListener("click", () => respondFriend(button.dataset.requestId, button.dataset.friendResponse));
    });
    document.querySelectorAll("[data-remove-friend]").forEach((button) => {
      button.addEventListener("click", () => removeFriend(button.dataset.removeFriend));
    });
  }

  async function sendFriendRequestFromDialog() {
    const input = app.$("#friend-username-input");
    const feedback = app.$("#friend-feedback");
    try {
      await app.api("/api/friends/request", {
        method: "POST",
        body: { username: input?.value || "" },
      });
      if (feedback) feedback.textContent = "Pedido enviado.";
      await refreshSocial();
    } catch (error) {
      if (feedback) feedback.textContent = app.errorMsg(error.message);
    }
  }

  async function respondFriend(requestId, response) {
    await app.api(`/api/friends/requests/${encodeURIComponent(requestId)}/respond`, {
      method: "POST",
      body: { response },
    });
    await refreshSocial();
    openFriendsDialog();
  }

  async function removeFriend(profileId) {
    await app.api(`/api/friends/${encodeURIComponent(profileId)}`, { method: "DELETE" });
    await refreshSocial();
    openFriendsDialog();
  }

  function notificationRows() {
    const notifications = app.state.account.notifications || [];
    if (!notifications.length) return `<div class="profile-empty">Nenhuma notificação.</div>`;
    return notifications.map((item) => `
      <div class="profile-history-row ${item.readAt ? "" : "unread"}">
        <div><strong>${app.esc(item.title)}</strong><small>${app.esc(item.body || "")}</small></div>
        ${item.readAt ? "<span>lida</span>" : `<button type="button" class="btn" data-notification-read="${app.esc(item.id)}">Marcar lida</button>`}
      </div>`).join("");
  }

  async function openNotificationsDialog() {
    if (!app.state.account.profile) {
      app.openDialog("Notificações", `<p>Entre com Google para receber notificações persistentes.</p>`);
      return;
    }
    await refreshSocial();
    app.openDialog("Notificações", `
      <div class="profile-shell">
        ${notificationRows()}
        <div class="match-config-actions">
          <button id="notifications-read-all" type="button" class="btn btn-primary">Marcar todas como lidas</button>
        </div>
      </div>`);
    app.$("#notifications-read-all")?.addEventListener("click", async () => {
      await app.api("/api/notifications/read-all", { method: "POST" });
      await refreshSocial();
      openNotificationsDialog();
    });
    document.querySelectorAll("[data-notification-read]").forEach((button) => {
      button.addEventListener("click", async () => {
        await app.api(`/api/notifications/${encodeURIComponent(button.dataset.notificationRead)}/read`, { method: "POST" });
        await refreshSocial();
        openNotificationsDialog();
      });
    });
  }

  Object.assign(app, {
    openFriendsDialog,
    openNotificationsDialog,
    refreshSocial,
    renderFriendsRail,
    updateNotificationBadge,
  });
})();

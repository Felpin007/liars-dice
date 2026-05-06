// App Supabase — login social, perfil, avatar e histórico persistente.
(() => {
  const app = window.LDAApp;

  function shortRating(profile) {
    if (!profile) return "Convidado · Casual";
    return `${profile.rating || 1000} rating · ${profile.gamesPlayed || 0} partidas`;
  }

  function profileName(profile) {
    return profile?.displayName || profile?.username || app.state.online.username || "Jogador";
  }

  function avatarMarkup(url, label = "Avatar") {
    if (url) {
      return `<img src="${app.esc(url)}" alt="${app.esc(label)}" />`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="3.5"></circle>
      <path d="M5 19c1.8-3.1 4.2-4.6 7-4.6S17.2 15.9 19 19"></path>
    </svg>`;
  }

  function stat(profile, key) {
    return profile && Number.isFinite(Number(profile[key])) ? Number(profile[key]) : 0;
  }

  function winRate(profile) {
    const played = stat(profile, "gamesPlayed");
    if (!played) return "—";
    return `${Math.round((stat(profile, "wins") / played) * 100)}%`;
  }

  function applyAccountUi(bundle = {}) {
    const profile = bundle.profile || app.state.account.profile;
    app.state.account.profile = profile || null;
    app.state.account.history = bundle.history || app.state.account.history || [];

    const name = profileName(profile);
    const rank = profile ? shortRating(profile) : (app.state.account.configured ? "Convidado · Entrar" : "Convidado · Casual");
    const avatarUrl = profile?.avatarUrl || "";

    const nameEl = app.$("#menu-profile-name");
    const rankEl = app.$("#menu-profile-rank");
    const avatarEl = app.$("#menu-profile-avatar");
    const quickProfile = app.$("#quickmatch-profile-label");
    const quickRating = app.$("#quickmatch-rating-label");
    const levelTitle = app.$("#level-profile-title");
    const levelRating = app.$("#level-rating-label");
    const levelProgress = app.$("#level-progress-copy");

    if (nameEl) nameEl.textContent = name;
    if (rankEl) rankEl.textContent = rank;
    if (avatarEl) avatarEl.innerHTML = avatarMarkup(avatarUrl, name);
    if (quickProfile) quickProfile.textContent = profile ? name : "Convidado · Casual";
    if (quickRating) quickRating.textContent = profile ? `${profile.rating || 1000} rating` : "Sem rating";
    if (levelTitle) levelTitle.textContent = profile ? name : "Convidado · Casual";
    if (levelRating) levelRating.textContent = profile ? `${profile.rating || 1000} rating` : "Sem rating";
    if (levelProgress) {
      levelProgress.textContent = profile
        ? `${profile.wins || 0} vitorias · ${profile.losses || 0} derrotas · melhor sequencia ${profile.bestStreak || 0}`
        : "Entre com Google para ativar perfil, rating e historico.";
    }

    const stats = [
      ["#stat-wins", profile ? profile.wins : null],
      ["#stat-games", profile ? profile.gamesPlayed : null],
      ["#stat-streak", profile ? profile.currentStreak : null],
      ["#stat-winrate", profile ? winRate(profile) : null],
    ];
    for (const [selector, value] of stats) {
      const el = app.$(selector);
      if (el) el.textContent = value == null ? "—" : String(value);
    }

    renderActivity();
  }

  function renderActivity() {
    const list = app.$("#activity-list");
    if (!list) return;
    const history = app.state.account.history || [];
    if (!history.length) {
      list.innerHTML = `<div class="rooms-empty">A atividade aparece aqui depois que partidas forem persistidas.</div>`;
      return;
    }
    list.innerHTML = history.slice(0, 5).map((item) => {
      const match = item.match || {};
      const delta = Number(item.ratingAfter || 0) - Number(item.ratingBefore || 0);
      const result = item.result === "win" ? "Vitoria" : item.result === "loss" ? "Derrota" : "Empate";
      const deltaText = item.ratingAfter == null ? "" : `${delta >= 0 ? "+" : ""}${delta}`;
      return `<div class="activity-row">
        <div class="activity-main">
          <span class="activity-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#icon-match"></use></svg></span>
          <div>
            <strong>${result} · ${app.esc(match.label || "Partida")}</strong>
            <small>${app.esc(match.mode_key || "")} · ${match.round_count || 0} rounds</small>
          </div>
        </div>
        <span>${app.esc(deltaText)}</span>
      </div>`;
    }).join("");
  }

  async function initSupabase() {
    try {
      const response = await fetch("/api/config", { credentials: "same-origin" });
      const config = await response.json();
      if (!config.supabase || !window.supabase?.createClient) {
        app.state.account.configured = false;
        applyAccountUi();
        return;
      }
      app.state.account.configured = true;
      app.state.account.avatarBucket = config.supabase.avatarBucket || "avatars";
      app.state.account.client = window.supabase.createClient(config.supabase.url, config.supabase.anonKey);
      const { data } = await app.state.account.client.auth.getSession();
      app.state.account.session = data.session || null;
      app.state.account.user = data.session?.user || null;
      app.state.account.client.auth.onAuthStateChange((event, session) => {
        app.state.account.session = session || null;
        app.state.account.user = session?.user || null;
        if (event === "INITIAL_SESSION") return;
        window.setTimeout(() => app.bootstrapOnline?.(), 0);
      });
    } catch (error) {
      console.warn("Supabase indisponivel:", error);
      app.state.account.configured = false;
    }
  }

  async function accessToken() {
    const session = app.state.account.session;
    if (session?.access_token) return session.access_token;
    const client = app.state.account.client;
    if (!client) return "";
    const { data } = await client.auth.getSession();
    app.state.account.session = data.session || null;
    app.state.account.user = data.session?.user || null;
    return data.session?.access_token || "";
  }

  async function signInWithGoogle() {
    const client = app.state.account.client;
    if (!client) {
      app.openDialog("Login indisponivel", "<p>Configure o Supabase para habilitar login com Google.</p>");
      return;
    }
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) app.openDialog("Login falhou", `<p>${app.esc(error.message)}</p>`);
  }

  async function signOut() {
    if (app.state.account.client) {
      await app.state.account.client.auth.signOut();
    }
    app.state.account.session = null;
    app.state.account.user = null;
    app.state.account.profile = null;
    app.state.account.history = [];
    applyAccountUi();
    await app.bootstrapOnline?.();
  }

  async function refreshAccount() {
    if (!app.state.account.configured || !app.state.account.user) {
      applyAccountUi();
      return null;
    }
    const bundle = await app.api("/api/me");
    applyAccountUi(bundle);
    return bundle;
  }

  async function saveProfileFromDialog() {
    const root = app.$("#dlg-content");
    const username = root.querySelector("#profile-username")?.value || "";
    const displayName = root.querySelector("#profile-display-name")?.value || "";
    const bio = root.querySelector("#profile-bio")?.value || "";
    const file = root.querySelector("#profile-avatar-file")?.files?.[0] || null;
    let avatarUrl = app.state.account.profile?.avatarUrl || "";

    if (file) {
      if (!file.type.startsWith("image/")) throw new Error("Escolha uma imagem valida.");
      if (file.size > 2 * 1024 * 1024) throw new Error("A imagem deve ter ate 2 MB.");
      const userId = app.state.account.user.id;
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^\w]/g, "");
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error } = await app.state.account.client.storage
        .from(app.state.account.avatarBucket)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = app.state.account.client.storage
        .from(app.state.account.avatarBucket)
        .getPublicUrl(path);
      avatarUrl = data.publicUrl;
    }

    const payload = await app.api("/api/me", {
      method: "PATCH",
      body: { username, displayName, bio, avatarUrl },
    });
    await refreshAccount();
    openProfileDialog(payload.profile);
  }

  function historyHtml() {
    const history = app.state.account.history || [];
    if (!history.length) return `<div class="profile-empty">Nenhuma partida persistida ainda.</div>`;
    return history.map((item) => {
      const match = item.match || {};
      const delta = Number(item.ratingAfter || 0) - Number(item.ratingBefore || 0);
      const result = item.result === "win" ? "Vitoria" : item.result === "loss" ? "Derrota" : "Empate";
      return `<div class="profile-history-row">
        <div>
          <strong>${result} · ${app.esc(match.label || "Partida")}</strong>
          <small>${app.esc(match.mode_key || "")} · ${match.round_count || 0} rounds · ${match.player_count || 0} jogadores</small>
        </div>
        <span>${item.ratingAfter == null ? "—" : `${item.ratingAfter} (${delta >= 0 ? "+" : ""}${delta})`}</span>
      </div>`;
    }).join("");
  }

  function openProfileDialog(profile = app.state.account.profile) {
    if (!app.state.account.configured) {
      app.openDialog("Perfil", `<p>Configure o Supabase para habilitar login, perfil, avatar, rating e historico.</p>`);
      return;
    }

    if (!app.state.account.user) {
      app.openDialog("Entrar", `
        <div class="profile-shell">
          <div class="profile-hero">
            <div class="profile-avatar large">${avatarMarkup("")}</div>
            <div>
              <strong>Entre para salvar seu progresso.</strong>
              <p>Login com Google ativa perfil, rating, avatar e historico de partidas.</p>
            </div>
          </div>
          <button id="profile-google-login" type="button" class="btn btn-primary btn-big">Entrar com Google</button>
        </div>`);
      app.$("#profile-google-login")?.addEventListener("click", signInWithGoogle);
      return;
    }

    const p = profile || {};
    app.openDialog("Perfil", `
      <div class="profile-shell">
        <div class="profile-hero">
          <div class="profile-avatar large">${avatarMarkup(p.avatarUrl, profileName(p))}</div>
          <div>
            <strong>${app.esc(profileName(p))}</strong>
            <p>${p.rating || 1000} rating · ${p.gamesPlayed || 0} partidas · ${p.wins || 0} vitorias</p>
          </div>
        </div>

        <div class="profile-form">
          <label>Usuario
            <input id="profile-username" value="${app.esc(p.username || "")}" maxlength="32" />
          </label>
          <label>Nome publico
            <input id="profile-display-name" value="${app.esc(p.displayName || "")}" maxlength="60" />
          </label>
          <label>Bio
            <textarea id="profile-bio" maxlength="240">${app.esc(p.bio || "")}</textarea>
          </label>
          <label>Imagem de perfil
            <input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
          </label>
        </div>

        <div class="profile-stats">
          <span><b>${p.rating || 1000}</b><small>Rating</small></span>
          <span><b>${p.gamesPlayed || 0}</b><small>Partidas</small></span>
          <span><b>${p.wins || 0}</b><small>Vitorias</small></span>
          <span><b>${winRate(p)}</b><small>Win rate</small></span>
        </div>

        <div class="profile-history">
          <h3>Historico recente</h3>
          ${historyHtml()}
        </div>

        <div class="match-config-actions">
          <button id="profile-save" type="button" class="btn btn-primary">Salvar perfil</button>
          <button id="profile-logout" type="button" class="btn">Sair</button>
        </div>
      </div>`);

    app.$("#profile-save")?.addEventListener("click", async () => {
      try {
        await saveProfileFromDialog();
      } catch (error) {
        app.openDialog("Nao foi possivel salvar", `<p>${app.esc(error.message)}</p>`);
      }
    });
    app.$("#profile-logout")?.addEventListener("click", signOut);
  }

  Object.assign(app, {
    initSupabase,
    openProfileDialog,
    refreshAccount,
  });

  app.supabaseAuth = {
    accessToken,
    signInWithGoogle,
    signOut,
    refreshAccount,
  };
})();

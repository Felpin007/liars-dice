// App Supabase — login social, perfil, avatar e histórico persistente.
(() => {
  const app = window.LDAApp;

  function shortRating(profile) {
    if (!profile) return "Convidado · Casual";
    return `${profile.rating || 1500} rating · nível ${profile.level || 1}`;
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

  function computeLevelProgress(profile) {
    const xp = Number(profile?.xp || 0);
    const level = Math.max(1, Number(profile?.level || Math.floor(Math.sqrt(xp / 100)) + 1));
    const start = Math.pow(level - 1, 2) * 100;
    const next = Math.pow(level, 2) * 100;
    return {
      xp,
      level,
      needed: next,
      percent: next > start ? Math.round(((xp - start) / (next - start)) * 100) : 0,
    };
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
    const levelFill = document.querySelector(".level-progress-fill");

    if (nameEl) nameEl.textContent = name;
    if (rankEl) rankEl.textContent = rank;
    if (avatarEl) avatarEl.innerHTML = avatarMarkup(avatarUrl, name);
    if (quickProfile) quickProfile.textContent = profile ? name : "Convidado · Casual";
    if (quickRating) quickRating.textContent = profile ? `${profile.rating || 1500} rating` : "Sem rating";
    const progress = computeLevelProgress(profile);
    if (levelTitle) levelTitle.textContent = profile ? `Nível ${progress.level} · ${name}` : "Convidado · Casual";
    if (levelRating) levelRating.textContent = profile ? `${profile.rating || 1500} rating · RD ${Math.round(profile.ratingDeviation || 350)}` : "Sem rating";
    if (levelFill) levelFill.style.width = profile ? `${progress.percent}%` : "0%";
    if (levelProgress) {
      levelProgress.textContent = profile
        ? `${progress.xp} XP · ${progress.percent}% ate o nivel ${progress.level + 1} · melhor sequencia ${profile.bestStreak || 0}`
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
    app.renderFriendsRail?.();
    app.updateNotificationBadge?.();
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
      try {
        await app.state.account.client.auth.signOut();
      } catch {}
    }
    app.state.account.session = null;
    app.state.account.user = null;
    app.state.account.profile = null;
    app.state.account.history = [];
    app.state.account.friends = [];
    app.state.account.friendRequests = [];
    app.state.account.notifications = [];
    app.state.account.unreadNotifications = 0;
    applyAccountUi();
    await app.bootstrapOnline?.();
  }

  function friendlyAccountError(error) {
    const message = String(error?.message || error || "");
    const lower = message.toLowerCase();
    if (lower.includes("bucket not found")) return "O bucket de avatars nao existe no Supabase. Rode o schema.sql e tente de novo.";
    if (lower.includes("duplicate") || lower.includes("already exists")) return "Esse usuario ja esta em uso. Escolha outro nome.";
    return {
      username_taken: "Esse usuario ja esta em uso. Escolha outro nome.",
      avatar_bucket_missing: "O bucket de avatars nao existe no Supabase. Rode o schema.sql e tente de novo.",
      supabase_schema_missing: "As tabelas do Supabase ainda nao foram criadas. Rode o schema.sql.",
      supabase_permission_denied: "A chave service_role nao tem permissao para salvar. Confira as variaveis do Supabase.",
      auth_required: "Sua sessao expirou. Entre novamente.",
      csrf_required: "A sessao local expirou. Recarregue a pagina e tente novamente.",
      login_required: "Entre com Google para alterar o perfil.",
    }[message] || message || "Nao foi possivel concluir a acao.";
  }

  async function refreshAccount() {
    if (!app.state.account.configured || !app.state.account.user) {
      applyAccountUi();
      return null;
    }
    const bundle = await app.api("/api/me");
    applyAccountUi(bundle);
    await app.refreshSocial?.();
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

  async function deleteAccountFromDialog() {
    const confirmText = app.$("#profile-delete-confirm")?.value || "";
    const button = app.$("#profile-delete-confirm-btn");
    if (confirmText !== "EXCLUIR") {
      throw new Error("Digite EXCLUIR para confirmar.");
    }
    if (button) button.disabled = true;
    await app.api("/api/me", { method: "DELETE" });
    await signOut();
    app.openDialog("Conta excluida", "<p>Sua conta e seus dados pessoais foram removidos deste projeto.</p>");
  }

  function openDeleteAccountDialog() {
    app.openDialog("Excluir conta", `
      <div class="profile-delete-warning">
        <strong>Essa acao e definitiva.</strong>
        <p>Seu login, perfil, avatar, estatisticas pessoais e vinculos com historico de partidas serao removidos. Dados de outros jogadores em partidas compartilhadas serao preservados.</p>
        <label>Digite <b>EXCLUIR</b> para confirmar
          <input id="profile-delete-confirm" autocomplete="off" />
        </label>
        <div class="match-config-actions">
          <button id="profile-delete-confirm-btn" type="button" class="btn btn-danger">Excluir conta</button>
          <button id="profile-delete-cancel" type="button" class="btn">Cancelar</button>
        </div>
      </div>`);
    app.$("#profile-delete-cancel")?.addEventListener("click", () => openProfileDialog());
    app.$("#profile-delete-confirm-btn")?.addEventListener("click", async () => {
      try {
        await deleteAccountFromDialog();
      } catch (error) {
        app.openDialog("Nao foi possivel excluir", `<p>${app.esc(friendlyAccountError(error))}</p>`);
      }
    });
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
            <p>${p.rating || 1500} rating · nível ${p.level || 1} · ${p.xp || 0} XP</p>
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
          <span><b>${p.rating || 1500}</b><small>Rating</small></span>
          <span><b>${p.level || 1}</b><small>Nível</small></span>
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
          <button id="profile-delete" type="button" class="btn btn-danger">Excluir conta</button>
        </div>
      </div>`);

    app.$("#profile-save")?.addEventListener("click", async () => {
      try {
        await saveProfileFromDialog();
      } catch (error) {
        app.openDialog("Nao foi possivel salvar", `<p>${app.esc(friendlyAccountError(error))}</p>`);
      }
    });
    app.$("#profile-logout")?.addEventListener("click", signOut);
    app.$("#profile-delete")?.addEventListener("click", openDeleteAccountDialog);
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
    deleteAccountFromDialog,
    refreshAccount,
  };
})();

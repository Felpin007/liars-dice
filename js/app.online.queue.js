// App online queue — pareamento rapido e tela de busca
(() => {
  const app = window.LDAApp;
  let searchTicker = null;

  function selectedQuickmatchPreset() {
    const button = document.querySelector(".quickmatch-mode.active");
    return {
      label: button?.dataset.queueLabel || "Rápida",
      modeKey: button?.dataset.modeKey || "quick-5-0",
      minutes: Number(button?.dataset.minutes || 5),
      increment: Number(button?.dataset.increment || 0),
      matchType: app.$("#quickmatch-ranked")?.checked ? "ranqueada" : "amistosa",
    };
  }

  function showSearchView(preset, statusText = "Aguardando jogadores compatíveis…") {
    app.$("#menu-home")?.classList.add("hidden");
    app.$("#menu-play-hub")?.classList.add("hidden");
    app.$("#menu-matchmaking")?.classList.remove("hidden");
    app.state.online.searchStartedAt = Date.now();
    const titleEl = app.$("#menu-search-title");
    const subtitleEl = app.$("#menu-search-subtitle");
    if (titleEl) titleEl.textContent = `Buscando ${preset.label}`;
    if (subtitleEl) subtitleEl.textContent = `Fila ${preset.minutes}+${preset.increment} ${preset.matchType === "ranqueada" ? "ranqueada" : "casual"}.`;
    app.$("#menu-search-preset").textContent = `${preset.label} · ${preset.minutes}+${preset.increment} · ${preset.matchType === "ranqueada" ? "Ranqueada" : "Casual"}`;
    setSearchStatus(statusText);
    refreshSearchElapsed();
    if (searchTicker) clearInterval(searchTicker);
    searchTicker = setInterval(refreshSearchElapsed, 500);
  }

  function hideSearchView() {
    app.$("#menu-home")?.classList.remove("hidden");
    app.$("#menu-play-hub")?.classList.remove("hidden");
    app.$("#menu-matchmaking")?.classList.add("hidden");
    app.state.online.searchStartedAt = 0;
    if (searchTicker) {
      clearInterval(searchTicker);
      searchTicker = null;
    }
  }

  function refreshSearchElapsed() {
    const startedAt = app.state.online.searchStartedAt;
    const elapsedEl = app.$("#menu-search-elapsed");
    if (!elapsedEl) return;
    if (!startedAt) {
      elapsedEl.textContent = "00:00";
      return;
    }
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    elapsedEl.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function setSearchStatus(statusText) {
    const statusEl = app.$("#menu-search-status");
    if (statusEl) statusEl.textContent = statusText;
  }

  async function startMatchmaking() {
    const preset = selectedQuickmatchPreset();
    if (!app.state.online.backendAvailable) {
      await app.startGame({
        minutes: preset.minutes,
        incrementSeconds: preset.increment,
      });
      return;
    }
    showSearchView(preset, "Entrando na fila do pareamento rápido…");
    try {
      const payload = await app.api("/api/queue/join", {
        method: "POST",
        body: {
          ...preset,
        },
      });
      app.onlineCommon.setStats(payload.stats);
      if (payload.match) {
        app.state.online.currentQueue = null;
        setSearchStatus(payload.match.autoFilledWithBots ? "Mesa fechada com bots para a partida." : "Pareamento encontrado.");
        window.setTimeout(() => {
          hideSearchView();
          app.onlineMatch.launchAuthoritativeMatch(payload.match);
        }, 500);
        return;
      }
      app.state.online.currentQueue = payload.queue;
      showSearchView(payload.queue || preset, "Aguardando jogadores compatíveis…");
    } catch (error) {
      hideSearchView();
      app.openDialog("Nao foi possivel buscar partida", `<p>${app.esc(app.errorMsg(error.message))}</p>`);
    }
  }

  async function cancelMatchmaking() {
    if (!app.state.online.csrfToken) return;
    await app.api("/api/queue/leave", {
      method: "POST",
    });
    app.state.online.currentQueue = null;
    hideSearchView();
  }

  app.onlineQueue = {
    showSearchView,
    hideSearchView,
    setSearchStatus,
  };

  Object.assign(app, {
    startMatchmaking,
    cancelMatchmaking,
  });
})();

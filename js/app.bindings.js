// App bindings — integra UI, eventos do DOM e a orquestracao da partida
(() => {
  const app = window.LDAApp;

  function bindUi() {
    UI.init({
      getState: () => app.getMatch(),
      actionHandler: async (action) => {
        const match = app.getMatch();
        if (!match || app.state.busy) return;
        if (match.phase !== "bidding") return;
        if (match.turnSeat !== 0) return;
        if (app.state.online.authoritative && app.state.online.activeMatchId) {
          try {
            await app.sendOnlineAction(action);
          } catch (error) {
            UI.showRevealBanner(`Jogada recusada pelo servidor: ${error.message}`, "bad");
          }
          return;
        }
        const applied = await app.performAction(0, action, app.state.sessionId);
        if (applied && app.state.online.activeMatchId) {
          try {
            await app.sendOnlineAction(action);
          } catch (error) {
            UI.showRevealBanner(`Jogada local feita, mas falhou ao sincronizar: ${error.message}`, "bad");
          }
        }
      },
    });

    app.ensureLiveTicker();

    const menuTabButtons = Array.from(document.querySelectorAll("[data-menu-tab]"));
    const menuTabPanes = Array.from(document.querySelectorAll("[data-menu-pane]"));
    const setMenuPlayTab = (tabName) => {
      menuTabButtons.forEach((button) => {
        const isActive = button.dataset.menuTab === tabName;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      });

      menuTabPanes.forEach((pane) => {
        const isActive = pane.dataset.menuPane === tabName;
        pane.classList.toggle("active", isActive);
        pane.hidden = !isActive;
      });
    };

    menuTabButtons.forEach((button) => {
      button.addEventListener("click", () => setMenuPlayTab(button.dataset.menuTab));
    });

    document.querySelectorAll('.menu-side-link[href="#menu-quick"], .menu-side-link[href="#menu-rooms"]').forEach((link) => {
      link.addEventListener("click", () => {
        setMenuPlayTab(link.getAttribute("href") === "#menu-rooms" ? "rooms" : "quick");
      });
    });

    document.querySelectorAll(".quickmatch-mode").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".quickmatch-mode").forEach((other) => other.classList.remove("active"));
        button.classList.add("active");
      });
    });

    document.querySelectorAll("[data-collapse-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const section = document.getElementById(button.dataset.collapseTarget);
        if (!section) return;
        const nextCollapsed = !section.classList.contains("collapsed");
        section.classList.toggle("collapsed", nextCollapsed);
        button.setAttribute("aria-expanded", String(!nextCollapsed));
      });
    });

    document.querySelectorAll("[data-mobile-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-mobile-nav]").forEach((other) => other.classList.remove("active"));
        button.classList.add("active");

        const layout = app.$("#game-layout");
        if (!layout) return;

        if (button.dataset.mobileNav === "mesa") {
          app.$("#players-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }

        if (button.dataset.mobileNav === "estatisticas") {
          app.$("#game-log-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }

        if (button.dataset.mobileNav === "configuracoes") {
          app.$("#btn-rules")?.click();
        }
      });
    });

    app.$("#hero-create-room")?.addEventListener("click", () => app.openFeatureModal("room"));
    app.$("#hero-challenge-friend")?.addEventListener("click", () => app.openFeatureModal("friend"));
    app.$("#hero-play-bot")?.addEventListener("click", () => app.openFeatureModal("bot"));
    app.$("#hero-tutorial")?.addEventListener("click", () => app.openTutorial());

    app.$("#btn-play").addEventListener("click", () => app.startMatchmaking());
    app.$("#menu-search-cancel")?.addEventListener("click", () => app.cancelMatchmaking());
    app.$("#btn-menu").addEventListener("click", () => app.showMenu());
    app.$("#btn-new").addEventListener("click", () => app.startGame(app.state.lastStartOptions || {}));
    app.$("#btn-rules").addEventListener("click", () => app.openDialog("Regras — Modo Clássico", app.rulesHtml()));
    const menuRulesButton = app.$("#btn-menu-rules");
    if (menuRulesButton) {
      menuRulesButton.addEventListener("click", () => app.openDialog("Regras — Modo Clássico", app.rulesHtml()));
    }
    app.$("#btn-fair").addEventListener("click", async () => {
      const match = app.getMatch();
      if (!match || !match.commitment) {
        app.openDialog("Fair-play", "<p>Inicie uma partida para ver o compromisso do round atual.</p>");
        return;
      }

      const commitment = match.commitment;
      if (!commitment.seedHex) {
        app.openDialog("Fair-play — compromisso do round",
          `<p>O servidor ja publicou o compromisso deste round, mas a seed so sera revelada depois que o round for resolvido.</p>
          <ul>
            <li><b>Hash publico (commit):</b><br><code>sha256:${commitment.hashHex}</code></li>
            <li><b>Match ID:</b> <code>${match.matchId}</code> · <b>Round:</b> ${match.round}</li>
          </ul>`);
        return;
      }
      const valid = await RNG.verifyCommitment(commitment.seedHex, commitment.hashHex);
      app.openDialog("Fair-play — verificação do round",
        `<p>Cada round usa <b>commit-reveal</b>: antes da rolagem publicamos um hash; depois revelamos a seed e qualquer um pode verificar.</p>
        <ul>
          <li><b>Hash público (commit):</b><br><code>sha256:${commitment.hashHex}</code></li>
          <li><b>Seed do servidor (revelada):</b><br><code>${commitment.seedHex}</code></li>
          <li><b>Seeds dos clientes:</b><br><code>${commitment.clientSeeds.join(", ")}</code></li>
          <li><b>Match ID:</b> <code>${match.matchId}</code> · <b>Round:</b> ${match.round}</li>
          <li><b>Physics seed (animação):</b> <code>0x${commitment.physicsSeed.toString(16)}</code></li>
          <li><b>Verificação sha256(seed) == hash:</b> ${valid ? '<span style="color:#89b482">✔ válido</span>' : '<span style="color:#ea6962">✘ inválido</span>'}</li>
        </ul>
        <p>A derivação dos dados é <code>1 + (HMAC-SHA256(finalSeed, "dice|playerId|dieIndex") mod 6)</code>, aplicando rejection sampling para uniformidade.</p>`);
    });

    app.$("#btn-ldn").addEventListener("click", () => {
      const match = app.getMatch();
      if (!match) return;
      const text = LDN.render(match, []);
      app.openDialog("Exportar LDN", `<p>Liar's Dice Notation — formato texto para replays e análise.</p><pre>${app.esc(text)}</pre>`);
    });

    app.$("#verify-link").addEventListener("click", (event) => {
      event.preventDefault();
      app.$("#btn-fair").click();
    });

    app.$("#dlg-close").addEventListener("click", () => app.$("#dlg").close());
    window.addEventListener("resize", () => UI.renderAll());
  }

  Object.assign(app, { bindUi });
})();

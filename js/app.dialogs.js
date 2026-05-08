// App dialogs — modais e fluxos da home
(() => {
  const app = window.LDAApp;

  const GAME_TYPE_OPTIONS = [
    { value: "classic-4", label: "Clássico · 4 jogadores" },
    { value: "duel-2", label: "Duelo rápido · 2 jogadores" },
    { value: "arena-6", label: "Arena aberta · 6 jogadores" },
    { value: "private-4", label: "Sala privada · 4 jogadores" },
  ];

  const TIME_PRESETS = [
    { minutes: 1, increment: 0 },
    { minutes: 2, increment: 1 },
    { minutes: 3, increment: 0 },
    { minutes: 3, increment: 2 },
    { minutes: 5, increment: 0 },
    { minutes: 5, increment: 3 },
    { minutes: 10, increment: 0 },
    { minutes: 10, increment: 5 },
    { minutes: 15, increment: 10 },
    { minutes: 30, increment: 0 },
    { minutes: 30, increment: 20 },
  ];

  const BOT_LEVEL_DESCRIPTIONS = {
    1: "aleatório válido, com muitos erros",
    2: "heurística fraca com erro intencional",
    3: "probabilidade básica e pouco blefe",
    4: "probabilidade segura e menos chamadas ruins",
    5: "blefe oportunista e Calza simples",
    6: "blefe controlado, Calza melhor e menos erro tático",
    7: "adapta decisões ao histórico recente de lances",
    8: "maior profundidade, thresholds finos e menor erro tático",
  };

  function openDialog(title, html) {
    app.$("#dlg-title").textContent = title;
    app.$("#dlg-content").innerHTML = html;
    app.$("#dlg").showModal();
  }

  function startupErrorHtml(err) {
    const message = err && err.message ? err.message : String(err);
    const hint = (!window.isSecureContext || typeof crypto === "undefined" || !crypto.subtle)
      ? "<p>Se você abriu o projeto por <code>file://</code>, rode o backend local com <code>npm start</code> ou <code>node server/server.js</code> e abra <code>http://localhost:8080</code>.</p>"
      : "";
    return `<p>O jogo nao conseguiu iniciar nesta aba.</p>${hint}<pre>${app.esc(message)}</pre>`;
  }

  function rulesHtml() {
    return `
      <p><b>Objetivo:</b> ser o último jogador com dados.</p>
      <p><b>Setup:</b> cada jogador começa com 5 dados (configurável) e rola em segredo.</p>
      <p><b>Lance (bid):</b> par <code>(q, v)</code> significando "existem pelo menos <code>q</code> dados com valor <code>v</code> no pool".</p>
      <p><b>Ases (1) são coringas</b> e contam como qualquer valor — exceto quando o próprio lance é sobre ases.</p>
      <p><b>Hierarquia de aumento:</b></p>
      <ul>
        <li>Mesmo valor: <code>q</code> aumenta.</li>
        <li>Mesmo <code>q</code>: a face precisa aumentar.</li>
        <li>Se a face diminuir, <code>q</code> precisa aumentar.</li>
      </ul>
      <p><b>Dudo:</b> desafia o último lance. Revelam-se todos os dados. Se o lance era verdadeiro, quem desafiou perde 1 dado. Se era falso, quem fez o lance perde 1 dado.</p>
      <p><b>Calza</b> (opcional): aposta que a quantidade é <i>exatamente</i> <code>q</code>. Acerto ganha 1 dado; erro perde 1.</p>
      <p><b>Atalhos:</b> <kbd>1–6</kbd> seleciona valor · <kbd>↑/↓</kbd> quantidade · <kbd>Enter</kbd> ou <kbd>Espaço</kbd> confirma · <kbd>D</kbd> = Dudo.</p>
    `;
  }

  function openFeatureModal(kind) {
    openDialog(featureTitle(kind), renderFeatureConfig(kind));
    bindFeatureModal(kind);
  }

  function featureTitle(kind) {
    return {
      room: "Criar Sala de Espera",
      friend: "Desafiar Um Amigo",
      bot: "Jogar Com Computador",
    }[kind] || "Configurar Partida";
  }

  function featurePrimaryLabel(kind) {
    return {
      room: "Criar sala de espera",
      friend: "Desafiar amigo",
      bot: "Jogar com computador",
    }[kind] || "Continuar";
  }

  function defaultFeatureConfig(kind) {
    return {
      gameType: kind === "bot" ? "duel-2" : "classic-4",
      minutes: kind === "bot" ? 3 : 10,
      increment: kind === "bot" ? 0 : 5,
      matchType: "amistosa",
      level: 3,
    };
  }

  function renderFeatureConfig(kind, config = defaultFeatureConfig(kind)) {
    const gameTypeOptions = GAME_TYPE_OPTIONS.map((option) => `
      <option value="${option.value}"${option.value === config.gameType ? " selected" : ""}>${app.esc(option.label)}</option>
    `).join("");

    return `
      <div class="match-config-modal" data-feature-kind="${kind}">
        <div class="match-config-grid">
          <label class="match-field">
            <span class="match-label">Tipo de jogo</span>
            <select id="match-game-type" class="match-select">${gameTypeOptions}</select>
          </label>

          <div class="match-range-row">
            <label class="match-field match-range-field">
              <span class="match-range-head">
                <span class="match-label">Minutos por jogador</span>
                <strong id="match-minutes-value" class="match-range-pill">${config.minutes}</strong>
              </span>
              <input id="match-minutes" class="match-range" type="range" min="1" max="30" step="1" value="${config.minutes}" />
            </label>

            <label class="match-field match-range-field">
              <span class="match-range-head">
                <span class="match-label">Acréscimo em segundos</span>
                <strong id="match-increment-value" class="match-range-pill">${config.increment}</strong>
              </span>
              <input id="match-increment" class="match-range" type="range" min="0" max="30" step="1" value="${config.increment}" />
            </label>
          </div>

          <div class="match-time-presets" data-time-presets>
            ${renderTimePresetButtons(config)}
          </div>

          ${kind !== "bot" ? `
            <div class="match-field">
              <span class="match-label">Tipo de partida</span>
              <div class="match-segmented" data-match-segment="type">
                <button type="button" class="match-segment-btn${config.matchType === "amistosa" ? " active" : ""}" data-value="amistosa">Amistosa</button>
                <button type="button" class="match-segment-btn${config.matchType === "ranqueada" ? " active" : ""}" data-value="ranqueada">Ranqueada</button>
              </div>
            </div>
          ` : ""}

          ${kind === "bot" ? renderBotLevelPicker(config.level) : ""}
        </div>

        <div class="match-config-actions">
          <button id="match-config-submit" type="button" class="btn btn-primary btn-big">${featurePrimaryLabel(kind)}</button>
        </div>
      </div>
    `;
  }

  function renderTimePresetButtons(config) {
    return TIME_PRESETS.map((preset) => {
      const isActive = preset.minutes === config.minutes && preset.increment === config.increment;
      return `
        <button
          type="button"
          class="match-time-preset${isActive ? " active" : ""}"
          data-minutes="${preset.minutes}"
          data-increment="${preset.increment}"
        >${preset.minutes}+${preset.increment}</button>
      `;
    }).join("");
  }

  function renderBotLevelPicker(activeLevel) {
    const levelButtons = Array.from({ length: 8 }, (_, index) => {
      const level = index + 1;
      const description = BOT_LEVEL_DESCRIPTIONS[level] || "";
      return `
        <button
          type="button"
          class="match-level-btn${level === activeLevel ? " active" : ""}"
          data-level="${level}"
          title="${app.esc(description)}"
          aria-label="Nível ${level}: ${app.esc(description)}"
        >${level}</button>
      `;
    }).join("");

    return `
      <div class="match-field">
        <span class="match-label">Nível do computador</span>
        <div class="match-level-picker">${levelButtons}</div>
        <small class="match-help">1 aleatório · 4 seguro · 6 blefe controlado · 8 tático.</small>
      </div>
    `;
  }

  function bindFeatureModal(kind) {
    const root = app.$("#dlg-content");
    if (!root) return;

    const minutesInput = root.querySelector("#match-minutes");
    const incrementInput = root.querySelector("#match-increment");
    const minutesValue = root.querySelector("#match-minutes-value");
    const incrementValue = root.querySelector("#match-increment-value");
    const submitButton = root.querySelector("#match-config-submit");
    const presetButtons = Array.from(root.querySelectorAll(".match-time-preset"));

    const updateRanges = () => {
      if (minutesInput && minutesValue) minutesValue.textContent = `${minutesInput.value}`;
      if (incrementInput && incrementValue) incrementValue.textContent = `${incrementInput.value}`;
      syncPresetButtons(presetButtons, Number(minutesInput?.value || 0), Number(incrementInput?.value || 0));
    };

    updateRanges();
    minutesInput?.addEventListener("input", updateRanges);
    incrementInput?.addEventListener("input", updateRanges);

    presetButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (minutesInput) minutesInput.value = button.dataset.minutes || minutesInput.value;
        if (incrementInput) incrementInput.value = button.dataset.increment || incrementInput.value;
        updateRanges();
      });
    });

    root.querySelectorAll('[data-match-segment="type"] .match-segment-btn').forEach((button) => {
      button.addEventListener("click", () => {
        root.querySelectorAll('[data-match-segment="type"] .match-segment-btn').forEach((other) => other.classList.remove("active"));
        button.classList.add("active");
      });
    });

    root.querySelectorAll(".match-level-btn").forEach((button) => {
      button.addEventListener("click", () => {
        root.querySelectorAll(".match-level-btn").forEach((other) => other.classList.remove("active"));
        button.classList.add("active");
      });
    });

    submitButton?.addEventListener("click", async () => {
      const config = collectFeatureConfig(root);
      if (kind === "bot") {
        launchBotMatch(config);
        return;
      }
      if (!app.state.online.backendAvailable) {
        app.openDialog("Backend offline", "<p>Inicie o servidor com <code>npm start</code> ou <code>node server/server.js</code> para criar salas reais, convites e matchmaking.</p>");
        return;
      }
      try {
        await app.createOnlineLobby(kind, config);
      } catch (error) {
        app.openDialog("Nao foi possivel criar a sala", `<p>${app.esc(app.errorMsg(error.message))}</p>`);
      }
    });
  }

  function collectFeatureConfig(root) {
    const activeMatchType = root.querySelector('[data-match-segment="type"] .match-segment-btn.active');
    const activeLevel = root.querySelector(".match-level-btn.active");
    return {
      gameType: root.querySelector("#match-game-type")?.value || "classic-4",
      minutes: Number(root.querySelector("#match-minutes")?.value || 5),
      increment: Number(root.querySelector("#match-increment")?.value || 0),
      matchType: activeMatchType?.dataset.value || "amistosa",
      level: Number(activeLevel?.dataset.level || 3),
    };
  }

  function launchBotMatch(config) {
    app.$("#cfg-bots").value = "1";
    app.$("#cfg-level").value = String(config.level);
    app.$("#dlg").close();
    app.startGame({
      numBots: 1,
      level: config.level,
      minutes: config.minutes,
      incrementSeconds: config.increment,
    });
  }

  function renderInviteState(kind, config) {
    const code = buildInviteCode();
    const link = `https://liarsdicearena.local/${code}`;
    app.$("#dlg-title").textContent = kind === "room" ? "Sala De Espera Criada" : "Desafio Pronto";
    app.$("#dlg-content").innerHTML = renderInviteHtml(kind, config, link);
    bindInviteState(kind, link);
  }

  function renderInviteHtml(kind, config, link) {
    const summary = renderConfigSummary(config);
    const title = kind === "room" ? "Sua sala já está pronta." : "Seu desafio já pode ser enviado.";
    const helper = kind === "room"
      ? "Compartilhe o link ou QR code abaixo para quem for entrar na sala."
      : "Envie o link ou QR code abaixo para o amigo aceitar o convite.";

    return `
      <div class="invite-result">
        <div class="invite-summary">
          <strong>${app.esc(title)}</strong>
          <p>${app.esc(helper)}</p>
          <div class="invite-summary-chips">${summary}</div>
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
            ${renderQrCode(link)}
            <small>Escaneie para abrir o convite.</small>
          </div>

          <div class="invite-user-card">
            <span class="match-label">Ou convide um usuário Liar's Dice</span>
            <div class="invite-user-row">
              <input id="invite-user-input" class="invite-user-input" type="text" placeholder="nome_do_usuario" />
              <button id="invite-user-button" type="button" class="btn btn-primary">${kind === "room" ? "Enviar convite" : "Convidar"}</button>
            </div>
            <p id="invite-user-feedback" class="invite-feedback">Você também pode compartilhar o link diretamente.</p>
          </div>
        </div>
      </div>
    `;
  }

  function renderConfigSummary(config) {
    const chips = [
      gameTypeLabel(config.gameType),
      `${config.minutes} min`,
      `+${config.increment}s`,
      config.matchType === "ranqueada" ? "Ranqueada" : "Amistosa",
    ];

    return chips.map((chip) => `<span class="invite-chip">${app.esc(chip)}</span>`).join("");
  }

  function bindInviteState(kind, link) {
    const root = app.$("#dlg-content");
    if (!root) return;

    const copyButton = root.querySelector("#invite-copy");
    const inviteInput = root.querySelector("#invite-link-input");
    const userInput = root.querySelector("#invite-user-input");
    const userButton = root.querySelector("#invite-user-button");
    const feedback = root.querySelector("#invite-user-feedback");

    copyButton?.addEventListener("click", async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(link);
        } else if (inviteInput) {
          inviteInput.select();
          document.execCommand("copy");
        }
        copyButton.textContent = "Link copiado";
      } catch {
        copyButton.textContent = "Copie manualmente";
      }
    });

    userButton?.addEventListener("click", () => {
      const username = userInput?.value.trim();
      if (!feedback) return;
      if (!username) {
        feedback.textContent = "Digite um nome de usuário para enviar o convite.";
        return;
      }
      feedback.textContent = kind === "room"
        ? `Convite da sala enviado para @${username}.`
        : `Desafio direto enviado para @${username}.`;
    });
  }

  function gameTypeLabel(value) {
    return GAME_TYPE_OPTIONS.find((option) => option.value === value)?.label || "Clássico";
  }

  function syncPresetButtons(buttons, minutes, increment) {
    buttons.forEach((button) => {
      const isActive = Number(button.dataset.minutes) === minutes && Number(button.dataset.increment) === increment;
      button.classList.toggle("active", isActive);
    });
  }

  function buildInviteCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = new Uint8Array(8);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }

  function renderQrCode(text) {
    return `<div class="invite-qr-live">
      <img src="/api/qr?data=${encodeURIComponent(text)}" alt="QR code do convite" />
    </div>`;
  }

  Object.assign(app, {
    openDialog,
    startupErrorHtml,
    rulesHtml,
    openFeatureModal,
  });
})();

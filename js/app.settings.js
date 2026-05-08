// App settings/audio — preferencias locais e efeitos sinteticos
(() => {
  const app = window.LDAApp;
  const STORAGE_KEY = "lda.settings";
  const defaults = {
    volume: 0.45,
    muted: false,
    start3d: false,
    reduceMotion: false,
    compactUi: false,
  };
  let audioContext = null;

  function loadSettings() {
    try {
      return { ...defaults, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")) };
    } catch {
      return { ...defaults };
    }
  }

  function saveSettings(next = app.state.settings) {
    app.state.settings = { ...defaults, ...next };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state.settings));
    applySettings();
  }

  function applySettings() {
    const settings = app.state.settings || defaults;
    document.body.classList.toggle("reduce-motion", Boolean(settings.reduceMotion));
    document.body.classList.toggle("compact-ui", Boolean(settings.compactUi));
    const cfg3d = app.$("#cfg-3d");
    if (cfg3d) cfg3d.checked = Boolean(settings.start3d);
  }

  function ensureAudio() {
    if (audioContext) return audioContext;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
    return audioContext;
  }

  function playTone(freq, duration, type = "sine", gain = 0.08) {
    const settings = app.state.settings || defaults;
    if (settings.muted || Number(settings.volume) <= 0) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain * Number(settings.volume || defaults.volume);
    osc.connect(amp);
    amp.connect(ctx.destination);
    const now = ctx.currentTime;
    amp.gain.setValueAtTime(amp.gain.value, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration);
  }

  function playSound(kind) {
    const map = {
      bid: [[520, 0.08, "triangle"], [720, 0.07, "triangle"]],
      dudo: [[180, 0.16, "sawtooth"]],
      reveal: [[260, 0.08, "square"], [390, 0.12, "triangle"]],
      win: [[520, 0.08, "sine"], [660, 0.08, "sine"], [880, 0.12, "sine"]],
      loss: [[260, 0.12, "triangle"], [180, 0.16, "triangle"]],
      notification: [[760, 0.06, "sine"], [980, 0.08, "sine"]],
    }[kind] || [[440, 0.08, "sine"]];
    map.forEach(([freq, duration, type], index) => {
      window.setTimeout(() => playTone(freq, duration, type), index * 80);
    });
  }

  function openSettingsDialog() {
    const settings = app.state.settings || defaults;
    app.openDialog("Configurações", `
      <div class="settings-shell">
        <label class="match-field">
          <span class="match-label">Volume dos efeitos</span>
          <input id="settings-volume" class="match-range" type="range" min="0" max="1" step="0.05" value="${settings.volume}" />
        </label>
        <label><input id="settings-muted" type="checkbox" ${settings.muted ? "checked" : ""} /> Mutar efeitos</label>
        <label><input id="settings-start3d" type="checkbox" ${settings.start3d ? "checked" : ""} /> Começar partidas em 3D</label>
        <label><input id="settings-reduce-motion" type="checkbox" ${settings.reduceMotion ? "checked" : ""} /> Reduzir animações</label>
        <label><input id="settings-compact-ui" type="checkbox" ${settings.compactUi ? "checked" : ""} /> Interface compacta</label>
        <div class="match-config-actions">
          <button id="settings-test-sound" type="button" class="btn">Testar som</button>
          <button id="settings-save" type="button" class="btn btn-primary">Salvar</button>
          <button id="settings-reset" type="button" class="btn">Limpar preferências</button>
        </div>
      </div>`);
    app.$("#settings-test-sound")?.addEventListener("click", () => playSound("notification"));
    app.$("#settings-reset")?.addEventListener("click", () => {
      saveSettings(defaults);
      openSettingsDialog();
    });
    app.$("#settings-save")?.addEventListener("click", () => {
      saveSettings({
        volume: Number(app.$("#settings-volume")?.value || defaults.volume),
        muted: Boolean(app.$("#settings-muted")?.checked),
        start3d: Boolean(app.$("#settings-start3d")?.checked),
        reduceMotion: Boolean(app.$("#settings-reduce-motion")?.checked),
        compactUi: Boolean(app.$("#settings-compact-ui")?.checked),
      });
      app.$("#dlg").close();
    });
  }

  app.state.settings = loadSettings();
  applySettings();

  Object.assign(app, {
    applySettings,
    openSettingsDialog,
    playSound,
    saveSettings,
  });
})();

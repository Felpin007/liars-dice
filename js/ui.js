// UI — 2D Light com dados clássicos (pips) + 3D com Three.js e mesa de madeira
const UI = (() => {

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let state = null;
  let onAction = null;
  let selectedFace = 2;
  let currentQ = 1;
  let three = null;
  let mode3d = false;
  const DIE_SIZE = 0.32;
  const DIE_RADIUS = 0.055;
  const DIE_SEGMENTS = 6;
  const CLOCK_ICON = "⏱";
  let dieGeometry = null;

  function init({ getState, actionHandler }) {
    state = { getMatch: getState };
    onAction = actionHandler;

    $("#btn-bid").addEventListener("click", () => {
      onAction({ type: "bid", bid: { q: currentQ, v: selectedFace } });
    });
    $("#btn-dudo").addEventListener("click", () => onAction({ type: "dudo" }));
    $("#btn-calza").addEventListener("click", () => onAction({ type: "calza" }));

    $$(".face-picker .face").forEach(b => {
      b.addEventListener("click", () => {
        selectedFace = Number(b.dataset.face);
        refreshControls();
      });
    });

    $$(".stepper button[data-step='q']").forEach(b => {
      b.addEventListener("click", () => {
        currentQ += Number(b.dataset.dir);
        refreshControls();
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      const m = state.getMatch();
      if (!m || m.phase !== "bidding" || m.turnSeat !== 0) return;
      if (e.key === "d" || e.key === "D") onAction({ type: "dudo" });
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); onAction({ type: "bid", bid: { q: currentQ, v: selectedFace } }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); currentQ++; refreshControls(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); currentQ = Math.max(1, currentQ - 1); refreshControls(); }
      else if (e.key >= "1" && e.key <= "6") { selectedFace = Number(e.key); refreshControls(); }
    });

    $("#toggle-3d").addEventListener("change", (e) => {
      setMode3d(e.target.checked);
    });
  }

  function setMode3d(on) {
    mode3d = on;
    $("#toggle-3d").checked = on;
    toggleMode3d();
  }

  function setSelectedFace(f) { selectedFace = f; refreshControls(); }
  function setCurrentQ(q) { currentQ = q; refreshControls(); }

  function refreshControls() {
    const m = state.getMatch();
    if (!m) return;
    const { min, max } = Game.qBounds(m, selectedFace);
    if (currentQ < min) currentQ = min;
    if (currentQ > max) currentQ = max;
    $("#bid-q").textContent = currentQ;

    $$(".face-picker .face").forEach(b => b.classList.toggle("selected", Number(b.dataset.face) === selectedFace));

    const prev = m.currentBid;
    const valid = Game.isValidRaise(prev, { q: currentQ, v: selectedFace }, m.config.wildAces);
    const pool = Game.totalDiceInPool(m);
    const myTurn = m.turnSeat === 0 && m.phase === "bidding" && m.players[0] && m.players[0].alive;
    $("#btn-bid").disabled = !valid || !myTurn;
    $("#btn-dudo").disabled = !prev || !myTurn;
    $("#btn-calza").classList.toggle("hidden", !m.config.calzaEnabled);
    $("#btn-calza").disabled = !prev || !myTurn;

    const hint = [];
    hint.push(`Pool: ${pool} dados.`);
    if (prev) {
      if (selectedFace === prev.v) hint.push(`Mesmo valor: q > ${prev.q}.`);
      else if (selectedFace > prev.v) hint.push(`Valor maior: q ≥ ${prev.q}.`);
      else hint.push(`Valor menor: aumente q para ${prev.q + 1} ou mais.`);
    } else {
      hint.push("Primeiro lance do round.");
    }
    $("#bid-hint").textContent = hint.join(" ");
  }

  function pipDie(face, opts = {}) {
    const { wild = false, hidden = false, mini = false } = opts;
    return `<span class="${dieClassName(face, opts)}" data-die-key="${dieStateKey(face, opts)}">${"<span></span>".repeat(9)}</span>`;
  }

  function dieClassName(face, opts = {}) {
    const { wild = false, hidden = false, mini = false } = opts;
    return [
      "die", "classic",
      mini ? "mini" : "",
      hidden ? "hidden-face" : `show-${face}`,
      wild && !hidden ? "wild" : "",
    ].filter(Boolean).join(" ");
  }

  function dieStateKey(face, opts = {}) {
    const { wild = false, hidden = false, mini = false } = opts;
    return hidden
      ? `hidden|${mini ? 1 : 0}`
      : `${face}|0|${wild ? 1 : 0}|${mini ? 1 : 0}`;
  }

  function buildDieElement(face, opts = {}) {
    const el = document.createElement("span");
    el.className = dieClassName(face, opts);
    el.dataset.dieKey = dieStateKey(face, opts);
    el.innerHTML = "<span></span>".repeat(9);
    return el;
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil((ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function playerTimeLeft(m, seat) {
    const p = m && m.players ? m.players[seat] : null;
    return p ? (p.uiTimeLeftMs ?? p.timeLeftMs ?? m.turnTimeMs ?? 0) : 0;
  }

  function lastBidForSeat(m, seat) {
    return [...m.bidHistory].reverse().find(b => b.seat === seat) || null;
  }

  function renderBidMarkup(bid, opts = {}) {
    if (!bid) return "—";
    const { wildAces = false, mini = true } = opts;
    const isWild = bid.v === 1 && wildAces;
    return `<span class="bid-inline">${bid.q} × ${pipDie(bid.v, { wild: isWild, mini })}</span>`;
  }

  function renderBidText(bid) {
    if (!bid) return "—";
    return `${bid.q} × ${bid.v === 1 ? "★1" : bid.v}`;
  }

  function renderAll() {
    const m = state.getMatch();
    if (!m) return;
    renderSeats(m);
    renderTurnCard(m);
    renderCurrentBid(m);
    renderTable(m);
    refreshControls();
    if (mode3d && three) render3D(m);
    updateLive(m);
  }

  function renderSeats(m) {
    const ul = $("#seat-list");
    ul.innerHTML = "";
    for (const p of m.players) {
      const li = document.createElement("li");
      li.className = "seat" + (p.seat === m.turnSeat && m.phase === "bidding" ? " active" : "") + (!p.alive ? " eliminated" : "");
      li.style.setProperty("--player-color", p.color || "#d8a657");
      li.innerHTML = `
        <div class="seat-main">
          <span class="seat-dot" aria-hidden="true"></span>
          <div class="seat-copy">
            <div class="seat-top">
              <span class="name">${esc(p.name)}</span>
            </div>
            <div class="seat-meta">${p.isBot ? `BOT ${p.botLevel}` : "Você"}</div>
          </div>
        </div>
        <div class="seat-side">
          <span class="seat-time player-time" data-seat="${p.seat}">${CLOCK_ICON} ${formatTime(playerTimeLeft(m, p.seat))}</span>
          <span class="dice-count">${p.dice.length}</span>
        </div>`;
      ul.appendChild(li);
    }
  }

  function renderTurnCard(m) {
    const card = $("#turn-card");
    const active = m.phase === "bidding" ? m.players[m.turnSeat] : null;
    if (!active) {
      card.innerHTML = `<div class="turn-card-empty">Aguardando o próximo round.</div>`;
      return;
    }
    const timeLeft = playerTimeLeft(m, active.seat);
    const progress = Math.max(0, Math.min(100, (timeLeft / (m.turnTimeMs || 1)) * 100));
    card.style.setProperty("--player-color", active.color || "#d8a657");
    card.innerHTML = `
      <div class="turn-card-name">${esc(active.name)}</div>
      <div class="turn-card-time">
        <span class="turn-card-clock">${CLOCK_ICON}</span>
        <span id="turn-card-time-value" class="turn-card-time-value">${formatTime(timeLeft)}</span>
      </div>
      <div class="turn-progress">
        <span id="turn-progress-fill" class="turn-progress-fill" style="width:${progress}%"></span>
      </div>
      <div id="turn-card-status" class="turn-card-status">${active.seat === 0 ? "Faça sua jogada" : `Aguardando o lance de ${esc(active.name)}`}</div>`;
  }

  function renderCurrentBid(m) {
    const el = $("#current-bid");
    const meta = $("#last-action-meta");
    const bid = m.currentBid || (m.bidHistory.length ? m.bidHistory[m.bidHistory.length - 1] : null);
    if (!bid) {
      el.innerHTML = `<div class="last-action-empty">—</div>`;
      if (meta) meta.textContent = "";
      return;
    }

    const actor = m.players[bid.seat];
    el.innerHTML = `<div class="last-action-value">${renderBidMarkup(bid, { wildAces: m.config.wildAces, mini: false })}</div>`;
    if (meta) meta.textContent = actor ? ` - ${actor.name}` : "";
  }

  function renderPool(m) {
    const poolInfo = $("#pool-info");
    if (!poolInfo) return;
    const pool = Game.totalDiceInPool(m);
    poolInfo.innerHTML = `<b>${pool}</b> dados no total · Round <b>${m.round}</b>`;
  }

  function renderTable(m) {
    const t = $("#table-2d");
    const w = t.clientWidth, h = t.clientHeight;
    const cx = w / 2, cy = h / 2;
    const rx = Math.max(140, Math.min(w, h) * 0.34);
    const ry = Math.max(100, Math.min(w, h) * 0.3);
    const sidePush = Math.min(112, w * 0.075);
    const n = m.players.length;
    const aliveSeats = new Set();
    for (let i = 0; i < n; i++) {
      const p = m.players[i];
      aliveSeats.add(String(i));
      const angle = Math.PI / 2 + (i * 2 * Math.PI / n);
      const horizontal = Math.cos(angle);
      const extraX = Math.sign(horizontal) * Math.pow(Math.abs(horizontal), 1.8) * sidePush;
      const x = cx + rx * horizontal + extraX;
      const y = cy + ry * Math.sin(angle);
      const pod = ensurePlayerPod(t, i);
      pod.className = "player-pod" + (i === m.turnSeat && m.phase === "bidding" ? " turn" : "") + (!p.alive ? " eliminated" : "");
      pod.style.setProperty("--player-color", p.color || "#d8a657");
      pod.style.left = `${x}px`;
      pod.style.top = `${y}px`;
      pod.style.transform = "translate(-50%,-50%)";
      syncPodStack(pod.querySelector(".pod-stack"), m, p, i);

      const row = pod.querySelector(".dice-row");
      const showFaces = i === 0 || m.phase === "ended" || m._revealAll;
      syncDiceRow(row, p.dice.map((d) => ({
        face: d || 1,
        wild: d === 1 && m.config.wildAces,
        hidden: !showFaces,
      })));
    }

    t.querySelectorAll(".player-pod[data-seat]").forEach((pod) => {
      if (!aliveSeats.has(pod.dataset.seat)) pod.remove();
    });
  }

  function ensurePlayerPod(container, seat) {
    let pod = container.querySelector(`.player-pod[data-seat="${seat}"]`);
    if (pod) return pod;

    pod = document.createElement("div");
    pod.dataset.seat = String(seat);

    const stack = document.createElement("div");
    stack.className = "pod-stack";
    pod.appendChild(stack);

    const row = document.createElement("div");
    row.className = "dice-row";
    pod.appendChild(row);

    container.appendChild(pod);
    return pod;
  }

  function syncPodStack(stack, m, player, seat) {
    let timeEl = stack.querySelector(".pod-time");
    if (!timeEl) {
      timeEl = document.createElement("div");
      timeEl.className = "pod-time player-time";
      stack.appendChild(timeEl);
    }
    timeEl.dataset.seat = String(seat);
    timeEl.textContent = `${CLOCK_ICON} ${formatTime(playerTimeLeft(m, seat))}`;

    let nameEl = stack.querySelector(".pod-name");
    if (!nameEl) {
      nameEl = document.createElement("div");
      nameEl.className = "pod-name";
      stack.appendChild(nameEl);
    }
    nameEl.textContent = player.name;

    const bid = lastBidForSeat(m, seat);
    const bidKey = bid ? `${bid.q}|${bid.v}|${m.config.wildAces ? 1 : 0}` : "";
    const currentAction = stack.querySelector(".pod-action");
    if (!bid) {
      if (currentAction) currentAction.remove();
      stack.dataset.bidKey = "";
      return;
    }

    if (stack.dataset.bidKey === bidKey && currentAction) return;

    const nextAction = document.createElement("div");
    nextAction.className = "pod-action";
    nextAction.innerHTML = renderBidMarkup(bid, { wildAces: m.config.wildAces, mini: true });
    if (currentAction) currentAction.replaceWith(nextAction);
    else stack.appendChild(nextAction);
    stack.dataset.bidKey = bidKey;
  }

  function syncDiceRow(row, diceStates) {
    const currentDice = [...row.children];
    diceStates.forEach((state, index) => {
      const key = dieStateKey(state.face, state);
      const existing = currentDice[index];
      if (!existing) {
        row.appendChild(buildDieElement(state.face, state));
        return;
      }
      if (existing.dataset.dieKey !== key) {
        row.replaceChild(buildDieElement(state.face, state), existing);
      }
    });

    while (row.children.length > diceStates.length) {
      row.lastElementChild.remove();
    }
  }

  function updateLive(m = state.getMatch()) {
    if (!m) return;

    for (const p of m.players) {
      const timeLabel = `${CLOCK_ICON} ${formatTime(playerTimeLeft(m, p.seat))}`;
      document.querySelectorAll(`.player-time[data-seat="${p.seat}"]`).forEach((el) => {
        el.textContent = timeLabel;
      });
    }

    const active = m.phase === "bidding" ? m.players[m.turnSeat] : null;
    if (!active) return;
    const timeLeft = playerTimeLeft(m, active.seat);
    const fill = $("#turn-progress-fill");
    const timeValue = $("#turn-card-time-value");
    const status = $("#turn-card-status");
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, (timeLeft / (m.turnTimeMs || 1)) * 100))}%`;
    if (timeValue) timeValue.textContent = formatTime(timeLeft);
    if (status) status.textContent = active.seat === 0 ? "Faça sua jogada" : `Aguardando o lance de ${active.name}`;
  }

  function showRevealBanner(text, cls = "") {
    const t = $("#table-2d");
    const old = t.querySelector(".reveal-banner");
    if (old) old.remove();
    const b = document.createElement("div");
    b.className = "reveal-banner " + cls;
    b.textContent = text;
    t.appendChild(b);
    setTimeout(() => { if (b.parentNode) b.remove(); }, 3500);
  }

  function appendLog(cls, html) {
    const li = document.createElement("li");
    li.className = cls;
    li.innerHTML = html;
    $("#log").appendChild(li);
    $("#log").scrollTop = $("#log").scrollHeight;
  }

  function shakeDice() {
    $$(".table-area .die.classic").forEach(d => {
      d.classList.remove("shake");
      void d.offsetWidth;
      d.classList.add("shake");
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ============================ 3D MODE ============================

  const DIE_REST_Y = 0.32;
  const CUP_REST_Y = 0.12;         // cup apoiado no feltro, cobrindo os dados
  const CUP_LIFT_Y = 2.0;           // cup erguido, revelando os dados
  const CUP_HEIGHT = 1.55;
  const CUP_RADIUS_BOTTOM = 0.78;
  const CUP_RADIUS_TOP = 0.66;
  const CLUSTER_RADIUS = 0.32;
  const ROW_SPREAD = 0.42;
  const CUP_LIFT_DURATION = 620;
  const CUP_VANISH_DELAY = 4000;    // ms após cup subir antes de sumir+rearranjar

  function toggleMode3d() {
    const t2 = $("#table-2d");
    const t3 = $("#table-3d");
    if (mode3d) {
      if (typeof THREE === "undefined") {
        showRevealBanner("Three.js não carregou — mantendo 2D.", "bad");
        $("#toggle-3d").checked = false;
        mode3d = false;
        return;
      }
      t2.classList.add("hidden");
      t3.classList.remove("hidden");
      requestAnimationFrame(() => {
        setup3D();
        render3D(state.getMatch());
      });
    } else {
      t3.classList.add("hidden");
      t2.classList.remove("hidden");
      if (three) three.running = false;
      requestAnimationFrame(() => renderAll());
    }
  }

  function setup3D() {
    const canvas = $("#table-3d");
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 420;

    if (three) {
      const wasRunning = three.running;
      three.running = true;
      three.renderer.setSize(w, h, false);
      three.camera.aspect = w / h;
      three.camera.updateProjectionMatrix();
      if (!wasRunning && three.loop) three.loop();
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a2420);
    scene.fog = new THREE.Fog(0x2a2420, 22, 42);

    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    // Pose default (voo alto). Pose cinematográfica é aplicada no newRound.
    const CAMERA_NORMAL_POS = new THREE.Vector3(0, 7.8, 9.2);
    const CAMERA_NORMAL_TGT = new THREE.Vector3(0, 0.3, 0);
    camera.position.copy(CAMERA_NORMAL_POS);
    const cameraTarget = CAMERA_NORMAL_TGT.clone();
    camera.lookAt(cameraTarget);

    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 22),
      new THREE.MeshBasicMaterial({ map: makeBackdropTexture(), depthWrite: false })
    );
    backdrop.position.set(0, 7, -12);
    scene.add(backdrop);

    scene.add(new THREE.HemisphereLight(0xfff2d6, 0x4a3320, 0.95));

    const key = new THREE.SpotLight(0xfff2d0, 1.9, 30, Math.PI / 5.2, 0.45, 1.2);
    key.position.set(3.2, 10.5, 4.0);
    key.target.position.set(0, 0.2, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.00015;
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 28;
    key.shadow.radius = 4;
    scene.add(key);
    scene.add(key.target);

    const fill = new THREE.DirectionalLight(0xffd9a0, 0.55);
    fill.position.set(-5, 6, 4);
    scene.add(fill);

    const ambient = new THREE.AmbientLight(0xfff3e0, 0.25);
    scene.add(ambient);

    const woodTex = makeWoodTexture();
    const feltTex = makeFeltTexture();

    const woodRing = new THREE.Mesh(
      new THREE.CylinderGeometry(5.8, 5.95, 0.72, 96),
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.4, metalness: 0.05 })
    );
    woodRing.position.y = -0.24;
    woodRing.castShadow = true;
    woodRing.receiveShadow = true;
    scene.add(woodRing);

    const innerWall = new THREE.Mesh(
      new THREE.CylinderGeometry(4.82, 4.82, 0.24, 96, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x4a2912, roughness: 0.55, metalness: 0.08, side: THREE.DoubleSide })
    );
    innerWall.position.y = 0;
    scene.add(innerWall);

    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(4.56, 4.56, 0.08, 96),
      new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.95, metalness: 0.02 })
    );
    felt.position.y = 0.09;
    felt.receiveShadow = true;
    scene.add(felt);

    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(4.62, 0.07, 24, 128),
      new THREE.MeshStandardMaterial({ color: 0xcba15b, roughness: 0.26, metalness: 0.8 })
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.115;
    scene.add(trim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.98, metalness: 0.02 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.62;
    floor.receiveShadow = true;
    scene.add(floor);

    three = {
      renderer, scene, camera,
      cameraTarget,
      CAMERA_NORMAL_POS, CAMERA_NORMAL_TGT,
      seats: new Map(),
      anims: [],
      running: true,
      loop: null,
      lastRound: null,
      needsRender: true,
    };

    three.loop = function loop() {
      if (!three.running) return;
      const now = performance.now();

      // tweens
      if (three.anims.length) {
        three.anims = three.anims.filter(a => !a.step(now));
        three.needsRender = true;
      }

      // shake dos dados dentro do cup
      let anyShake = false;
      for (const seat of three.seats.values()) {
        if (seat.shakeUntil && now < seat.shakeUntil) {
          anyShake = true;
          const amp = 0.04;
          for (const d of seat.dice) {
            d.position.x = d.userData.baseX + (Math.random() - 0.5) * amp;
            d.position.z = d.userData.baseZ + (Math.random() - 0.5) * amp;
            d.rotation.y += (Math.random() - 0.5) * 0.25;
          }
          if (seat.cup) seat.cup.rotation.z = Math.sin(now * 0.04) * 0.06;
        } else if (seat.shakeUntil) {
          for (const d of seat.dice) {
            d.position.x = d.userData.baseX;
            d.position.z = d.userData.baseZ;
          }
          if (seat.cup) seat.cup.rotation.z = 0;
          seat.shakeUntil = 0;
          three.needsRender = true;
        }
      }
      if (anyShake) three.needsRender = true;

      if (three.needsRender) {
        camera.lookAt(three.cameraTarget);
        renderer.render(scene, camera);
        three.needsRender = false;
      }
      requestAnimationFrame(three.loop);
    };
    three.loop();

    window.addEventListener("resize", () => {
      if (!mode3d) return;
      const w2 = canvas.clientWidth, h2 = canvas.clientHeight || 420;
      renderer.setSize(w2, h2, false);
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      three.needsRender = true;
    });
  }

  function tween(target, prop, to, duration, easing) {
    const from = target[prop];
    const start = performance.now();
    const ease = easing || (t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const anim = {
      step(now) {
        const t = Math.min(1, (now - start) / duration);
        target[prop] = from + (to - from) * ease(t);
        return t >= 1;
      }
    };
    three.anims.push(anim);
    return anim;
  }

  function ensureSeatEntry(seat) {
    let entry = three.seats.get(seat);
    if (entry) return entry;
    const group = new THREE.Group();
    three.scene.add(group);
    entry = { group, dice: [], cup: null, labelSprite: null, revealed: null, round: -1, shakeUntil: 0 };
    three.seats.set(seat, entry);
    return entry;
  }

  function disposeSeatEntry(seat) {
    const entry = three.seats.get(seat);
    if (!entry) return;
    three.scene.remove(entry.group);
    three.seats.delete(seat);
  }

  // Posições "cluster" dentro do copo (seat 0 antes do rearranjo).
  function clusterLayout(n) {
    if (n <= 0) return [];
    if (n === 1) return [[0, 0]];
    const r = CLUSTER_RADIUS;
    const pts = [];
    if (n === 2) {
      pts.push([-r * 0.55, 0], [r * 0.55, 0]);
    } else if (n === 3) {
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + k * (2 * Math.PI / 3);
        pts.push([Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6]);
      }
    } else if (n === 4) {
      const d = r * 0.55;
      pts.push([-d, -d], [d, -d], [-d, d], [d, d]);
    } else {
      // 5+: ring + center
      for (let k = 0; k < n - 1; k++) {
        const a = -Math.PI / 2 + k * (2 * Math.PI / (n - 1));
        pts.push([Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75]);
      }
      pts.push([0, 0]);
    }
    return pts;
  }

  function render3D(m) {
    if (!three || !m) return;
    three.needsRender = true;

    const newRound = three.lastRound !== m.round;
    three.lastRound = m.round;

    const n = m.players.length;
    const radius = 3.35;
    const aliveSeats = new Set();

    for (let i = 0; i < n; i++) {
      const p = m.players[i];
      if (!p.alive || p.dice.length === 0) continue;
      aliveSeats.add(i);

      const angle = Math.PI / 2 + (i * 2 * Math.PI / n);
      const cx = radius * Math.cos(angle);
      const cz = radius * Math.sin(angle);
      const entry = ensureSeatEntry(i);
      entry.group.position.set(cx, 0, cz);

      const isLocal = i === 0;
      // Seat 0 sempre "vê" seus próprios dados (mesmo sob o copo).
      // Outros assentos: só revelam no reveal global (dudo/calza/ended).
      const showFaces = isLocal || m.phase === "ended" || m._revealAll;

      const diceCount = p.dice.length;
      const rowStart = -((diceCount - 1) * ROW_SPREAD) / 2;
      const tx = Math.cos(angle - Math.PI / 2);
      const tz = Math.sin(angle - Math.PI / 2);
      const cluster = clusterLayout(diceCount);

      // Para seat 0: começa clustered, vai para row depois do "vanish".
      // Para outros: sempre row.
      const diceKey = (showFaces ? p.dice.map(v => v || 1).join(",") : `hidden${diceCount}`) + "|r" + m.round;

      if (entry.diceKey !== diceKey) {
        for (const d of entry.dice) entry.group.remove(d);
        entry.dice = [];
        entry.diceKey = diceKey;

        // Para seat 0, na transição de hidden→showFaces dentro do mesmo round,
        // preserva o estado "cluster" ou "row" já estabelecido.
        const startInCluster = isLocal && !entry.diceScattered;

        p.dice.forEach((v, idx) => {
          const face = showFaces ? (v || 1) : 0;
          const wild = showFaces && v === 1 && m.config.wildAces;
          const mesh = makeDieMesh(face, wild);

          const rowOffset = idx * ROW_SPREAD + rowStart;
          const rowX = tx * rowOffset;
          const rowZ = tz * rowOffset;
          const [cxLoc, czLoc] = cluster[idx] || [0, 0];

          mesh.userData.rowX = rowX;
          mesh.userData.rowZ = rowZ;
          mesh.userData.clusterX = cxLoc;
          mesh.userData.clusterZ = czLoc;

          const useCluster = startInCluster;
          const bx = useCluster ? cxLoc : rowX;
          const bz = useCluster ? czLoc : rowZ;
          mesh.position.set(bx, DIE_REST_Y, bz);
          mesh.userData.baseX = bx;
          mesh.userData.baseZ = bz;

          const rot = (i * 37 + idx * 13) * 0.1;
          mesh.rotation.set(-0.06 + 0.05 * Math.sin(rot * 0.8), rot, 0.08 * Math.cos(rot * 1.05));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          entry.group.add(mesh);
          entry.dice.push(mesh);
        });
      }

      // ---- Cup: somente para seat 0 ----
      if (isLocal) {
        if (!entry.cup) {
          entry.cup = makeCupMesh();
          entry.cup.position.y = CUP_LIFT_Y;
          entry.cup.rotation.y = angle;
          entry.group.add(entry.cup);
        }

        // Novo round: cup já começa apoiado no feltro, dados em cluster, câmera cinematográfica.
        if (newRound) {
          clearTimeout(entry.vanishTimer);
          entry.vanishTimer = null;
          entry.diceScattered = false;

          entry.cup.visible = true;
          setCupOpacity(entry.cup, 1);
          entry.cup.scale.set(1, 1, 1);

          for (const d of entry.dice) {
            d.position.x = d.userData.clusterX;
            d.position.z = d.userData.clusterZ;
            d.userData.baseX = d.userData.clusterX;
            d.userData.baseZ = d.userData.clusterZ;
          }

          // Cup parado em posição de repouso (sem queda).
          entry.cup.position.y = CUP_REST_Y;
          entry.cup.rotation.z = 0;
          entry.shakeUntil = performance.now() + 820;
          entry.revealed = false;

          // Câmera: snap para pose cinematográfica aproximada, tombada.
          // Seat 0 fica em (cx=0, cz=3.35); câmera entra baixa e de lado.
          three.camera.position.set(2.1, 2.6, 6.6);
          three.cameraTarget.set(0, 1.1, 3.0);

          // Após o shake, copo sobe (câmera continua tombada).
          setTimeout(() => {
            const e2 = three && three.seats.get(0);
            if (!e2 || !e2.cup) return;
            tween(e2.cup.position, "y", CUP_LIFT_Y, CUP_LIFT_DURATION);
            e2.revealed = true;

            // Vanish + rearrange após 4s — é aqui que a câmera volta ao normal.
            e2.vanishTimer = setTimeout(() => {
              const e3 = three && three.seats.get(0);
              if (!e3 || !e3.cup) return;
              for (const d of e3.dice) {
                tween(d.position, "x", d.userData.rowX, 700);
                tween(d.position, "z", d.userData.rowZ, 700);
                d.userData.baseX = d.userData.rowX;
                d.userData.baseZ = d.userData.rowZ;
              }
              tween(e3.cup.position, "y", CUP_LIFT_Y + 0.8, 600);
              tween(e3.cup.scale, "y", 0.7, 600);
              fadeCup(e3.cup, 0, 600, () => { if (e3.cup) e3.cup.visible = false; });
              e3.diceScattered = true;

              // Câmera volta à pose normal sincronizada com o sumiço do copo.
              const camDur = 900;
              const np = three.CAMERA_NORMAL_POS, nt = three.CAMERA_NORMAL_TGT;
              tween(three.camera.position, "x", np.x, camDur);
              tween(three.camera.position, "y", np.y, camDur);
              tween(three.camera.position, "z", np.z, camDur);
              tween(three.cameraTarget, "x", nt.x, camDur);
              tween(three.cameraTarget, "y", nt.y, camDur);
              tween(three.cameraTarget, "z", nt.z, camDur);
            }, CUP_VANISH_DELAY);
          }, 900);
        }
      } else {
        // Outros assentos: nunca têm copo, dados sempre em row.
        if (entry.cup) {
          entry.group.remove(entry.cup);
          entry.cup = null;
        }
      }

      // ---- Label (sprite) ----
      const labelKey = `${p.name}|${p.isBot ? "b" : "h"}|${i === m.turnSeat && m.phase === "bidding" ? "1" : "0"}|${p.dice.length}`;
      if (entry.labelKey !== labelKey) {
        if (entry.labelSprite) entry.group.remove(entry.labelSprite);
        entry.labelSprite = makeNameSprite(
          p.name + (p.isBot ? " 🤖" : ""),
          i === m.turnSeat && m.phase === "bidding",
          p.dice.length
        );
        entry.labelSprite.position.set(0, 2.4, 0);
        entry.group.add(entry.labelSprite);
        entry.labelKey = labelKey;
      }
    }

    for (const seat of [...three.seats.keys()]) {
      if (!aliveSeats.has(seat)) {
        const e = three.seats.get(seat);
        if (e && e.vanishTimer) clearTimeout(e.vanishTimer);
        disposeSeatEntry(seat);
      }
    }
  }

  function setCupOpacity(cup, opacity) {
    cup.traverse(obj => {
      if (obj.material) {
        obj.material.transparent = true;
        obj.material.opacity = opacity;
      }
    });
  }

  function fadeCup(cup, to, duration, onDone) {
    const start = performance.now();
    const fromMap = [];
    cup.traverse(obj => {
      if (obj.material) {
        obj.material.transparent = true;
        fromMap.push({ mat: obj.material, from: obj.material.opacity });
      }
    });
    const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    three.anims.push({
      step(now) {
        const t = Math.min(1, (now - start) / duration);
        const v = ease(t);
        for (const { mat, from } of fromMap) mat.opacity = from + (to - from) * v;
        if (t >= 1) { if (onDone) onDone(); return true; }
        return false;
      }
    });
  }

  // Copinho de couro/madeira — cilindro aberto embaixo com tampa no topo
  let cupTex = null;
  function getCupMaterial() {
    if (cupTex) {
      return new THREE.MeshStandardMaterial({ map: cupTex, roughness: 0.78, metalness: 0.1, side: THREE.DoubleSide, transparent: true });
    }
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#2a1a10");
    g.addColorStop(.4, "#4a2d18");
    g.addColorStop(.7, "#3a2210");
    g.addColorStop(1, "#20140a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(${80 + Math.random() * 40},${40 + Math.random() * 30},${20 + Math.random() * 20},${0.1 + Math.random() * 0.15})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 1);
    }
    for (let i = 0; i < 5; i++) {
      const y = (i + 1) * 512 / 6;
      ctx.strokeStyle = "rgba(210,170,110,.18)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
    const tex = finalizeCanvasTexture(new THREE.CanvasTexture(c), 4);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    cupTex = tex;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0.1, side: THREE.DoubleSide, transparent: true });
  }

  function makeCupMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(CUP_RADIUS_TOP, CUP_RADIUS_BOTTOM, CUP_HEIGHT, 48, 1, true),
      getCupMaterial()
    );
    body.position.y = CUP_HEIGHT / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    const lid = new THREE.Mesh(
      new THREE.CircleGeometry(CUP_RADIUS_TOP, 48),
      new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.6, metalness: 0.15, transparent: true })
    );
    lid.rotation.x = -Math.PI / 2;
    lid.position.y = CUP_HEIGHT;
    lid.castShadow = true;
    g.add(lid);

    // aro inferior metálico
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(CUP_RADIUS_BOTTOM, 0.025, 12, 48),
      new THREE.MeshStandardMaterial({ color: 0xb88545, roughness: 0.35, metalness: 0.75, transparent: true })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    g.add(rim);

    return g;
  }

  // Cria um cubo com as 6 faces corretas (1↔6, 2↔5, 3↔4 em faces opostas)
  function makeDieMesh(faceUp, wild) {
    const geo = getDieGeometry();
    // ordem de materiais do BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
    const mats = [
      makeDieFaceMaterial(3, wild), // +X
      makeDieFaceMaterial(4, wild), // -X
      makeDieFaceMaterial(faceUp || 1, wild), // +Y (topo — sempre a face-alvo)
      makeDieFaceMaterial(7 - (faceUp || 1), wild), // -Y (oposta)
      makeDieFaceMaterial(2, wild), // +Z
      makeDieFaceMaterial(5, wild), // -Z
    ];
    if (faceUp === 0) {
      // dado "oculto" — todas as faces vazias
      const m = makeHiddenFaceMaterial();
      return new THREE.Mesh(geo, [m, m, m, m, m, m]);
    }
    return new THREE.Mesh(geo, mats);
  }

  function getDieGeometry() {
    if (dieGeometry) return dieGeometry;
    dieGeometry = makeRoundedBoxGeometry(DIE_SIZE, DIE_RADIUS, DIE_SEGMENTS);
    return dieGeometry;
  }

  function makeRoundedBoxGeometry(size, radius, segments) {
    const geo = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
    const pos = geo.attributes.position;
    const inner = size / 2 - radius;
    const vertex = new THREE.Vector3();
    const clamped = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      vertex.fromBufferAttribute(pos, i);
      clamped.set(
        Math.max(-inner, Math.min(inner, vertex.x)),
        Math.max(-inner, Math.min(inner, vertex.y)),
        Math.max(-inner, Math.min(inner, vertex.z))
      );
      vertex.sub(clamped).normalize().multiplyScalar(radius);
      pos.setXYZ(i, clamped.x + vertex.x, clamped.y + vertex.y, clamped.z + vertex.z);
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  // Cache de texturas por face para evitar recriar
  const faceCache = new Map();
  function makeDieFaceMaterial(face, wild) {
    const key = `${face}|${wild ? 1 : 0}`;
    let mat = faceCache.get(key);
    if (mat) return mat;
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");

    // Corpo mais polido, puxando para marfim/resina em vez de papelão.
    const bg = ctx.createLinearGradient(0, 0, 256, 256);
    if (wild) {
      bg.addColorStop(0, "#fff6dc");
      bg.addColorStop(.55, "#f3d48f");
      bg.addColorStop(1, "#cf9640");
    } else {
      bg.addColorStop(0, "#fffefb");
      bg.addColorStop(.58, "#f2eadf");
      bg.addColorStop(1, "#dac9b4");
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);

    const highlight = ctx.createRadialGradient(68, 58, 8, 72, 62, 150);
    highlight.addColorStop(0, "rgba(255,255,255,.96)");
    highlight.addColorStop(.45, "rgba(255,255,255,.28)");
    highlight.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = highlight;
    ctx.fillRect(0, 0, 256, 256);

    const edgeShade = ctx.createRadialGradient(128, 128, 82, 128, 128, 180);
    edgeShade.addColorStop(.55, "rgba(0,0,0,0)");
    edgeShade.addColorStop(1, wild ? "rgba(88,48,0,.18)" : "rgba(32,20,10,.16)");
    ctx.fillStyle = edgeShade;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = wild ? "rgba(162,110,30,.52)" : "rgba(98,80,56,.36)";
    ctx.lineWidth = 5;
    roundRect(ctx, 12, 12, 232, 232, 34);
    ctx.stroke();

    for (let i = 0; i < 320; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const a = Math.random() * 0.05;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(92,72,48,${a * 0.8})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    const pipPositions = {
      1: [[128, 128]],
      2: [[68, 68], [188, 188]],
      3: [[68, 68], [128, 128], [188, 188]],
      4: [[68, 68], [188, 68], [68, 188], [188, 188]],
      5: [[68, 68], [188, 68], [128, 128], [68, 188], [188, 188]],
      6: [[68, 54], [188, 54], [68, 128], [188, 128], [68, 202], [188, 202]],
    };
    const pips = pipPositions[face] || [];
    for (const [x, y] of pips) {
      const r = 19;
      const shadow = ctx.createRadialGradient(x, y + 4, 3, x, y + 4, r + 10);
      shadow.addColorStop(0, "rgba(0,0,0,.28)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(x, y + 4, r + 5, 0, Math.PI * 2);
      ctx.fill();

      const grd = ctx.createRadialGradient(x - r * 0.45, y - r * 0.5, 2, x, y, r);
      grd.addColorStop(0, "#666");
      grd.addColorStop(.45, "#17191c");
      grd.addColorStop(1, "#000");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,.18)";
      ctx.beginPath();
      ctx.arc(x - 5, y - 6, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = finalizeCanvasTexture(new THREE.CanvasTexture(c), 4);
    mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: wild ? 0.35 : 0.3,
      metalness: 0.05,
    });
    faceCache.set(key, mat);
    return mat;
  }

  let hiddenMat = null;
  function makeHiddenFaceMaterial() {
    if (hiddenMat) return hiddenMat;
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 256, 256);
    bg.addColorStop(0, "#1a1a1a");
    bg.addColorStop(.55, "#0a0a0a");
    bg.addColorStop(1, "#000");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);

    const gloss = ctx.createRadialGradient(70, 60, 10, 70, 60, 150);
    gloss.addColorStop(0, "rgba(255,255,255,.14)");
    gloss.addColorStop(.5, "rgba(255,255,255,.04)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 4;
    roundRect(ctx, 12, 12, 232, 232, 34);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 150px -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 128, 138);

    const tex = finalizeCanvasTexture(new THREE.CanvasTexture(c), 4);
    hiddenMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.35,
      metalness: 0.05,
    });
    return hiddenMat;
  }

  function finalizeCanvasTexture(tex, anisotropy = 4) {
    tex.anisotropy = anisotropy;
    if ("colorSpace" in tex && THREE.SRGBColorSpace) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    return tex;
  }

  // Textura de madeira seamless — grão horizontal contínuo, sem emendas visíveis.
  function makeWoodTexture() {
    const W = 2048, H = 1024;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");

    // Base gradiente vertical (tons de ébano/mogno).
    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, "#6b3f1e");
    base.addColorStop(.5, "#4e2a12");
    base.addColorStop(1, "#2b1608");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // Veios — curvas senoidais contínuas que se repetem no X (seamless).
    // Cada veio usa período múltiplo inteiro de W para fechar perfeito nas bordas.
    const veios = 80;
    for (let i = 0; i < veios; i++) {
      const baseY = Math.random() * H;
      const thickness = 0.5 + Math.random() * 2.6;
      const alpha = 0.06 + Math.random() * 0.18;
      const dark = Math.random() > 0.5;
      ctx.strokeStyle = dark ? `rgba(0,0,0,${alpha})` : `rgba(240,190,130,${alpha * 0.5})`;
      ctx.lineWidth = thickness;
      const period = W / (1 + Math.floor(Math.random() * 4)); // W, W/2, W/3, W/4
      const ampl = 3 + Math.random() * 12;
      const phase = Math.random() * Math.PI * 2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = baseY + Math.sin((x / period) * Math.PI * 2 + phase) * ampl
                        + Math.sin((x / (period * 0.37)) * Math.PI * 2 + phase * 1.7) * ampl * 0.4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Nós (knots) escuros — precisam ser espelhados se estiverem perto da borda para seamless.
    const knots = 22;
    for (let i = 0; i < knots; i++) {
      const cx = Math.random() * W;
      const cy = Math.random() * H;
      const r = 6 + Math.random() * 24;
      drawKnot(ctx, cx, cy, r);
      // Espelho horizontal se perto da borda
      if (cx < r * 2) drawKnot(ctx, cx + W, cy, r);
      else if (cx > W - r * 2) drawKnot(ctx, cx - W, cy, r);
    }

    // Ruído grão fino
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 18;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
      d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
    }
    ctx.putImageData(img, 0, 0);

    // Verniz (brilho superior sutil).
    const varnish = ctx.createLinearGradient(0, 0, 0, H);
    varnish.addColorStop(0, "rgba(255,220,180,.08)");
    varnish.addColorStop(.5, "rgba(255,255,255,.015)");
    varnish.addColorStop(1, "rgba(0,0,0,.20)");
    ctx.fillStyle = varnish;
    ctx.fillRect(0, 0, W, H);

    const tex = finalizeCanvasTexture(new THREE.CanvasTexture(c), 8);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    return tex;
  }

  function drawKnot(ctx, x, y, r) {
    const rg = ctx.createRadialGradient(x, y, 1, x, y, r);
    rg.addColorStop(0, "rgba(10,5,0,.85)");
    rg.addColorStop(.45, "rgba(35,18,6,.5)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.1, r * 0.82, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    // Anel interno mais claro
    ctx.strokeStyle = "rgba(90,55,25,.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.55, r * 0.38, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Textura de feltro verde com variação sutil
  function makeFeltTexture() {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const ctx = c.getContext("2d");
    const bg = ctx.createRadialGradient(256, 220, 30, 256, 256, 300);
    bg.addColorStop(0, "#4d8c62");
    bg.addColorStop(.5, "#2f6748");
    bg.addColorStop(1, "#173323");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 12000; i++) {
      const alpha = 0.04 + Math.random() * 0.11;
      ctx.fillStyle = `rgba(${24 + Math.random() * 36},${72 + Math.random() * 60},${34 + Math.random() * 34},${alpha})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.4, 1.4);
    }

    ctx.strokeStyle = "rgba(255,255,255,.03)";
    for (let i = 0; i < 220; i++) {
      const y = (i / 220) * 512;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y + Math.sin(i * 0.55) * 4);
      ctx.stroke();
    }

    const tex = finalizeCanvasTexture(new THREE.CanvasTexture(c), 8);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.2, 1.2);
    return tex;
  }

  function makeBackdropTexture() {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 768;
    const ctx = c.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, 0, 768);
    bg.addColorStop(0, "#5a4331");
    bg.addColorStop(.45, "#402c1e");
    bg.addColorStop(1, "#241811");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 768);

    const amber = ctx.createRadialGradient(512, 260, 40, 512, 260, 420);
    amber.addColorStop(0, "rgba(255,214,150,.48)");
    amber.addColorStop(.55, "rgba(255,180,100,.14)");
    amber.addColorStop(1, "rgba(255,160,80,0)");
    ctx.fillStyle = amber;
    ctx.fillRect(0, 0, 1024, 768);

    // grão de madeira suave no fundo
    for (let i = 0; i < 60; i++) {
      const y = Math.random() * 768;
      ctx.strokeStyle = `rgba(20,10,5,${0.04 + Math.random() * 0.08})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(340, y + (Math.random() - .5) * 30, 680, y + (Math.random() - .5) * 30, 1024, y);
      ctx.stroke();
    }

    const vignette = ctx.createRadialGradient(512, 384, 180, 512, 384, 620);
    vignette.addColorStop(.4, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, 1024, 768);

    return finalizeCanvasTexture(new THREE.CanvasTexture(c), 4);
  }

  // Nome como Sprite — sempre perpendicular à câmera, nunca parece 3D.
  function makeNameSprite(text, highlighted, diceCount) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);

    // pill de fundo
    ctx.fillStyle = highlighted ? "rgba(232,198,120,.95)" : "rgba(18,14,10,.82)";
    roundRect(ctx, 8, 8, 496, 112, 56);
    ctx.fill();
    ctx.strokeStyle = highlighted ? "#fff7dd" : "rgba(208,179,121,.5)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = highlighted ? "#2a1f00" : "#f2e8cf";
    ctx.font = "bold 46px -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 58);

    // contador de dados abaixo
    ctx.font = "600 22px -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = highlighted ? "rgba(42,31,0,.75)" : "rgba(242,232,207,.7)";
    ctx.fillText(`${diceCount} dado${diceCount === 1 ? "" : "s"}`, 256, 98);

    const tex = finalizeCanvasTexture(new THREE.CanvasTexture(c), 4);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.9, 0.48, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return {
    init, renderAll, refreshControls, appendLog,
    showRevealBanner, shakeDice, setSelectedFace, setCurrentQ, setMode3d,
    updateLive, formatTime, renderBidMarkup, renderBidText,
    get mode3d() { return mode3d; },
    get currentQ() { return currentQ; },
    set currentQ(v) { currentQ = v; },
    get selectedFace() { return selectedFace; },
  };
})();

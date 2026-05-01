// Tutorial interativo — onboarding visual, sem backend e sem dependências.
(() => {
  const app = window.LDAApp;

  const steps = [
    {
      title: "Bem-vindo à mesa",
      badge: "Base inicial",
      phase: "Contexto",
      table: { players: 3, dicePerPlayer: 5, total: 15, hidden: 10 },
      hand: [1, 3, 3, 5, 6],
      bid: null,
      prompt: "Esta é uma rodada com 3 jogadores. Cada um tem 5 dados.",
      lesson: "Você vê 5 dados seus. Os 10 dados dos outros ficam escondidos. Em cada turno, alguém aposta quantos dados de uma face existem na mesa inteira.",
      options: [
        { label: "Eu vejo os dados de todo mundo", correct: false, feedback: "Ainda não. Os dados dos outros só aparecem quando alguém chama Dudo ou Calza." },
        { label: "Entendi: minha mão é a informação segura", correct: true, feedback: "Isso. O resto é dedução: você combina seus dados com o tamanho da mesa." },
        { label: "O lance vale só para meus dados", correct: false, feedback: "Quase. O lance vale para a mesa inteira: seus dados mais os dados escondidos dos outros." },
      ],
      tip: "Pense sempre em três coisas: seus dados, total de dados na mesa e quão ousado foi o último lance.",
    },
    {
      title: "Use sua informação real",
      badge: "Dados secretos",
      phase: "Leitura",
      table: { players: 3, dicePerPlayer: 5, total: 15, hidden: 10 },
      hand: [1, 3, 3, 5, 6],
      bid: null,
      target: { q: 3, v: 3 },
      count: [
        { label: "Seu 3", value: 1 },
        { label: "Seu outro 3", value: 1 },
        { label: "Seu 1 coringa", value: 1 },
      ],
      prompt: "Qual primeiro lance usa melhor os seus dados?",
      lesson: "Nesta mesa, o 1 é coringa. Para um lance em 3, contam seus dois 3 e também o seu 1.",
      options: [
        { label: "6 x 2", correct: false, feedback: "Você não vê nenhum 2. Pedir seis logo de cara força demais." },
        { label: "3 x 3", correct: true, feedback: "Boa. Você já tem 3 dados válidos para esse lance: 1, 3 e 3." },
        { label: "1 x 6", correct: false, feedback: "É válido, mas desperdiça informação: sua mão sustenta melhor um lance em 3." },
      ],
    },
    {
      title: "Aumente sem quebrar a regra",
      badge: "Hierarquia",
      phase: "Lances",
      table: { players: 3, dicePerPlayer: 5, total: 15, hidden: 10 },
      hand: [1, 3, 3, 5, 6],
      bid: { q: 3, v: 3, who: "Alice" },
      prompt: "Alice respondeu com 3 x 3. Agora voltou para você. Qual lance aumenta corretamente?",
      lesson: "Você nunca repete nem abaixa o lance atual. Agora precisa subir a face mantendo 3, ou subir a quantidade.",
      rules: [
        "3 x 4 vale: mesma quantidade, face maior.",
        "4 x 2 vale: quantidade maior, qualquer face.",
        "3 x 2 não vale: mesma quantidade, face menor.",
      ],
      options: [
        { label: "3 x 2", correct: false, feedback: "Não vale: a face caiu e a quantidade ficou igual." },
        { label: "2 x 6", correct: false, feedback: "Não vale: a quantidade caiu de 3 para 2." },
        { label: "3 x 4", correct: true, feedback: "Certo. A quantidade ficou em 3 e a face subiu de 3 para 4." },
      ],
    },
    {
      title: "Identifique um blefe provável",
      badge: "Dudo",
      phase: "Decisão",
      table: { players: 3, dicePerPlayer: 4, total: 8, hidden: 4 },
      hand: [2, 2, 4, 6],
      bid: { q: 5, v: 6, who: "Alice" },
      target: { q: 5, v: 6 },
      count: [
        { label: "Seu 6", value: 1 },
        { label: "Seus coringas", value: 0 },
        { label: "Dados escondidos", value: "4 incertos" },
      ],
      prompt: "Restam 8 dados na mesa. Alice disse 5 x 6. Qual é a melhor reação?",
      lesson: "Dudo é o botão de desconfiança. Você usa quando acha que o último lance passou do limite.",
      options: [
        { label: "Aumento para 6 x 6", correct: false, feedback: "Isso deixa ainda mais alto um lance que já parece suspeito." },
        { label: "Dudo", correct: true, feedback: "Boa leitura. Para Alice estar certa, quase todos os dados escondidos precisariam ajudar." },
        { label: "Aumento para 5 x 5", correct: false, feedback: "Além de arriscado, é inválido: mesma quantidade com face menor." },
      ],
    },
    {
      title: "Conte a revelação",
      badge: "Resultado",
      phase: "Revelação",
      table: { players: 3, dicePerPlayer: 4, total: 8, hidden: 0 },
      hand: [2, 2, 4, 6],
      bid: { q: 5, v: 6, who: "Alice" },
      reveal: true,
      opponents: [
        { name: "Alice", dice: [1, 3, 5, 6] },
        { name: "Bob", dice: [2, 4, 5, 5] },
      ],
      target: { q: 5, v: 6 },
      count: [
        { label: "Seu 6", value: 1 },
        { label: "1 da Alice como coringa", value: 1 },
        { label: "6 da Alice", value: 1 },
        { label: "Bob ajuda", value: 0 },
      ],
      prompt: "A mesa revelou 3 dados válidos como 6. O lance 5 x 6 era verdadeiro?",
      lesson: "Para ser verdadeiro, precisava chegar a pelo menos 5. Chegou só a 3.",
      options: [
        { label: "Sim, era verdadeiro", correct: false, feedback: "Não. Para ser verdadeiro, a contagem precisava chegar a pelo menos 5." },
        { label: "Não, era falso", correct: true, feedback: "Exato. Dudo foi correto: 3 não alcança o lance de 5." },
      ],
    },
    {
      title: "Calza é aposta exata",
      badge: "Avançado",
      phase: "Precisão",
      table: { players: 3, dicePerPlayer: 4, total: 12, hidden: 8 },
      hand: [1, 4, 4, 5],
      bid: { q: 4, v: 4, who: "Bob" },
      target: { q: 4, v: 4 },
      count: [
        { label: "Seus 4", value: 2 },
        { label: "Seu 1 coringa", value: 1 },
        { label: "Falta para exato", value: "1 nos outros" },
      ],
      prompt: "Calza significa: existem exatamente 4 dados daquele valor. Quando você usaria?",
      lesson: "Calza é diferente de Dudo. Dudo diz 'acho falso'. Calza diz 'acho exatamente certo'.",
      options: [
        { label: "Sempre que acho que o lance é falso", correct: false, feedback: "Isso é Dudo. Calza só faz sentido quando você acredita na contagem exata." },
        { label: "Quando quero passar a vez", correct: false, feedback: "Não existe passar a vez: você aumenta, chama Dudo ou chama Calza." },
        { label: "Quando acho que a contagem é exatamente 4", correct: true, feedback: "Perfeito. Calza é uma jogada de precisão, não de desconfiança genérica." },
      ],
    },
    {
      title: "Pronto para uma mesa assistida",
      badge: "Treino",
      phase: "Prática",
      table: { players: 2, dicePerPlayer: 5, total: 10, hidden: 5 },
      hand: [1, 2, 4, 4, 6],
      bid: null,
      prompt: "Agora você já sabe o básico: olhar a mão, fazer lance, aumentar, Dudar e reconhecer Calza.",
      lesson: "A melhor continuação é treinar contra um bot fácil. O treino abre com Calza ligado para você ver todos os botões.",
      rules: [
        "Jogue devagar e observe o total de dados.",
        "Use Dudo quando o lance parecer alto demais.",
        "Use Calza só quando a contagem parecer exata.",
      ],
      options: [
        { label: "Voltar para a home", correct: false, feedback: "Pode, mas o melhor próximo passo é praticar uma mesa curta agora." },
        { label: "Abrir treino contra bot", correct: true, feedback: "Boa. A mesa de treino vai abrir com bot fácil, 5 minutos e Calza habilitado." },
        { label: "Pular direto para ranqueada", correct: false, feedback: "Ainda não existe ranqueada real no protótipo, e treino é melhor para fixar os botões." },
      ],
      practiceOnCorrect: true,
    },
  ];

  let current = 0;

  function openTutorial() {
    current = 0;
    app.openDialog("Tutorial interativo", renderTutorial());
    bindTutorial();
  }

  function renderTutorial() {
    const step = steps[current];
    return `
      <div class="tutorial-shell" data-step="${current}">
        <div class="tutorial-progress" aria-label="Progresso do tutorial">
          ${steps.map((_, index) => `<span class="${index === current ? "active" : index < current ? "done" : ""}"></span>`).join("")}
        </div>

        <div class="tutorial-context">
          <div>
            <span>${app.esc(step.phase)}</span>
            <strong>${app.esc(step.title)}</strong>
          </div>
          <ul>
            <li><b>${step.table.players}</b> jogadores</li>
            <li><b>${step.table.total}</b> dados na mesa</li>
            <li><b>${step.table.hidden}</b> ocultos</li>
          </ul>
        </div>

        <div class="tutorial-stage">
          <div class="tutorial-board">
            ${renderOpponent("Alice", step.opponents?.[0]?.dice, step)}
            <div class="tutorial-bid-card">
              <span>${app.esc(step.badge)}</span>
              <strong>${step.bid ? `${app.esc(step.bid.who)}: ${step.bid.q} x ${faceText(step.bid.v)}` : "Sem lance ainda"}</strong>
            </div>
            ${renderOpponent("Bob", step.opponents?.[1]?.dice, step)}
          </div>

          <div class="tutorial-side">
            <div class="tutorial-hand">
              <span>Sua mão</span>
              <div class="tutorial-dice-row">
                ${step.hand.map((face) => tutorialDie(face, face === 1)).join("")}
              </div>
            </div>
            ${renderCountingPanel(step)}
          </div>
        </div>

        <div class="tutorial-copy">
          <h3>${app.esc(step.prompt)}</h3>
          <p>${app.esc(step.lesson)}</p>
          ${renderRules(step.rules)}
          ${step.tip ? `<small>${app.esc(step.tip)}</small>` : ""}
        </div>

        <div class="tutorial-options">
          ${step.options.map((option, index) => `
            <button type="button" class="tutorial-option" data-option="${index}">
              ${app.esc(option.label)}
            </button>
          `).join("")}
        </div>

        <div id="tutorial-feedback" class="tutorial-feedback" aria-live="polite"></div>

        <div class="tutorial-actions">
          <button id="tutorial-prev" type="button" class="btn"${current === 0 ? " disabled" : ""}>Voltar</button>
          <button id="tutorial-skip-practice" type="button" class="btn">Treinar contra bot</button>
          <button id="tutorial-next" type="button" class="btn btn-primary" disabled>${current === steps.length - 1 ? "Concluir" : "Continuar"}</button>
        </div>
      </div>
    `;
  }

  function renderCountingPanel(step) {
    if (!step.target && !step.count) {
      return `
        <div class="tutorial-count-panel">
          <span>Como pensar</span>
          <strong>Mão + mesa</strong>
          <p>Você parte do que vê e estima o que pode existir nos dados escondidos.</p>
        </div>
      `;
    }

    const total = (step.count || []).reduce((sum, item) => (
      typeof item.value === "number" ? sum + item.value : sum
    ), 0);

    return `
      <div class="tutorial-count-panel">
        <span>${step.target ? `Alvo: ${step.target.q} x ${faceText(step.target.v)}` : "Contagem"}</span>
        <strong>${typeof total === "number" ? `${total} confirmados` : "Analise a mesa"}</strong>
        <div class="tutorial-count-list">
          ${(step.count || []).map((item) => `
            <div>
              <small>${app.esc(item.label)}</small>
              <b>${app.esc(item.value)}</b>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderRules(rules) {
    if (!Array.isArray(rules) || !rules.length) return "";
    return `
      <div class="tutorial-rule-list">
        ${rules.map((rule) => `<span>${app.esc(rule)}</span>`).join("")}
      </div>
    `;
  }

  function renderOpponent(name, dice, step) {
    const visibleCount = Math.max(1, Number(step.table?.dicePerPlayer || 5));
    const shownDice = step.reveal && Array.isArray(dice)
      ? dice.slice(0, visibleCount)
      : new Array(visibleCount).fill(0);
    return `
      <div class="tutorial-opponent">
        <strong>${app.esc(name)}</strong>
        <div class="tutorial-mini-dice">
          ${shownDice.map((face) => face ? tutorialDie(face, face === 1, true) : tutorialHiddenDie()).join("")}
        </div>
      </div>
    `;
  }

  function tutorialDie(face, wild = false, mini = false) {
    return `<span class="die classic ${mini ? "mini" : ""} show-${face} ${wild ? "wild" : ""}" aria-label="Dado ${face}">${"<span></span>".repeat(9)}</span>`;
  }

  function tutorialHiddenDie() {
    return `<span class="die classic mini hidden-face" aria-label="Dado oculto">${"<span></span>".repeat(9)}</span>`;
  }

  function faceText(face) {
    return face === 1 ? "1 coringa" : String(face);
  }

  function bindTutorial() {
    const root = app.$("#dlg-content .tutorial-shell");
    if (!root) return;

    root.querySelectorAll(".tutorial-option").forEach((button) => {
      button.addEventListener("click", () => answerOption(Number(button.dataset.option)));
    });

    root.querySelector("#tutorial-prev")?.addEventListener("click", () => {
      if (current === 0) return;
      current -= 1;
      rerender();
    });

    root.querySelector("#tutorial-next")?.addEventListener("click", () => {
      if (current >= steps.length - 1) {
        app.$("#dlg").close();
        return;
      }
      current += 1;
      rerender();
    });

    root.querySelector("#tutorial-skip-practice")?.addEventListener("click", startPractice);
  }

  function answerOption(index) {
    const step = steps[current];
    const option = step.options[index];
    const root = app.$("#dlg-content .tutorial-shell");
    const feedback = root?.querySelector("#tutorial-feedback");
    if (!root || !feedback || !option) return;

    root.querySelectorAll(".tutorial-option").forEach((button, buttonIndex) => {
      const candidate = step.options[buttonIndex];
      button.disabled = true;
      button.classList.toggle("correct", candidate.correct);
      button.classList.toggle("wrong", buttonIndex === index && !candidate.correct);
    });

    feedback.className = `tutorial-feedback ${option.correct ? "ok" : "bad"}`;
    feedback.textContent = option.feedback || (option.correct ? "Certo. Pode continuar." : "Quase. Use a explicação para decidir a próxima.");
    root.querySelector("#tutorial-next").disabled = false;

    if (option.correct && step.practiceOnCorrect) {
      root.querySelector("#tutorial-next").textContent = "Abrir treino";
      root.querySelector("#tutorial-next").onclick = startPractice;
    }
  }

  function startPractice() {
    app.$("#dlg").close();
    app.startGame({
      numBots: 1,
      level: 1,
      minutes: 5,
      incrementSeconds: 0,
      startingDice: 5,
      wildAces: true,
      calzaEnabled: true,
    });
  }

  function rerender() {
    app.$("#dlg-content").innerHTML = renderTutorial();
    bindTutorial();
  }

  Object.assign(app, { openTutorial });
})();

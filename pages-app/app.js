const bank = window.QUESTION_BANK;
const storageKey = "network-programming-quiz-progress";
const apiBase = window.APP_CONFIG?.apiBase || "/api";
const requireLogin = window.APP_CONFIG?.requireLogin === true;

const state = {
  activeType: "全部",
  activeState: "all",
  search: "",
  current: 0,
  filtered: bank.questions.map((question, index) => ({ question, index })),
  progress: requireLogin ? {} : loadProgress(),
  drafts: {},
  checks: {},
  user: null,
  syncReady: false,
  syncTimer: null,
};

const els = {
  stats: document.querySelector("#stats"),
  accountStatus: document.querySelector("#accountStatus"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  sourceLabel: document.querySelector("#sourceLabel"),
  typeFilters: document.querySelector("#typeFilters"),
  stateFilters: document.querySelector("#stateFilters"),
  searchInput: document.querySelector("#searchInput"),
  questionType: document.querySelector("#questionType"),
  questionIndex: document.querySelector("#questionIndex"),
  questionTitle: document.querySelector("#questionTitle"),
  questionPrompt: document.querySelector("#questionPrompt"),
  answerForm: document.querySelector("#answerForm"),
  answerInputs: document.querySelector("#answerInputs"),
  checkSummary: document.querySelector("#checkSummary"),
  checkMessage: document.querySelector("#checkMessage"),
  questionAnswer: document.querySelector("#questionAnswer"),
  answerPanel: document.querySelector("#answerPanel"),
  checkButton: document.querySelector("#checkButton"),
  revealButton: document.querySelector("#revealButton"),
  reviewButton: document.querySelector("#reviewButton"),
  knownButton: document.querySelector("#knownButton"),
  prevButton: document.querySelector("#prevButton"),
  nextButton: document.querySelector("#nextButton"),
  shuffleButton: document.querySelector("#shuffleButton"),
  resetButton: document.querySelector("#resetButton"),
  progressBar: document.querySelector("#progressBar"),
  questionList: document.querySelector("#questionList"),
  resultCount: document.querySelector("#resultCount"),
};

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch {
    return {};
  }
}

function saveProgress() {
  if (!requireLogin) {
    localStorage.setItem(storageKey, JSON.stringify(state.progress));
  }
  if (state.user) {
    queueRemoteProgressSave();
  }
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API ${path} returned ${response.status}`);
  }

  return response.json();
}

function renderAccount() {
  if (state.user) {
    els.accountStatus.textContent = `${state.user.login} · 云端同步`;
    els.loginButton.classList.add("hidden");
    els.logoutButton.classList.remove("hidden");
  } else {
    els.accountStatus.textContent = requireLogin ? "请先登录 GitHub" : state.syncReady ? "未登录 · 本地进度" : "本地模式";
    els.loginButton.classList.remove("hidden");
    els.logoutButton.classList.add("hidden");
  }
}

async function loadRemoteSession() {
  try {
    const session = await apiFetch("/me");
    state.syncReady = true;
    state.user = session.user || null;
    if (state.user) {
      const remote = await apiFetch("/progress");
      state.progress = remote.progress || {};
      if (!requireLogin) {
        localStorage.setItem(storageKey, JSON.stringify(state.progress));
      }
    } else if (requireLogin) {
      state.progress = {};
    }
  } catch {
    state.syncReady = false;
    state.user = null;
    if (requireLogin) {
      state.progress = {};
    }
  }

  renderAccount();
  render();
}

function queueRemoteProgressSave() {
  if (!state.user) return;
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(async () => {
    try {
      await apiFetch("/progress", {
        method: "PUT",
        body: JSON.stringify({ progress: state.progress }),
      });
      renderAccount();
    } catch {
      els.accountStatus.textContent = `${state.user.login} · 同步失败`;
    }
  }, 350);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .replace(/[，。；：、\s]/g, "")
    .replace(/[()（）]/g, "")
    .toLowerCase();
}

function getStatus(id) {
  if (requireLogin && !state.user) return "new";
  return state.progress[id] || "new";
}

function setStatus(status) {
  if (!canAnswer()) {
    showLoginRequired();
    return;
  }
  const item = state.filtered[state.current]?.question;
  if (!item) return;
  state.progress[item.id] = status;
  saveProgress();
  render();
}

function summarize(text) {
  return text.replace(/\s+/g, " ").slice(0, 82);
}

function getCurrentQuestion() {
  return state.filtered[state.current]?.question || null;
}

function canAnswer() {
  return !requireLogin || Boolean(state.user);
}

function showLoginRequired() {
  els.checkSummary.textContent = "需登录";
  els.checkMessage.textContent = "请先使用 GitHub 登录，登录后才能填写、判题和保存个人进度。";
  els.checkMessage.className = "check-message wrong";
}

function parseFillAnswers(answer) {
  const found = [...answer.matchAll(/(?:^|\n)\s*[（(](\d+)[）)]\s*([^\n]+)/g)];
  if (found.length) {
    return found.map((match) => ({ key: match[1], value: match[2].trim() }));
  }
  return answer
    .split(/\n+/)
    .filter(Boolean)
    .map((value, index) => ({ key: String(index + 1), value: value.trim() }));
}

function parseChoiceOptions(prompt) {
  const lines = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const options = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-D])[\.\．、]\s*(.*)$/);
    if (!match) continue;

    const inlineLabel = match[2].trim();
    const nextLine = lines[index + 1] && !/^[A-D][\.\．、]/.test(lines[index + 1]) ? lines[index + 1] : "";
    options.push({ key: match[1], label: inlineLabel || nextLine });
  }

  return options;
}

function getChoiceAnswer(answer) {
  const match = answer.match(/[A-D]/i);
  return match ? match[0].toUpperCase() : normalizeAnswer(answer).toUpperCase();
}

function getDraft(question) {
  if (!canAnswer()) {
    return question.type === "填空" ? {} : "";
  }
  if (!state.drafts[question.id]) {
    state.drafts[question.id] = question.type === "填空" ? {} : "";
  }
  return state.drafts[question.id];
}

function rememberDraft(question) {
  if (!canAnswer()) return;
  if (question.type === "填空") {
    const values = {};
    els.answerInputs.querySelectorAll("[data-blank]").forEach((input) => {
      values[input.dataset.blank] = input.value;
    });
    state.drafts[question.id] = values;
    return;
  }

  if (question.type === "单选" || question.type === "判断") {
    const checked = els.answerInputs.querySelector("input:checked");
    state.drafts[question.id] = checked ? checked.value : "";
    return;
  }

  const textarea = els.answerInputs.querySelector("textarea");
  state.drafts[question.id] = textarea ? textarea.value : "";
}

function renderAnswerInputs(question) {
  if (!canAnswer()) {
    els.checkSummary.textContent = "需登录";
    els.checkMessage.textContent = "登录后可以填写答案、提交判题，并把进度保存到自己的 GitHub 账号。";
    els.checkMessage.className = "check-message";
    els.answerInputs.innerHTML = `
      <div class="login-required">
        <p>当前为未登录状态，作答区已锁定。</p>
        <button class="primary-button" data-login-prompt type="button">GitHub 登录后答题</button>
      </div>
    `;
    return;
  }

  const draft = getDraft(question);
  els.checkSummary.textContent = "";
  els.checkMessage.textContent = "";
  els.checkMessage.className = "check-message";

  if (question.type === "填空") {
    const answers = parseFillAnswers(question.answer);
    els.answerInputs.innerHTML = `
      <div class="blank-grid">
        ${answers
          .map(
            (item) => `
              <label class="blank-input">
                <span>空 (${escapeHtml(item.key)})</span>
                <input data-blank="${escapeHtml(item.key)}" value="${escapeHtml(draft[item.key] || "")}" autocomplete="off" />
              </label>
            `,
          )
          .join("")}
      </div>
    `;
    return;
  }

  if (question.type === "单选") {
    const options = parseChoiceOptions(question.prompt);
    els.answerInputs.innerHTML = `
      <div class="choice-grid">
        ${options
          .map(
            (option) => `
              <label class="choice-option">
                <input type="radio" name="choice" value="${option.key}" ${draft === option.key ? "checked" : ""} />
                <span><strong>${option.key}</strong>${escapeHtml(option.label)}</span>
              </label>
            `,
          )
          .join("")}
      </div>
    `;
    return;
  }

  if (question.type === "判断") {
    els.answerInputs.innerHTML = `
      <div class="choice-grid two">
        ${["对", "错"]
          .map(
            (value) => `
              <label class="choice-option">
                <input type="radio" name="judge" value="${value}" ${draft === value ? "checked" : ""} />
                <span><strong>${value}</strong></span>
              </label>
            `,
          )
          .join("")}
      </div>
    `;
    return;
  }

  els.answerInputs.innerHTML = `
    <textarea class="short-answer" placeholder="先按自己的话写一遍，再提交查看与参考答案的匹配提示。">${escapeHtml(draft || "")}</textarea>
  `;
}

function showCheckResult(question, result) {
  const detail = result.details?.length ? `：${result.details.join("，")}` : "";
  els.checkSummary.textContent = result.summary;
  els.checkMessage.textContent = `${result.message}${detail}`;
  els.checkMessage.className = `check-message ${result.correct ? "correct" : "wrong"}`;
  state.checks[question.id] = result;
}

function checkFill(question) {
  const answers = parseFillAnswers(question.answer);
  const draft = getDraft(question);
  const wrong = [];
  let correct = 0;

  answers.forEach((item) => {
    if (normalizeAnswer(draft[item.key]) === normalizeAnswer(item.value)) {
      correct += 1;
    } else {
      wrong.push(`空(${item.key})`);
    }
  });

  const allCorrect = correct === answers.length;
  return {
    correct: allCorrect,
    summary: `${correct}/${answers.length}`,
    message: allCorrect ? "全部正确" : "还有空需要改",
    details: wrong,
  };
}

function checkChoice(question) {
  const draft = getDraft(question);
  const answer = getChoiceAnswer(question.answer);
  const correct = draft === answer;
  return {
    correct,
    summary: correct ? "正确" : "错误",
    message: correct ? "选对了" : `你的选择是 ${draft || "未选择"}，正确答案是 ${answer}`,
  };
}

function checkJudge(question) {
  const draft = getDraft(question);
  const answer = question.answer.includes("对") ? "对" : "错";
  const correct = draft === answer;
  return {
    correct,
    summary: correct ? "正确" : "错误",
    message: correct ? "判断正确" : `你的判断是 ${draft || "未选择"}，正确答案是 ${answer}`,
  };
}

function checkShortAnswer(question) {
  const draft = normalizeAnswer(getDraft(question));
  const terms = question.answer
    .split(/[，。、；;：:\n\s]+/)
    .map((item) => normalizeAnswer(item))
    .filter((item) => item.length >= 2 && !/^\d+$/.test(item));
  const uniqueTerms = [...new Set(terms)].slice(0, 10);
  const hits = uniqueTerms.filter((term) => draft.includes(term));
  const ratio = uniqueTerms.length ? hits.length / uniqueTerms.length : 0;

  return {
    correct: ratio >= 0.6,
    summary: `${hits.length}/${uniqueTerms.length}`,
    message:
      ratio >= 0.6
        ? "关键词匹配较好，建议再对照参考答案润色"
        : "关键词匹配偏少，建议打开参考答案补充要点",
    details: hits.length ? [`命中：${hits.join(" / ")}`] : [],
  };
}

function checkCurrentAnswer() {
  if (!canAnswer()) {
    showLoginRequired();
    return;
  }
  const question = getCurrentQuestion();
  if (!question) return;
  rememberDraft(question);

  let result;
  if (question.type === "填空") result = checkFill(question);
  else if (question.type === "单选") result = checkChoice(question);
  else if (question.type === "判断") result = checkJudge(question);
  else result = checkShortAnswer(question);

  if (result.correct) {
    state.progress[question.id] = "known";
  } else {
    state.progress[question.id] = "review";
  }
  saveProgress();
  showCheckResult(question, result);
  buildStats();
  renderList();
}

function buildStats() {
  const known = bank.questions.filter((question) => getStatus(question.id) === "known").length;
  const review = bank.questions.filter((question) => getStatus(question.id) === "review").length;
  const stats = [
    ["总题数", bank.total],
    ["已掌握", known],
    ["待复习", review],
    ["题型数", Object.keys(bank.typeCounts).length],
  ];

  els.stats.innerHTML = stats
    .map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function buildTypeFilters() {
  const types = ["全部", ...Object.keys(bank.typeCounts)];
  els.typeFilters.innerHTML = types
    .map((type) => {
      const count = type === "全部" ? bank.total : bank.typeCounts[type];
      return `<button class="segment ${type === state.activeType ? "active" : ""}" data-type="${type}" type="button">${type} ${count}</button>`;
    })
    .join("");
}

function applyFilters() {
  const keyword = state.search.trim().toLowerCase();
  state.filtered = bank.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => {
      const typeOk = state.activeType === "全部" || question.type === state.activeType;
      const status = getStatus(question.id);
      const stateOk = state.activeState === "all" || status === state.activeState;
      const haystack = `${question.prompt}\n${question.answer}\n${question.section}\n${question.type}`.toLowerCase();
      const searchOk = !keyword || haystack.includes(keyword);
      return typeOk && stateOk && searchOk;
    });

  if (state.current >= state.filtered.length) {
    state.current = Math.max(0, state.filtered.length - 1);
  }
}

function renderCurrentQuestion() {
  const entry = state.filtered[state.current];
  if (!entry) {
    els.questionType.textContent = "没有匹配题目";
    els.questionIndex.textContent = "0 / 0";
    els.questionTitle.textContent = "换一个搜索词或筛选条件试试";
    els.questionPrompt.textContent = "";
    els.questionAnswer.textContent = "";
    els.answerInputs.innerHTML = "";
    els.checkSummary.textContent = "";
    els.checkMessage.textContent = "";
    els.answerPanel.classList.remove("visible");
    els.progressBar.style.width = "0%";
    updateLockedActions();
    return;
  }

  const { question, index } = entry;
  els.questionType.textContent = `${question.type}题 · ${question.score}分`;
  els.questionIndex.textContent = `${state.current + 1} / ${state.filtered.length}`;
  els.questionTitle.textContent = `${question.section} · 第 ${question.number} 题`;
  els.questionPrompt.textContent = question.prompt;
  els.questionAnswer.textContent = question.answer || "暂无答案";
  els.answerPanel.classList.remove("visible");
  els.revealButton.textContent = "显示答案";
  els.progressBar.style.width = `${((index + 1) / bank.total) * 100}%`;
  renderAnswerInputs(question);

  const previousCheck = state.checks[question.id];
  if (previousCheck) showCheckResult(question, previousCheck);
  updateLockedActions();
}

function updateLockedActions() {
  const locked = !canAnswer();
  els.checkButton.disabled = locked;
  els.revealButton.disabled = locked;
  els.reviewButton.disabled = locked;
  els.knownButton.disabled = locked;
  els.resetButton.disabled = locked;
}

function renderList() {
  els.resultCount.textContent = `${state.filtered.length} 题`;
  els.questionList.innerHTML = state.filtered
    .map(({ question }, visibleIndex) => {
      const status = getStatus(question.id);
      const statusClass = status === "known" || status === "review" ? status : "";
      const active = visibleIndex === state.current ? "active" : "";
      const label = requireLogin && !state.user ? "登录后记录" : status === "known" ? "已掌握" : status === "review" ? "待复习" : "未标记";
      return `
        <button class="question-row ${active} ${statusClass}" data-index="${visibleIndex}" type="button">
          <span class="row-meta">${question.type}题 · 第 ${question.number} 题 · ${label}</span>
          <span class="row-title">${escapeHtml(summarize(question.prompt))}</span>
        </button>
      `;
    })
    .join("");
}

function render() {
  buildStats();
  buildTypeFilters();
  applyFilters();
  renderCurrentQuestion();
  renderList();
}

function move(delta) {
  const question = getCurrentQuestion();
  if (question) rememberDraft(question);
  if (!state.filtered.length) return;
  state.current = (state.current + delta + state.filtered.length) % state.filtered.length;
  render();
}

els.sourceLabel.textContent = `${bank.source} · ${bank.total} 题`;

els.loginButton.addEventListener("click", () => {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${apiBase}/auth/login?returnTo=${returnTo}`;
});

els.logoutButton.addEventListener("click", async () => {
  try {
    await apiFetch("/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // Keep local progress even if the network call fails.
  }
  state.user = null;
  if (requireLogin) {
    state.progress = {};
    state.drafts = {};
    state.checks = {};
  }
  renderAccount();
  render();
});

els.answerForm.addEventListener("click", (event) => {
  const button = event.target.closest("[data-login-prompt]");
  if (!button) return;
  els.loginButton.click();
});

els.answerForm.addEventListener("input", () => {
  const question = getCurrentQuestion();
  if (question) rememberDraft(question);
});

els.answerForm.addEventListener("change", () => {
  const question = getCurrentQuestion();
  if (question) rememberDraft(question);
});

els.typeFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-type]");
  if (!button) return;
  const question = getCurrentQuestion();
  if (question) rememberDraft(question);
  state.activeType = button.dataset.type;
  state.current = 0;
  render();
});

els.stateFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-state]");
  if (!button) return;
  const question = getCurrentQuestion();
  if (question) rememberDraft(question);
  state.activeState = button.dataset.state;
  els.stateFilters.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  state.current = 0;
  render();
});

els.searchInput.addEventListener("input", (event) => {
  const question = getCurrentQuestion();
  if (question) rememberDraft(question);
  state.search = event.target.value;
  state.current = 0;
  render();
});

els.questionList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-index]");
  if (!row) return;
  const question = getCurrentQuestion();
  if (question) rememberDraft(question);
  state.current = Number(row.dataset.index);
  render();
});

els.checkButton.addEventListener("click", checkCurrentAnswer);

els.revealButton.addEventListener("click", () => {
  const visible = els.answerPanel.classList.toggle("visible");
  els.revealButton.textContent = visible ? "隐藏答案" : "显示答案";
});

els.reviewButton.addEventListener("click", () => setStatus("review"));
els.knownButton.addEventListener("click", () => setStatus("known"));
els.prevButton.addEventListener("click", () => move(-1));
els.nextButton.addEventListener("click", () => move(1));

els.shuffleButton.addEventListener("click", () => {
  const question = getCurrentQuestion();
  if (question) rememberDraft(question);
  if (!state.filtered.length) return;
  state.current = Math.floor(Math.random() * state.filtered.length);
  render();
});

els.resetButton.addEventListener("click", () => {
  if (!canAnswer()) {
    showLoginRequired();
    return;
  }
  state.progress = {};
  state.checks = {};
  saveProgress();
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea")) return;
  if (event.key === "ArrowLeft") move(-1);
  if (event.key === "ArrowRight") move(1);
  if (event.key === " ") {
    event.preventDefault();
    els.revealButton.click();
  }
  if (event.key === "Enter") {
    event.preventDefault();
    checkCurrentAnswer();
  }
});

function drawNetwork() {
  const canvas = document.querySelector("#networkCanvas");
  const context = canvas.getContext("2d");
  const nodes = [
    [44, 112],
    [92, 42],
    [162, 78],
    [226, 36],
    [278, 108],
  ];
  let frame = 0;

  function draw() {
    frame += 0.018;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 2;
    context.strokeStyle = "#7aa9a1";
    context.fillStyle = "#0f766e";

    for (let index = 0; index < nodes.length - 1; index += 1) {
      const [x1, y1] = nodes[index];
      const [x2, y2] = nodes[index + 1];
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();

      const t = (Math.sin(frame + index) + 1) / 2;
      context.beginPath();
      context.arc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 3, 0, Math.PI * 2);
      context.fill();
    }

    nodes.forEach(([x, y], index) => {
      context.beginPath();
      context.fillStyle = index % 2 ? "#a85518" : "#0f766e";
      context.arc(x, y, 10, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "bold 10px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), x, y);
    });

    requestAnimationFrame(draw);
  }

  draw();
}

drawNetwork();
render();
loadRemoteSession();

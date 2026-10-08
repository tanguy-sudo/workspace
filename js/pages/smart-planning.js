// @ts-check
// ── pages/smart-planning.js ──

// ── État de session ──────────────────────────────────────
let _sessionDoneIds = new Set();

// ── Persistance ──────────────────────────────────────────
const PLAN_STORAGE_KEY = "workspace-smart-plan";

function _parseAvailableMinutes(value) {
  if (typeof parseEstimatedTimeExpression === "function") {
    return parseEstimatedTimeExpression(value);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { valid: false, minutes: 0 };
  return { valid: true, minutes: Math.floor(n) };
}

function _refreshAvailableTimeHint() {
  const inputEl = document.getElementById("p-time");
  const hintEl = document.getElementById("p-time-hint");
  if (!inputEl || !hintEl) return;

  const raw = inputEl.value || "";
  if (!raw.trim()) {
    hintEl.textContent = "Minutes directes ou formule (ex: 60*5).";
    hintEl.style.color = "var(--text-3)";
    return;
  }

  const parsed = _parseAvailableMinutes(raw);
  if (!parsed.valid) {
    hintEl.textContent = "Formule invalide. Formats: 90, 60*5, (45+30).";
    hintEl.style.color = "var(--error)";
    return;
  }

  hintEl.textContent = `= ${parsed.minutes} min`;
  hintEl.style.color = "var(--success)";
}

function _bindAvailableTimeHint() {
  const inputEl = document.getElementById("p-time");
  if (!inputEl) return;
  inputEl.addEventListener("input", _refreshAvailableTimeHint);
  _refreshAvailableTimeHint();
}

function _readPlanStateRaw() {
  const state = safeJsonParse(safeStorageGet(PLAN_STORAGE_KEY, null), null);
  return state && typeof state === "object" ? state : null;
}

function _savePlanState(params, planIds) {
  try {
    safeStorageSet(
      PLAN_STORAGE_KEY,
      JSON.stringify({
        params,
        planIds,
        doneIds: [..._sessionDoneIds],
        savedAt: new Date().toISOString(),
      }),
    );
  } catch (_) { /* stockage plein ou indisponible */ }
}

function _loadPlanState() {
  return _readPlanStateRaw();
}

function _clearPlanState() {
  safeStorageRemove(PLAN_STORAGE_KEY);
}

/** Met à jour uniquement les doneIds dans l'état déjà sauvegardé. */
function _patchSavedDoneIds(doneIds) {
  const state = _readPlanStateRaw();
  if (!state) return;
  try {
    state.doneIds = doneIds;
    safeStorageSet(PLAN_STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

function _restorePlanIfSaved() {
  const saved = _loadPlanState();
  if (!saved || !saved.planIds?.length) return;

  // Restaurer les paramètres du formulaire
  const { params } = saved;
  const timeEl = document.getElementById("p-time");
  if (timeEl) timeEl.value = params.minutes ?? "";
  _refreshAvailableTimeHint();

  const ctxEl = document.getElementById("p-context");
  if (ctxEl) ctxEl.value = params.context ?? "";

  const dateEl = document.getElementById("p-date");
  if (dateEl) dateEl.value = params.dateFilter ?? "all";

  const projEl = document.getElementById("p-project");
  if (projEl) projEl.value = params.projectId ?? "";

  const modeRadio = document.querySelector(
    `input[name='p-mode'][value='${params.mode ?? "balanced"}']`,
  );
  if (modeRadio) modeRadio.checked = true;

  // Restaurer les tâches terminées de la session
  _sessionDoneIds = new Set(saved.doneIds ?? []);

  // Reconstruire la liste depuis les IDs persistés
  // (on filtre les tâches réellement supprimées entre-temps)
  const allTodos = getTodos();
  const plan = saved.planIds
    .map((id) => allTodos.find((t) => t.id === id))
    .filter(Boolean);

  if (!plan.length) { _clearPlanState(); return; }

  // Badge discret indiquant que le plan est restauré
  const savedAt = new Date(saved.savedAt);
  const isToday =
    savedAt.toDateString() === new Date().toDateString();
  const label = isToday
    ? "aujourd'hui à " + savedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "le " + savedAt.toLocaleDateString("fr-FR");

  renderPlan(plan, params.minutes, params.context, params.mode, label);
}

bootPage(() => {
  initPageCommon();

  renderContextOptions();
  renderProjectOptions();
  _bindAvailableTimeHint();
  document.getElementById("btn-plan").addEventListener("click", runPlan);
  document.getElementById("btn-reset")?.addEventListener("click", resetPlan);

  _restorePlanIfSaved();
  _refreshAvailableTimeHint();
});

// ── Remplissage des selects ──────────────────────────────

function renderContextOptions() {
  const sel = document.getElementById("p-context");
  if (!sel) return;
  const contexts = [
    ...new Set(getTodos().map((t) => t.context).filter(Boolean)),
  ];
  sel.innerHTML = '<option value="">Peu importe</option>';
  contexts.forEach((c) => {
    const opt = el("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

function renderProjectOptions() {
  const sel = document.getElementById("p-project");
  if (!sel) return;
  const projects = typeof getProjects === "function" ? getProjects() : [];
  const fieldWrap = sel.closest(".field");
  if (!projects.length) {
    if (fieldWrap) fieldWrap.style.display = "none";
    return;
  }
  sel.innerHTML = '<option value="">Tous les projets</option>';
  projects.forEach((p) => {
    const opt = el("option");
    opt.value = p.id || p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

// ── Lancement / réinitialisation ─────────────────────────

function runPlan() {
  const rawMinutes = document.getElementById("p-time")?.value || "";
  const parsedMinutes = _parseAvailableMinutes(rawMinutes);
  const minutes    = parsedMinutes.minutes;
  const context    = document.getElementById("p-context")?.value   || "";
  const mode       = document.querySelector("input[name='p-mode']:checked")?.value || "balanced";
  const dateFilter = document.getElementById("p-date")?.value      || "all";
  const projectId  = document.getElementById("p-project")?.value   || "";

  if (rawMinutes.trim() && !parsedMinutes.valid) {
    showToast("Temps disponible invalide. Exemples: 90, 60*5, (45+30)");
    return;
  }

  if (!minutes) {
    showToast("Indique un temps disponible");
    return;
  }

  // Nouvelle génération → réinitialiser les terminées de session
  _sessionDoneIds = new Set();

  const params = { minutes, context, mode, dateFilter, projectId };
  const plan   = computeSmartPlan(minutes, context, mode, dateFilter, projectId);

  _savePlanState(params, plan.map((t) => t.id));
  renderPlan(plan, minutes, context, mode);
}

function resetPlan() {
  const resultEl = document.getElementById("plan-result");
  if (resultEl) resultEl.style.display = "none";
  _sessionDoneIds = new Set();
  _clearPlanState();
  _updateSessionCounter();
}

// ── Rendu du résultat ────────────────────────────────────

function renderPlan(plan, availableMinutes, context, mode, restoredLabel = null) {
  document.getElementById("plan-result").style.display = "block";

  const totalMins = plan
    .filter((t) => !_sessionDoneIds.has(t.id))
    .reduce((s, t) => s + (t.estimatedTime || 0), 0);

  _renderTimeBar(totalMins, availableMinutes);

  if (!plan.length) {
    document.getElementById("plan-summary").innerHTML =
      `<span>Aucune tâche disponible pour ce créneau.</span>`;
    document.getElementById("plan-list").innerHTML = "";
    return;
  }

  const modeLabel = {
    balanced: "équilibré",
    focus:    "focus",
    sprint:   "sprint",
  }[mode] || mode;

  const allMins = plan.reduce((s, t) => s + (t.estimatedTime || 0), 0);

  const restoredBadge = restoredLabel
    ? ` <span class="plan-restored-badge" title="Plan restauré automatiquement">↩ restauré ${escHtml(restoredLabel)}</span>`
    : "";

  document.getElementById("plan-summary").innerHTML =
    `<strong>${plan.length}</strong> tâche${plan.length > 1 ? "s" : ""}` +
    ` · <strong>${formatTime(allMins) || "temps variable"}</strong> estimé` +
    ` · mode <strong>${modeLabel}</strong>` +
    (context ? ` · contexte <strong>${escHtml(context)}</strong>` : "") +
    restoredBadge;

  const listEl = document.getElementById("plan-list");
  listEl.innerHTML = "";
  plan.forEach((todo, i) => listEl.appendChild(_buildTaskCard(todo, i)));

  _updateSessionCounter();
}

function _buildTaskCard(todo, i) {
  const card = el("div", "plan-task-card");
  card.dataset.todoId = todo.id;
  card.style.animationDelay = `${i * 50}ms`;

  const isDone = _sessionDoneIds.has(todo.id);
  if (isDone) card.classList.add("plan-task-done");

  const num  = el("div", "plan-task-number", String(i + 1));
  const body = el("div", "plan-task-body");

  body.innerHTML = `<div class="plan-task-title">${escHtml(todo.title)}</div>`;

  const meta = el("div", "plan-task-meta");
  meta.appendChild(createPriorityChip(todo.priorityId));

  if (todo.estimatedTime) {
    const t = el("span", "time-chip");
    t.innerHTML = IC.clock + formatTime(todo.estimatedTime);
    meta.appendChild(t);
  }
  if (todo.context) {
    meta.appendChild(el("span", "context-chip", escHtml(todo.context)));
  }
  if (todo.dueDate) {
    const chip = el("span", "due-chip");
    chip.textContent = "📅 " + todo.dueDate;
    meta.appendChild(chip);
  }
  body.appendChild(meta);

  if (!isDone) {
    const btn = el("button", "btn btn-success btn-sm");
    btn.style.marginTop = "8px";
    btn.innerHTML = IC.check + " Marquer terminée";
    btn.addEventListener("click", () => {
      updateTodo(todo.id, { status: "done" });
      _sessionDoneIds.add(todo.id);
      card.classList.add("plan-task-done");
      btn.remove();
      showToast("Tâche terminée !", "success");
      _updateSessionCounter();
      _rerenderTimeBar();
      // Persister les terminées pour la restauration
      _patchSavedDoneIds([..._sessionDoneIds]);
    });
    body.appendChild(btn);
  }

  card.appendChild(num);
  card.appendChild(body);
  return card;
}

// ── Barre de temps ───────────────────────────────────────

function _renderTimeBar(usedMins, availMins) {
  const wrap = document.getElementById("plan-time-bar-wrap");
  if (!wrap) return;
  wrap.style.display = "block";

  const pct       = availMins > 0 ? Math.min(100, (usedMins / availMins) * 100) : 0;
  const remaining = Math.max(0, availMins - usedMins);
  const color     = pct > 95
    ? "var(--success)"
    : pct > 70
      ? "var(--warning, #f0a030)"
      : "var(--accent)";

  wrap.innerHTML = `
    <div class="plan-timebar-labels">
      <span>${formatTime(usedMins)} planifiés</span>
      <span class="plan-timebar-remaining">
        ${remaining > 0
          ? `${formatTime(remaining)} restant sur ${formatTime(availMins)}`
          : `Créneau optimisé à 100%`}
      </span>
    </div>
    <div class="plan-timebar" role="progressbar"
         aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100">
      <div class="plan-timebar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
    </div>`;
}

function _rerenderTimeBar() {
  const raw = document.getElementById("p-time")?.value || "";
  const parsed = _parseAvailableMinutes(raw);
  const availMins = parsed.valid ? parsed.minutes : 0;
  const todos     = getTodos();
  let used = 0;
  document.querySelectorAll(".plan-task-card:not(.plan-task-done)").forEach((card) => {
    const todo = todos.find((t) => t.id === card.dataset.todoId);
    if (todo) used += todo.estimatedTime || 0;
  });
  _renderTimeBar(used, availMins);
}

// ── Compteur de session ──────────────────────────────────

function _updateSessionCounter() {
  const ctr = document.getElementById("session-counter");
  if (!ctr) return;
  const n = _sessionDoneIds.size;
  ctr.style.display = n > 0 ? "inline-flex" : "none";
  ctr.textContent = `✓ ${n} terminée${n > 1 ? "s" : ""} cette session`;
}

// ── Algorithme de planification ──────────────────────────

function computeSmartPlan(
  availableMinutes,
  context    = "",
  mode       = "balanced",
  dateFilter = "all",
  projectId  = "",
) {
  const today   = new Date();
  const todayStr= today.toISOString().slice(0, 10);
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const doneTodoIds = getTodos()
    .filter((t) => t.status === "done")
    .map((t) => t.id);

  let candidates = getTodos().filter((t) => {
    if (t.status === "done") return false;
    // Dépendances non résolues
    if ((t.dependencies || []).some((depId) => !doneTodoIds.includes(depId)))
      return false;
    // Contexte
    if (context && t.context && t.context !== context) return false;
    // Filtre date
    if (dateFilter === "today" && t.dueDate !== todayStr) return false;
    if (dateFilter === "week"  && (!t.dueDate || t.dueDate > weekEndStr)) return false;
    // Projet
    if (projectId && t.projectId && t.projectId !== projectId) return false;
    return true;
  });

  const prioOrder = getTodoPriorities().map((p) => p.id);
  const byPrio    = (a, b) =>
    prioOrder.indexOf(a.priorityId) - prioOrder.indexOf(b.priorityId);

  // ── Mode FOCUS : une seule tâche haute priorité ──────
  if (mode === "focus") {
    candidates.sort(byPrio);
    const best = candidates.find(
      (t) => !t.estimatedTime || t.estimatedTime <= availableMinutes,
    );
    return best ? [best] : [];
  }

  // ── Mode SPRINT : maximum de tâches courtes ──────────
  if (mode === "sprint") {
    const withTime = candidates
      .filter((t) => t.estimatedTime > 0)
      .sort((a, b) =>
        a.estimatedTime !== b.estimatedTime
          ? a.estimatedTime - b.estimatedTime
          : byPrio(a, b),
      );
    const withoutTime = candidates.filter((t) => !t.estimatedTime);
    const plan = [];
    let remaining = availableMinutes;
    for (const todo of withTime) {
      if (todo.estimatedTime <= remaining) {
        plan.push(todo);
        remaining -= todo.estimatedTime;
        if (remaining <= 0) break;
      }
    }
    // Tâches sans durée estimée en bonus (max 2)
    withoutTime.slice(0, 2).forEach((t) => plan.push(t));
    return plan;
  }

  // ── Mode BALANCED (défaut) ───────────────────────────
  // Priorité d'abord, puis temps croissant ; tâches sans durée en dernier
  candidates.sort((a, b) => {
    const pp = byPrio(a, b);
    if (pp !== 0) return pp;
    return (a.estimatedTime || 0) - (b.estimatedTime || 0);
  });

  const plan        = [];
  const withoutTime = [];
  let remaining     = availableMinutes;

  for (const todo of candidates) {
    const t = todo.estimatedTime || 0;
    if (t === 0) {
      withoutTime.push(todo);
    } else if (t <= remaining) {
      plan.push(todo);
      remaining -= t;
      if (remaining <= 0) break;
    }
  }
  // Ajouter des tâches sans durée si du temps reste (max 2)
  if (remaining > 0) {
    withoutTime.slice(0, 2).forEach((t) => plan.push(t));
  }
  return plan;
}

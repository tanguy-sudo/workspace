// @ts-check
// ── pages/home.js ──

bootPage(() => {
  initPageCommon();
  document
    .getElementById("btn-new-reminder")
    ?.addEventListener("click", () => openReminderModal());
  document
    .getElementById("btn-complete-review")
    ?.addEventListener("click", () => {
      updateWeeklyReviewState({ lastCompletedWeek: _getCurrentWeekKey() });
      renderWeeklyReview();
      showToast("Revue hebdomadaire marquée comme faite");
    });
  document
    .getElementById("btn-generate-review-task")
    ?.addEventListener("click", _createWeeklyReviewTodo);
  initHero();
  renderReminders();
  scheduleReminderNotifications();
  renderOrganizationHealth();
  renderWeeklyReview();
  renderRecent();
});

const RECENT_ROWS_COLLAPSED = 1;
const RECENT_ROWS_EXPANDED = 3;
let _recentExpanded = false;

function _getCurrentWeekKey(date = new Date()) {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((current - yearStart) / 86400000) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function _walkProjectItems(projects) {
  const items = [];
  const visit = (children) => {
    (children || []).forEach((child) => {
      if (child?.nodeType === "item") items.push(child);
      if (child?.nodeType === "folder") visit(child.children || []);
    });
  };
  projects.forEach((project) => visit(project.children || []));
  return items;
}

function _walkRhDocuments(root) {
  const docs = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === "document") docs.push(node);
    (node.children || []).forEach(visit);
  };
  visit(root);
  return docs;
}

function _getOrganizationHealthData() {
  const now = Date.now();
  const staleThreshold = now - 21 * 864e5;
  const activeTodos = getTodos().filter((todo) => todo.status !== "done");
  const projects = getProjects().filter((project) => !project.archived);
  const projectItems = _walkProjectItems(projects);
  const rhDocs = _walkRhDocuments(getRhRoot());
  const snippets = getSnippets();

  return {
    activeTodosWithoutProject: activeTodos.filter((todo) => !todo.projectId).length,
    projectsWithoutCategory: projects.filter((project) => !(project.categories || []).length).length,
    waitingInfoTodos: activeTodos.filter((todo) => todo.status === "waitinginfo").length,
    staleProjects: projects.filter((project) => (project.lastVisited || project.createdAt || 0) < staleThreshold).length,
    taglessContent: [
      ...projectItems.filter((item) => !(item.tags || []).length),
      ...rhDocs.filter((doc) => !(doc.tags || []).length),
      ...snippets.filter((snippet) => !(snippet.tags || []).length),
    ].length,
  };
}

function renderOrganizationHealth() {
  const grid = document.getElementById("organization-health-grid");
  const section = document.getElementById("section-organization-health");
  if (!grid || !section) return;

  const stats = _getOrganizationHealthData();
  const cards = [
    {
      count: stats.activeTodosWithoutProject,
      label: "tâches sans projet",
      hint: "Traite l'inbox avant qu'elle grossisse.",
      href: "todos.html?project=none",
      tone: stats.activeTodosWithoutProject ? "warn" : "ok",
    },
    {
      count: stats.projectsWithoutCategory,
      label: "projets sans catégorie",
      hint: "Ajoute une catégorie pour fiabiliser le classement.",
      href: "projects.html",
      tone: stats.projectsWithoutCategory ? "warn" : "ok",
    },
    {
      count: stats.waitingInfoTodos,
      label: "tâches en attente d'info",
      hint: "Relance ou note l'information manquante.",
      href: "todos.html?status=waitinginfo",
      tone: stats.waitingInfoTodos ? "warn" : "ok",
    },
    {
      count: stats.staleProjects,
      label: "projets dormants (> 21 j)",
      hint: "Vérifie s'ils sont encore actifs ou à archiver.",
      href: "projects.html",
      tone: stats.staleProjects ? "warn" : "ok",
    },
    {
      count: stats.taglessContent,
      label: "contenus sans tag",
      hint: "Ajoute quelques tags transverses pour accélérer la recherche.",
      href: "snippets.html",
      tone: stats.taglessContent ? "warn" : "ok",
    },
  ];

  section.style.display = "";
  grid.innerHTML = cards.map((card) => `
    <a class="organization-card ${card.tone}" href="${card.href}">
      <span class="organization-card-count">${card.count}</span>
      <span class="organization-card-label">${card.label}</span>
      <span class="organization-card-hint">${card.hint}</span>
    </a>`).join("");
}

function _buildWeeklyReviewItems(stats) {
  const items = [];
  if (stats.activeTodosWithoutProject) {
    items.push({
      title: `Classer ${stats.activeTodosWithoutProject} tâche${stats.activeTodosWithoutProject > 1 ? "s" : ""} sans projet`,
      detail: "Affecte-les à un projet ou garde une vraie inbox courte.",
      href: "todos.html?project=none",
    });
  }
  if (stats.projectsWithoutCategory) {
    items.push({
      title: `Qualifier ${stats.projectsWithoutCategory} projet${stats.projectsWithoutCategory > 1 ? "s" : ""} sans catégorie`,
      detail: "Une catégorie par projet suffit pour rendre les vues cohérentes.",
      href: "projects.html",
    });
  }
  if (stats.waitingInfoTodos) {
    items.push({
      title: `Relancer ${stats.waitingInfoTodos} tâche${stats.waitingInfoTodos > 1 ? "s" : ""} en attente d'info`,
      detail: "Décide si la prochaine action est une relance, une note ou une clôture.",
      href: "todos.html?status=waitinginfo",
    });
  }
  if (stats.staleProjects) {
    items.push({
      title: `Réévaluer ${stats.staleProjects} projet${stats.staleProjects > 1 ? "s" : ""} dormant${stats.staleProjects > 1 ? "s" : ""}`,
      detail: "Archive, relance ou réorganise les projets qui n'avancent plus.",
      href: "projects.html",
    });
  }
  if (stats.taglessContent) {
    items.push({
      title: `Tagger ${stats.taglessContent} contenu${stats.taglessContent > 1 ? "s" : ""} non qualifié${stats.taglessContent > 1 ? "s" : ""}`,
      detail: "Commence par quelques tags stables: accès, batch, doc, compte, prod.",
      href: "snippets.html",
    });
  }
  if (!items.length) {
    items.push({
      title: "Aucun point bloquant cette semaine",
      detail: "Le workspace est propre. Fais juste un passage rapide sur les tâches actives.",
      href: "todos.html",
      ok: true,
    });
  }
  return items;
}

function renderWeeklyReview() {
  const statusEl = document.getElementById("weekly-review-status");
  const list = document.getElementById("weekly-review-list");
  const completeBtn = document.getElementById("btn-complete-review");
  if (!statusEl || !list || !completeBtn) return;

  const stats = _getOrganizationHealthData();
  const items = _buildWeeklyReviewItems(stats);
  const weekKey = _getCurrentWeekKey();
  const state = getWeeklyReviewState();
  const done = state.lastCompletedWeek === weekKey;

  statusEl.textContent = done
    ? `Revue marquée comme faite pour ${weekKey}`
    : `Revue à faire pour ${weekKey}`;
  completeBtn.textContent = done ? "Revue faite cette semaine" : "Marquer faite";
  completeBtn.disabled = done;

  list.innerHTML = items.map((item) => `
    <a class="weekly-review-item${item.ok ? " ok" : ""}" href="${item.href}">
      <span class="weekly-review-item-title">${escHtml(item.title)}</span>
      <span class="weekly-review-item-detail">${escHtml(item.detail)}</span>
    </a>`).join("");
}

function _createWeeklyReviewTodo() {
  const stats = _getOrganizationHealthData();
  const items = _buildWeeklyReviewItems(stats);
  const weekKey = _getCurrentWeekKey();
  createTodo({
    title: `Revue hebdo ${weekKey}`,
    description: items.map((item) => `- ${item.title}\n  - ${item.detail}`).join("\n"),
    priorityId: "important",
    context: "review",
    tags: ["review", "organisation"],
    status: "todo",
  });
  showToast("Tâche de revue créée");
}

// ── Hero ──────────────────────────────────────────────────

function initHero() {
  // Salutation dynamique
  const now = new Date();
  const h = now.getHours();
  const mins = now.getMinutes().toString().padStart(2, "0");
  const greeting = h < 18 ? "Bonjour" : "Bonsoir";
  const DAYS = [
    "dimanche",
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
  ];
  const dayLabel = DAYS[now.getDay()];

  const greetEl = document.getElementById("hero-greeting");
  const dateEl = document.getElementById("hero-datetime");
  const userName = (typeof getSettings === "function" && getSettings()?.userName?.trim()) || "Tanguy";
  if (greetEl) greetEl.textContent = `${greeting} ${userName}`;
  if (dateEl) dateEl.textContent = `c'est ${dayLabel} ${h}h${mins}`;

  // Badges statistiques
  _renderHeroStats();

  // Raccourcis visuels avec compteurs
  _renderHeroShortcuts();
  _renderTaskStats();

  // Barre de recherche → ouvre la recherche globale
  document.getElementById("hero-search-btn")?.addEventListener("click", () => {
    if (typeof openGlobalSearch === "function") openGlobalSearch();
  });
}


function _renderTaskStats() {
  const grid = document.getElementById("task-stats-grid");
  const section = document.getElementById("section-task-stats");
  if (!grid) return;

  const allTodos  = getTodos();
  const prios     = getTodoPriorities();
  const weekStart = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

  const total    = allTodos.length;
  const done     = allTodos.filter((t) => t.status === "done").length;
  const overdue  = getOverdueTodos().length;
  const doneWeek = allTodos.filter((t) => t.status === "done" &&
    (t.updatedAt || t.createdAt) >= Date.parse(weekStart)).length;
  const active   = total - done;

  if (!total) { if (section) section.style.display = "none"; return; }
  if (section) section.style.display = "";

  const byPrio = {};
  allTodos.filter((t) => t.status !== "done").forEach((t) => {
    byPrio[t.priorityId] = (byPrio[t.priorityId] || 0) + 1;
  });

  const statsCards = [
    { icon: "✓",  num: done,     lbl: "terminées",         color: "var(--success)" },
    { icon: "📅", num: doneWeek, lbl: "finies cette sem.",  color: "var(--accent)" },
    { icon: "🔥", num: overdue,  lbl: "en retard",          color: overdue ? "var(--danger)" : "var(--text-3)" },
    { icon: "📋", num: active,   lbl: "en cours",           color: "var(--text-2)" },
  ];

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  grid.innerHTML =
    statsCards.map((s) => `
      <div class="task-stat-card">
        <span class="task-stat-icon">${s.icon}</span>
        <span class="task-stat-num" style="color:${s.color}">${s.num}</span>
        <span class="task-stat-lbl">${s.lbl}</span>
      </div>`).join("") +
    `<div class="task-stat-card task-stat-wide">
      <div class="task-stat-pct-label">
        <span>Progression globale</span>
        <strong style="color:var(--accent)">${pct}%</strong>
      </div>
      <div class="task-stat-bar">
        <div class="task-stat-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="task-stat-prio-bars">` +
        prios.map((p) => {
          const n = byPrio[p.id] || 0;
          if (!n) return "";
          const w = active > 0 ? Math.round((n / active) * 100) : 0;
          return `<div class="task-stat-prio-row">
            <span class="task-stat-prio-name" style="color:${_safeCssColor(p.color, 'var(--text-2)')}">${escHtml(p.label)}</span>
            <div class="task-stat-prio-bar"><div style="width:${w}%;background:${_safeCssColor(p.color, 'var(--accent)')}"></div></div>
            <span class="task-stat-prio-num">${n}</span>
          </div>`;
        }).join("") +
      `</div>
    </div>`;
}

function _renderHeroStats() {
  const statsEl = document.getElementById("hero-stats");
  if (!statsEl) return;

  const overdue = getOverdueTodos();
  const today = getDueTodayTodos();
  const projects = getProjects().filter((p) => !p.archived);
  const journal =
    typeof getJournalEntries === "function" ? getJournalEntries() : [];

  const items = [
    overdue.length
      ? { num: overdue.length, lbl: "en retard", cls: "danger" }
      : null,
    today.length
      ? { num: today.length, lbl: "pour aujourd'hui", cls: "accent" }
      : null,
    {
      num: projects.length,
      lbl: projects.length !== 1 ? "projets actifs" : "projet actif",
      cls: "",
    },
    journal.length
      ? { num: journal.length, lbl: "entrées journal", cls: "" }
      : null,
  ].filter(Boolean);

  statsEl.innerHTML = items
    .map(
      (s, i) => `
      <div class="hero-stat ${s.cls}" style="animation-delay:${i * 60}ms">
        <span class="hero-stat-num">${s.num}</span>
        <span>${s.lbl}</span>
      </div>`,
    )
    .join("");
}

function _renderHeroShortcuts() {
  const wrap = document.getElementById("hero-shortcuts");
  if (!wrap) return;

  const overdue = getOverdueTodos();
  const today = getDueTodayTodos();
  const allTodos = getTodos().filter((t) => t.status !== "done");

  const SHORTCUTS = [
    {
      href: "rh.html",
      icon: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="5" r="2.5"/><path d="M2.5 13.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/></svg>`,
      iconBg: "var(--success-dim)",
      iconColor: "var(--success)",
      name: "RH",
      sub: "Fiches & dossiers",
      badge: null,
    },
    {
      href: "projects.html",
      icon: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 4a1 1 0 011-1h3.17a1 1 0 01.71.29l1.12 1.12a1 1 0 00.71.3H13.5a1 1 0 011 1v6a1 1 0 01-1 1h-11a1 1 0 01-1-1V4z"/></svg>`,
      iconBg: "var(--link-dim)",
      iconColor: "var(--link-color)",
      name: "Projets",
      sub: "Liens, mémos, code",
      badge: (() => {
        const n = getProjects().filter((p) => !p.archived).length;
        return n ? { num: n, cls: "" } : null;
      })(),
    },
    {
      href: "todos.html",
      icon: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><path d="M5 8l2 2 4-4"/></svg>`,
      iconBg: "var(--accent-dim)",
      iconColor: "var(--accent)",
      name: "Tâches",
      sub: "Todo & priorités",
      badge: (() => {
        if (overdue.length)
          return { num: `${overdue.length} retard`, cls: "danger" };
        if (today.length) return { num: `${today.length} auj.`, cls: "accent" };
        return allTodos.length ? { num: allTodos.length, cls: "" } : null;
      })(),
    },
    {
      href: "snippets.html",
      icon: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 4l-3 4 3 4M11 4l3 4-3 4M9 2l-2 12"/></svg>`,
      iconBg: "var(--code-dim)",
      iconColor: "var(--code-color)",
      name: "Snippets",
      sub: "Code réutilisable",
      badge: (() => {
        const n = getSnippets().length;
        return n ? { num: n, cls: "" } : null;
      })(),
    },
    {
      href: "journal.html",
      icon: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="1.5" width="12" height="13" rx="1.5"/><path d="M5 5.5h6M5 8h6M5 10.5h4"/></svg>`,
      iconBg: "var(--info-dim)",
      iconColor: "var(--info-color)",
      name: "Journal",
      sub: "Notes du jour",
      badge: (() => {
        const n = getJournalEntries ? getJournalEntries().length : 0;
        return n ? { num: n, cls: "" } : null;
      })(),
    },
    {
      href: "smart-planning.html",
      icon: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"/><circle cx="8" cy="8" r="3"/></svg>`,
      iconBg: "var(--info-dim)",
      iconColor: "var(--info-color)",
      name: "Planification",
      sub: "Optimise ton temps",
      badge: null,
    },
    {
      href: "export.html",
      icon: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 10v3.5h10V10M8 2v8M5 7l3 3 3-3"/></svg>`,
      iconBg: "var(--bg-3)",
      iconColor: "var(--text-2)",
      name: "Export",
      sub: "Télécharger",
      badge: null,
    },
  ];

  wrap.innerHTML = "";
  SHORTCUTS.forEach((s, i) => {
    const a = document.createElement("a");
    a.href = s.href;
    a.className = "shortcut-card";
    a.style.animationDelay = i * 40 + "ms";
    a.innerHTML = `
      <div class="shortcut-icon" style="background:${s.iconBg};color:${s.iconColor}">${s.icon}</div>
      <div class="shortcut-name">${s.name}</div>
      <div class="shortcut-sub">${s.sub}</div>
      ${s.badge ? `<span class="shortcut-badge ${s.badge.cls}">${s.badge.num}</span>` : ""}
    `;
    wrap.appendChild(a);
  });
}

function renderRecent() {
  const recent   = getRecentlyVisited();
  const activity = typeof getActivityLog === "function" ? getActivityLog() : [];
  const grid = document.getElementById("recent-grid");
  const section = grid?.closest(".section");
  const toggle = _ensureRecentToggle(section);
  if (!grid || !section || !toggle) return;
  grid.innerHTML = "";

  // Fusionner visites et activités, dédupliquer, trier par date
  const visits = recent.map((v) => ({ ...v, _kind: "visit", ts: v.visitedAt }));
  const acts   = activity.map((a) => ({ ...a, _kind: "activity" }));
  const all = [...visits, ...acts]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 12);

  if (!all.length) {
    _recentExpanded = false;
    grid.classList.remove("recent-grid-collapsed", "recent-grid-expanded");
    grid.style.maxHeight = "";
    toggle.hidden = true;
    grid.appendChild(
      createEmptyState(
        EMPTY_ICONS.recent,
        "Aucune activité récente",
        "Créez des tâches, snippets ou documents pour les retrouver ici.",
      ),
    );
    return;
  }

  const ACTION_LABEL = { create: "Créé", update: "Modifié", delete: "Supprimé" };
  const TYPE_LABEL   = { todo: "Tâche", snippet: "Snippet", rh: "Document RH",
                         project: "Projet", journal: "Journal" };

  all.forEach((item, i) => {
    if (item._kind === "activity") {
      const card = el("div", "recent-card recent-card-activity");
      card.style.animationDelay = i * 40 + "ms";
      const color = item.color || "var(--accent)";
      card.style.setProperty("--rc-color", color);
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:.9rem">${item.icon || "●"}</span>
          <div class="recent-card-type">${ACTION_LABEL[item.action] || item.action} · ${TYPE_LABEL[item.type] || item.type}</div>
        </div>
        <div class="recent-card-name">${escHtml(item.label)}</div>
        <div class="recent-card-time">${timeAgo(item.ts)}</div>`;
      grid.appendChild(card);
    } else {
      const card = document.createElement("a");
      card.className = "recent-card";
      card.style.animationDelay = i * 40 + "ms";
      const color = item.color || "var(--accent)";
      card.style.setProperty("--rc-color", color);
      const _exists = item.type === "project"
        ? !!getProject(item.id)
        : !!getRhNode(item.id);
      card.href = _exists
        ? (item.type === "project" ? `project.html?id=${item.id}` : `rh.html?folder=${item.id}`)
        : "#";
      if (!_exists) {
        card.style.opacity = ".5";
        card.title = "Élément supprimé";
        card.addEventListener("click", (e) => {
          e.preventDefault();
          showToast("Cet élément a été supprimé", "error");
        });
      }
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <div class="recent-card-type">${item.type === "project" ? "Projet" : "Dossier RH"}</div>
        </div>
        <div class="recent-card-name">${escHtml(item.name)}</div>
        <div class="recent-card-time">${timeAgo(item.visitedAt)}</div>`;
      grid.appendChild(card);
    }
  });

  requestAnimationFrame(() => {
    _applyRecentRowsState(grid, toggle);
  });
}

function _ensureRecentToggle(section) {
  if (!section) return null;
  let toggle = section.querySelector(".recent-toggle");
  if (toggle) return toggle;

  toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "recent-toggle";
  toggle.hidden = true;
  toggle.addEventListener("click", () => {
    _recentExpanded = !_recentExpanded;
    const grid = document.getElementById("recent-grid");
    if (!grid) return;
    _applyRecentRowsState(grid, toggle);
  });
  section.appendChild(toggle);
  return toggle;
}

function _applyRecentRowsState(grid, toggle) {
  const cards = Array.from(grid.children);
  if (!cards.length) {
    grid.classList.remove("recent-grid-collapsed", "recent-grid-expanded");
    grid.style.maxHeight = "";
    toggle.hidden = true;
    return;
  }

  const rows = [];
  cards.forEach((card) => {
    const top = card.offsetTop;
    const bottom = top + card.offsetHeight;
    const existingRow = rows.find((row) => Math.abs(row.top - top) < 2);
    if (existingRow) {
      existingRow.bottom = Math.max(existingRow.bottom, bottom);
      return;
    }
    rows.push({ top, bottom });
  });
  rows.sort((a, b) => a.top - b.top);

  const maxVisibleRows = Math.min(RECENT_ROWS_EXPANDED, rows.length);
  const canExpand = rows.length > RECENT_ROWS_COLLAPSED;
  if (!canExpand) {
    _recentExpanded = false;
    grid.classList.remove("recent-grid-collapsed", "recent-grid-expanded");
    grid.style.maxHeight = "";
    toggle.hidden = true;
    return;
  }

  toggle.hidden = false;
  grid.classList.toggle("recent-grid-collapsed", !_recentExpanded);
  grid.classList.toggle("recent-grid-expanded", _recentExpanded);

  const visibleRows = _recentExpanded ? maxVisibleRows : RECENT_ROWS_COLLAPSED;
  const targetHeight = rows[visibleRows - 1].bottom;
  grid.style.maxHeight = `${targetHeight}px`;
  toggle.textContent = _recentExpanded ? "Voir moins" : "Voir plus";
  toggle.setAttribute("aria-expanded", _recentExpanded ? "true" : "false");
}

window.addEventListener("resize", () => {
  const grid = document.getElementById("recent-grid");
  const toggle = document.querySelector(".recent-toggle");
  if (!grid || !toggle || toggle.hidden) return;
  requestAnimationFrame(() => {
    _applyRecentRowsState(grid, toggle);
  });
});

// ── Reminders ─────────────────────────────────────────────

let _reminderTab = "today";
let _reminderTimers = [];

function renderReminders() {
  const list = document.getElementById("reminders-list");
  if (!list) return;

  const today = getDueTodayTodos();
  const overdue = getOverdueTodos();
  const pinned = getPinnedTodos();
  const upcoming = getUpcomingReminders();

  document.getElementById("tab-cnt-today").textContent = today.length;
  document.getElementById("tab-cnt-overdue").textContent = overdue.length;
  document.getElementById("tab-cnt-pinned").textContent = pinned.length;
  document.getElementById("tab-cnt-upcoming").textContent = upcoming.length;

  const total = today.length + overdue.length + pinned.length;
  document.getElementById("reminders-count").textContent = total
    ? `· ${total} actif${total > 1 ? "s" : ""}`
    : "";

  document.querySelectorAll(".reminders-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === _reminderTab);
    b.onclick = () => {
      _reminderTab = b.dataset.tab;
      renderReminders();
    };
  });

  const data = {
    today: today.map((t) => ({ todo: t, flavor: "today" })),
    overdue: overdue.map((t) => ({ todo: t, flavor: "overdue" })),
    pinned: pinned.map((t) => ({ todo: t, flavor: "pinned" })),
    upcoming: upcoming.map((r) => ({ todo: r.todo, flavor: "today" })),
  }[_reminderTab];

  list.innerHTML = "";
  if (!data.length) {
    const empty = {
      today: "Aucune tâche prévue aujourd'hui. Profitez-en !",
      overdue: "Aucune tâche en retard. 🎉",
      pinned:
        "Aucune tâche épinglée. Cochez ⭐ sur une tâche pour la fixer ici.",
      upcoming: "Aucun rappel programmé dans les 7 prochains jours.",
    }[_reminderTab];
    const e = el("div", "reminders-empty", empty);
    list.appendChild(e);
    return;
  }

  data.forEach(({ todo, flavor }, i) => {
    list.appendChild(buildReminderCard(todo, flavor, i));
  });
}

function buildReminderCard(todo, flavor, idx) {
  const card = el("div", `reminder-card ${flavor}`);
  card.style.animationDelay = idx * 30 + "ms";

  const check = el("button", "reminder-check");
  check.title = "Marquer comme terminé";
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    updateTodo(todo.id, { status: "done" });
    showToast("Tâche terminée");
    renderReminders();
  });

  const prios = getTodoPriorities();
  const prio = prios.find((p) => p.id === todo.priorityId);
  const dot = el("span", "reminder-priority");
  dot.style.background = prio?.color || "var(--text-3)";
  dot.title = prio?.label || "";

  const body = el("div", "reminder-body");
  const title = el("div", "reminder-title", escHtml(todo.title));
  const meta = el("div", "reminder-meta");
  const when = reminderWhenLabel(todo);
  if (when) {
    const span = el("span", "when " + when.cls, when.text);
    meta.appendChild(span);
  }
  if (prio) meta.appendChild(el("span", "", prio.label));
  if (todo.context) meta.appendChild(el("span", "", "@" + todo.context));
  (todo.tags || [])
    .slice(0, 3)
    .forEach((t) => meta.appendChild(el("span", "", "#" + t)));
  body.appendChild(title);
  body.appendChild(meta);

  const actions = el("div", "reminder-actions");
  const pin = el(
    "button",
    "reminder-pin" + (todo.pinned ? " pinned" : ""),
    todo.pinned ? "★" : "☆",
  );
  pin.title = todo.pinned ? "Désépingler" : "Épingler sur l'accueil";
  pin.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePinTodo(todo.id);
    showToast(todo.pinned ? "Désépinglée" : "Épinglée ⭐");
    renderReminders();
  });
  actions.appendChild(pin);

  card.appendChild(check);
  card.appendChild(dot);
  card.appendChild(body);
  card.appendChild(actions);

  card.style.cursor = "pointer";
  card.addEventListener("click", () => {
    sessionStorage.setItem("workspace_focus_todo", todo.id);
    window.location.href = "todos.html";
  });

  return card;
}

function reminderWhenLabel(todo) {
  if (todo.reminderAt) {
    const ts = Date.parse(todo.reminderAt);
    if (!isNaN(ts)) {
      const diff = ts - Date.now();
      const d = new Date(ts);
      const dateStr =
        d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) +
        " " +
        d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      if (diff < 0) return { text: "⏱ Retard · " + dateStr, cls: "late" };
      if (diff < 60 * 60 * 1000)
        return {
          text: "⏱ Dans " + Math.max(1, Math.round(diff / 60000)) + " min",
          cls: "soon",
        };
      if (diff < 24 * 60 * 60 * 1000)
        return { text: "⏱ " + dateStr, cls: "soon" };
      return { text: "⏱ " + dateStr };
    }
  }
  if (todo.dueDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (todo.dueDate < today)
      return {
        text: "📅 En retard depuis " + frDate(todo.dueDate),
        cls: "late",
      };
    if (todo.dueDate === today) return { text: "📅 Aujourd'hui", cls: "soon" };
    return { text: "📅 " + frDate(todo.dueDate) };
  }
  return null;
}

function frDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function openReminderModal(prefill = {}) {
  const priorities = getTodoPriorities();
  const content = el("div");
  content.innerHTML = `
    <div class="field"><label>Titre du rappel *</label><input type="text" id="r-title" maxlength="120" placeholder="Ex: Appeler le client X"></div>
    <div class="field-row">
      <div class="field"><label>Date + heure</label><input type="datetime-local" id="r-when"></div>
      <div class="field"><label>Priorité</label><select id="r-prio">${priorities
        .map(
          (p) =>
            `<option value="${p.id}" ${p.id === "important" ? "selected" : ""}>${escHtml(p.label)}</option>`,
        )
        .join("")}</select></div>
    </div>
    <div class="field"><label>Contexte (optionnel)</label><input type="text" id="r-ctx" maxlength="40" placeholder="@bureau, @client…"></div>
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:.85rem">
      <input type="checkbox" id="r-pin" checked style="width:16px;height:16px;accent-color:var(--accent)">
      <span>⭐ Épingler sur la page d'accueil</span>
    </label>`;
  createModal({
    title: "Nouveau rappel",
    confirmLabel: "Créer",
    content,
    watchConfirm: true,
    isConfirmEnabled: () => !!document.getElementById("r-title")?.value.trim(),
    disabledConfirmTitle: "Le titre du rappel est requis",
    onConfirm: () => {
      const title = document.getElementById("r-title")?.value.trim();
      if (!title) {
        showToast("Titre requis");
        return;
      }
      const when = document.getElementById("r-when")?.value || "";
      createTodo({
        title,
        priorityId: document.getElementById("r-prio")?.value || "important",
        context: document.getElementById("r-ctx")?.value.trim() || "",
        reminderAt: when,
        dueDate: when ? when.slice(0, 10) : "",
        pinned: !!document.getElementById("r-pin")?.checked,
      });
      showToast("Rappel créé");
      renderReminders();
      scheduleReminderNotifications();
    },
  });
  setTimeout(() => {
    // Default time: now + 1h, arrondi 5min
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
    const pad = (n) => String(n).padStart(2, "0");
    const v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    document.getElementById("r-when").value = prefill.when || v;
    document.getElementById("r-title")?.focus();
  }, 30);
}

// ── Notifications natives (best effort, no-server) ───────
function scheduleReminderNotifications() {
  if (typeof initGlobalReminderWatcher === "function") {
    initGlobalReminderWatcher();
  }
}

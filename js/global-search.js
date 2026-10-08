// @ts-check
// ── global-search.js ──
// Palette globale (Ctrl+Espace) : recherche + actions rapides
// Inspirée de Spotlight / Raycast / VS Code Command Palette.

(function () {
  let overlay, input, resultsEl;
  let selectedIdx = 0;

  // Certaines pages ne chargent pas common-utils.js.
  // On garde un fallback local pour éviter que la palette casse au montage.
  const safeDebounce =
    typeof debounce === "function"
      ? debounce
      : function (fn, delay) {
          let timer;
          return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
          };
        };

  // _debounce supprimé : on utilise le debounce global de common-utils.js

  // ─────────────────────────────────────────────────────────
  // Registre des actions rapides — extensible facilement
  // Une action = { id, title, sub, icon, color, keywords[], run() }
  // ─────────────────────────────────────────────────────────
  const QUICK_ACTIONS = [
    {
      id: "new-todo",
      title: "Nouvelle tâche",
      sub: "Créer une todo",
      icon: "✓",
      color: "var(--accent)",
      keywords: ["todo", "tâche", "tache", "task", "new", "add"],
      run: openNewTodo,
    },
    {
      id: "new-snippet",
      title: "Nouveau snippet",
      sub: "Ajouter un bout de code",
      icon: "</>",
      color: "var(--code-color)",
      keywords: ["snippet", "code", "new", "add"],
      run: openNewSnippet,
    },
    {
      id: "new-rh-doc",
      title: "Nouveau document RH",
      sub: "Ajouter une fiche / document",
      icon: "📋",
      color: "var(--success)",
      keywords: ["rh", "doc", "document", "fiche", "new", "add"],
      run: openNewRhDoc,
    },
    {
      id: "new-project",
      title: "Créer un projet",
      sub: "Nouveau projet",
      icon: "📁",
      color: "var(--link-color)",
      keywords: ["projet", "project", "create", "new", "add"],
      run: openNewProject,
    },
    // ── Navigation rapide ──
    {
      id: "go-home",
      title: "Aller au tableau de bord",
      sub: "Accueil",
      icon: "⌂",
      color: "var(--text-2)",
      keywords: ["home", "accueil", "dashboard", "go"],
      run: () => (window.location.href = "index.html"),
    },
    {
      id: "go-projects",
      title: "Aller aux projets",
      sub: "Liste des projets",
      icon: "📁",
      color: "var(--link-color)",
      keywords: ["projets", "projects", "go"],
      run: () => (window.location.href = "projects.html"),
    },
    {
      id: "go-todos",
      title: "Aller aux tâches",
      sub: "Todo & priorités",
      icon: "✓",
      color: "var(--accent)",
      keywords: ["todos", "tâches", "go"],
      run: () => (window.location.href = "todos.html"),
    },
    {
      id: "go-snippets",
      title: "Aller aux snippets",
      sub: "Code réutilisable",
      icon: "</>",
      color: "var(--code-color)",
      keywords: ["snippets", "go"],
      run: () => (window.location.href = "snippets.html"),
    },
    {
      id: "new-journal",
      title: "Nouvelle entrée de journal",
      sub: "Écrire dans le journal de bord",
      icon: "📓",
      color: "var(--accent)",
      keywords: [
        "journal",
        "diary",
        "note",
        "écrire",
        "ecrire",
        "new",
        "add",
        "today",
      ],
      run: () => {
        if (!location.pathname.endsWith("journal.html")) {
          sessionStorage.setItem("workspace_create_journal", "1");
          window.location.href = "journal.html";
        } else if (typeof handleCreate === "function") {
          handleCreate();
        }
      },
    },
    {
      id: "go-journal",
      title: "Aller au journal",
      sub: "Journal de bord personnel",
      icon: "📓",
      color: "var(--accent)",
      keywords: ["journal", "diary", "bord", "go"],
      run: () => (window.location.href = "journal.html"),
    },
    {
      id: "go-rh",
      title: "Aller à la section RH",
      sub: "Fiches & dossiers",
      icon: "📋",
      color: "var(--success)",
      keywords: ["rh", "go"],
      run: () => (window.location.href = "rh.html"),
    },
    {
      id: "go-planning",
      title: "Aller à la planification",
      sub: "Smart planning",
      icon: "◔",
      color: "var(--info-color)",
      keywords: ["planning", "smart", "plan", "go"],
      run: () => (window.location.href = "smart-planning.html"),
    },
    {
      id: "go-export",
      title: "Exporter mes données",
      sub: "JSON, Markdown, ZIP — sauvegarde locale",
      icon: "⬇",
      color: "var(--accent)",
      keywords: [
        "export",
        "exporter",
        "sauvegarde",
        "backup",
        "json",
        "markdown",
        "zip",
        "download",
        "télécharger",
      ],
      run: () => (window.location.href = "export.html"),
    },
    {
      id: "go-settings",
      title: "Aller aux paramètres",
      sub: "Nom du site, sauvegarde automatique, dossier cible",
      icon: "⚙",
      color: "var(--text-2)",
      keywords: [
        "parametres",
        "paramètres",
        "settings",
        "config",
        "backup",
        "sauvegarde",
      ],
      run: () => (window.location.href = "settings.html"),
    },
    {
      id: "toggle-theme",
      title: "Basculer le thème (clair/sombre)",
      sub: "Toggle theme",
      icon: "◐",
      color: "var(--text-2)",
      keywords: ["theme", "thème", "dark", "light", "mode"],
      run: () => {
        if (typeof toggleTheme === "function") toggleTheme();
      },
    },
    {
      id: "export-data",
      title: "Exporter toutes les données",
      sub: "Télécharger un JSON complet",
      icon: "⤓",
      color: "var(--text-2)",
      keywords: ["export", "json", "backup", "download"],
      run: () => {
        if (typeof exportData === "function") exportData();
      },
    },
  ];

  /** API publique : enregistrer une action depuis n'importe où. */
  window.registerQuickAction = function (action) {
    if (!action || !action.id) return;
    const existing = QUICK_ACTIONS.findIndex((a) => a.id === action.id);
    if (existing >= 0) QUICK_ACTIONS[existing] = action;
    else QUICK_ACTIONS.push(action);
  };

  // ─────────────────────────────────────────────────────────
  // Montage de l'overlay
  // ─────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", mount);

  function mount() {
    overlay = el("div", "gs-overlay");
    overlay.innerHTML = `
      <div class="gs-box">
        <div class="gs-input-row">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
          <input class="gs-input" id="gs-input" placeholder="Rechercher  ·  #tag  ·  priority:urgent  ·  status:done  ·  type:snippet  ·  &gt; commandes" autocomplete="off">
          <span class="gs-shortcut">Ctrl+Espace</span>
        </div>
        <div class="gs-results" id="gs-results"></div>
        <div class="gs-footer">
          <span><kbd>↑↓</kbd> naviguer</span>
          <span><kbd>↵</kbd> exécuter</span>
          <span><kbd>&gt;</kbd> commandes</span>
          <span><kbd>Esc</kbd> fermer</span>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    input = overlay.querySelector("#gs-input");
    resultsEl = overlay.querySelector("#gs-results");

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    input.addEventListener(
      "input",
      safeDebounce(() => {
        selectedIdx = 0;
        render(input.value);
      }, 80),
    );
    input.addEventListener("keydown", onKey);
  }

  function open() {
    overlay.classList.add("open");
    input.value = "";
    selectedIdx = 0;
    render("");
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    overlay.classList.remove("open");
  }

  function onKey(e) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSel(1);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSel(-1);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runSelected();
    }
  }

  function moveSel(dir) {
    const items = resultsEl.querySelectorAll(".gs-result");
    if (!items.length) return;
    items[selectedIdx]?.classList.remove("selected");
    selectedIdx = (selectedIdx + dir + items.length) % items.length;
    items[selectedIdx]?.classList.add("selected");
    items[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }

  function runSelected() {
    const items = resultsEl.querySelectorAll(".gs-result");
    if (!items.length) return;
    const idx = Math.max(0, Math.min(items.length - 1, selectedIdx));
    items[idx].click();
  }

  // ─────────────────────────────────────────────────────────
  // Parseur de requête (filtres avancés)
  //   tag:foo  #foo            → filtre par tag
  //   priority:urgent  p:p1    → filtre par priorité
  //   status:done              → filtre par statut (todo|inprogress|done)
  //   context:meeting  ctx:..  → filtre par contexte (substring)
  //   type:todo                → restreint à un type
  //   lang:js                  → langage de snippet
  //   in:"mon projet"          → dans un projet (substring nom)
  //   folder:dossier           → dans un dossier RH/snippet (substring)
  //   "phrase exacte"          → recherche plein texte (exact)
  // Tous les filtres se combinent en AND avec le texte libre.
  // ─────────────────────────────────────────────────────────
  const FILTER_ALIASES = {
    tag: "tag",
    "#": "tag",
    priority: "priority",
    prio: "priority",
    p: "priority",
    status: "status",
    s: "status",
    context: "context",
    ctx: "context",
    type: "type",
    t: "type",
    kind: "type",
    lang: "lang",
    language: "lang",
    l: "lang",
    in: "in",
    project: "in",
    folder: "folder",
    dossier: "folder",
  };

  function parseQuery(raw) {
    const parsed = {
      tag: [],
      priority: [],
      status: [],
      context: [],
      type: [],
      lang: [],
      in: [],
      folder: [],
      text: [],
      phrases: [],
    };
    if (!raw) return parsed;

    // Phrases entre guillemets
    raw = raw.replace(/"([^"]+)"/g, (_, s) => {
      parsed.phrases.push(s.trim().toLowerCase());
      return " ";
    });

    raw
      .split(/\s+/)
      .filter(Boolean)
      .forEach((tok) => {
        // #tag
        if (tok.startsWith("#") && tok.length > 1) {
          parsed.tag.push(tok.slice(1).toLowerCase());
          return;
        }
        // key:value
        const m = tok.match(/^([a-zA-Z]+):(.+)$/);
        if (m) {
          const key = FILTER_ALIASES[m[1].toLowerCase()];
          if (key) {
            parsed[key].push(m[2].toLowerCase());
            return;
          }
        }
        parsed.text.push(tok.toLowerCase());
      });
    return parsed;
  }

  function hasActiveFilters(p) {
    return [
      "tag",
      "priority",
      "status",
      "context",
      "type",
      "lang",
      "in",
      "folder",
    ].some((k) => p[k].length > 0);
  }

  function isQueryEmpty(p) {
    return !hasActiveFilters(p) && !p.text.length && !p.phrases.length;
  }

  function matchTextAll(haystack, parsed) {
    const hay = (haystack || "").toLowerCase();
    return (
      parsed.text.every((t) => hay.includes(t)) &&
      parsed.phrases.every((t) => hay.includes(t))
    );
  }

  // ─────────────────────────────────────────────────────────
  // Rendu
  // ─────────────────────────────────────────────────────────
  function render(rawQ) {
    resultsEl.innerHTML = "";

    const commandMode = rawQ.startsWith(">");
    const stripped = commandMode ? rawQ.slice(1) : rawQ;
    const parsed = parseQuery(stripped.trim());
    const empty = isQueryEmpty(parsed);

    const actions = filterActions(parsed);
    const searchResults = commandMode || empty ? [] : search(parsed);

    // Chips de filtres actifs
    if (!commandMode && hasActiveFilters(parsed)) {
      appendFilterChips(parsed);
    }

    // Aide si saisie totalement vide
    if (empty && !commandMode) {
      appendSection("Actions rapides");
      actions.forEach((a) => appendAction(a, ""));
      appendFilterHelp();
      const first = resultsEl.querySelector(".gs-result");
      if (first) {
        first.classList.add("selected");
        selectedIdx = 0;
      }
      return;
    }

    if (!actions.length && !searchResults.length) {
      resultsEl.innerHTML += `<div class="gs-empty">Aucun résultat pour « ${escHtml(rawQ)} »</div>`;
      return;
    }

    const freeText = parsed.text.concat(parsed.phrases).join(" ");

    if (actions.length) {
      appendSection(commandMode ? "Commandes" : "Actions rapides");
      actions.forEach((a) => appendAction(a, freeText));
    }

    if (searchResults.length) {
      const grouped = {};
      searchResults.forEach((r) => {
        if (!grouped[r.label]) grouped[r.label] = [];
        grouped[r.label].push(r);
      });
      Object.entries(grouped).forEach(([label, items]) => {
        appendSection(`${label} · ${items.length}`);
        items.forEach((r) => appendSearchResult(r, freeText));
      });
    }

    const first = resultsEl.querySelector(".gs-result");
    if (first) {
      first.classList.add("selected");
      selectedIdx = 0;
    }
  }

  function appendFilterChips(p) {
    const wrap = el("div", "gs-chips");
    const add = (key, value, color) => {
      const chip = el("span", "gs-chip", `${key}: ${value}`);
      if (color) chip.style.borderColor = color;
      wrap.appendChild(chip);
    };
    p.tag.forEach((v) => add("tag", v, "var(--accent)"));
    p.priority.forEach((v) => add("priority", v, "var(--warn-color)"));
    p.status.forEach((v) => add("status", v, "var(--success)"));
    p.context.forEach((v) => add("context", v));
    p.type.forEach((v) => add("type", v, "var(--link-color)"));
    p.lang.forEach((v) => add("lang", v, "var(--code-color)"));
    p.in.forEach((v) => add("in", v));
    p.folder.forEach((v) => add("folder", v));
    resultsEl.appendChild(wrap);
  }

  function appendFilterHelp() {
    const tips = [
      ["#docker", "filtre par tag"],
      ["priority:urgent", "alias p:urgent"],
      ["status:done", "todo · inprogress · done"],
      ["type:snippet", "todo · snippet · project · rh · item · folder"],
      ["lang:javascript", "snippet par langage"],
      ["context:client", "todo · sous-chaîne"],
      ['in:"mon projet"', "dans un projet"],
      ['"phrase exacte"', "recherche stricte"],
    ];
    const help = el("div", "gs-help");
    help.innerHTML =
      `<div class="gs-section-label">Filtres disponibles</div>` +
      tips
        .map(
          ([k, v]) =>
            `<div class="gs-help-row"><code>${escHtml(k)}</code><span>${escHtml(v)}</span></div>`,
        )
        .join("");
    resultsEl.appendChild(help);
  }

  function appendSection(label) {
    resultsEl.appendChild(el("div", "gs-section-label", label));
  }

  function appendAction(a, q) {
    const btn = document.createElement("button");
    btn.className = "gs-result";
    btn.innerHTML = `
      <div class="gs-result-icon" style="background:color-mix(in srgb,${a.color} 15%,transparent);color:${a.color}">
        <span style="font-size:.75rem">${a.icon}</span>
      </div>
      <div class="gs-result-body">
        <div class="gs-result-title">${highlight(a.title, q)}</div>
        <div class="gs-result-sub">${escHtml(a.sub || "")}</div>
      </div>
      <span class="gs-shortcut">↵</span>`;
    btn.addEventListener("click", () => {
      close();
      try {
        a.run();
      } catch (e) {
        console.error("[QuickAction]", a.id, e);
      }
    });
    resultsEl.appendChild(btn);
  }

  function appendSearchResult(r, q) {
    const btn = document.createElement("button");
    btn.className = "gs-result";
    btn.innerHTML = `
      <div class="gs-result-icon" style="background:color-mix(in srgb,${r.color} 15%,transparent);color:${r.color}">
        <span style="font-size:.75rem">${r.icon}</span>
      </div>
      <div class="gs-result-body">
        <div class="gs-result-title">${highlight(r.title, q)}</div>
        <div class="gs-result-sub">${escHtml(r.sub)}</div>
      </div>`;
    btn.addEventListener("click", () => {
      close();
      window.location.href = r.url;
    });
    resultsEl.appendChild(btn);
  }

  function filterActions(parsed) {
    // Les actions ne s'appliquent que sur le texte libre, jamais sur les filtres.
    // Si l'utilisateur a posé des filtres (tag:, status:, …) on cache les actions
    // pour laisser la place aux résultats de recherche.
    if (hasActiveFilters(parsed)) return [];
    const q = parsed.text.concat(parsed.phrases).join(" ").trim();
    if (!q) return QUICK_ACTIONS;
    return QUICK_ACTIONS.filter((a) => {
      const hay = (
        a.title +
        " " +
        (a.sub || "") +
        " " +
        (a.keywords || []).join(" ")
      ).toLowerCase();
      return (
        parsed.text.every((t) => hay.includes(t)) &&
        parsed.phrases.every((t) => hay.includes(t))
      );
    });
  }

  // ─────────────────────────────────────────────────────────
  // Recherche dans les données (filtres + plein texte AND)
  // ─────────────────────────────────────────────────────────
  function matchPriority(t, p) {
    if (!p.priority.length) return true;
    return p.priority.some((v) =>
      (t.priorityId || "").toLowerCase().includes(v),
    );
  }
  function matchStatus(t, p) {
    if (!p.status.length) return true;
    return p.status.some(
      (v) =>
        (t.status || "").toLowerCase() === v ||
        (t.status || "").toLowerCase().includes(v),
    );
  }
  function matchContext(t, p) {
    if (!p.context.length) return true;
    const hay = (t.context || "").toLowerCase();
    return p.context.every((v) => hay.includes(v));
  }
  function matchTags(item, p) {
    if (!p.tag.length) return true;
    const tags = (item.tags || []).map((t) => t.toLowerCase());
    return p.tag.every((needle) =>
      tags.some((tg) => tg === needle || tg.includes(needle)),
    );
  }
  function matchType(kind, p) {
    if (!p.type.length) return true;
    return p.type.some((v) => kind.startsWith(v));
  }
  function matchLang(s, p) {
    if (!p.lang.length) return true;
    const lang = (s.language || "").toLowerCase();
    return p.lang.every((v) => lang.includes(v));
  }
  function matchIn(projectName, p) {
    if (!p.in.length) return true;
    const hay = (projectName || "").toLowerCase();
    return p.in.every((v) => hay.includes(v));
  }
  function matchFolderName(name, p) {
    if (!p.folder.length) return true;
    const hay = (name || "").toLowerCase();
    return p.folder.every((v) => hay.includes(v));
  }

  function search(parsed) {
    const out = [];

    // ── Projets & items de projets ──────────────────────
    if (matchType("project", parsed) || matchType("item", parsed) || matchType("folder", parsed)) {
      getProjects().forEach((p) => {
        if (
          matchType("project", parsed) &&
          matchTextAll(p.name + " " + (p.note || ""), parsed) &&
          matchIn(p.name, parsed) &&
          !parsed.tag.length &&
          !parsed.priority.length &&
          !parsed.status.length &&
          !parsed.context.length &&
          !parsed.lang.length
        ) {
          out.push({
            type: "project",
            icon: "📁",
            label: "Projets",
            title: p.name,
            sub: "Projet",
            url: `project.html?id=${p.id}`,
            color: p.color,
          });
        }
        if (matchType("item", parsed) && matchIn(p.name, parsed)) {
          getAllNodes(p.children || []).forEach((node) => {
            if (node.nodeType !== "item") return;
            const haystack = (node.title || "") + " " + (node.note || "");
            if (!matchTextAll(haystack, parsed)) return;
            if (!matchTags(node, parsed)) return;
            if (
              parsed.priority.length ||
              parsed.status.length ||
              parsed.context.length ||
              parsed.lang.length
            )
              return;
            const fullPath = findPathToNode(p.children || [], node.id) || [node.id];
            const folderPath = fullPath.slice(0, -1).join(",");
            out.push({
              type: "item",
              icon: "📄",
              label: "Projets",
              title: node.title,
              sub: `dans ${p.name}`,
              url: withQuery(`project.html?id=${p.id}`, {
                path: folderPath || null,
                focus: node.id,
                kind: "item",
              }),
              color: p.color,
            });
          });
        }
        // Recherche sur les dossiers de projet
        if ((matchType("folder", parsed) || matchType("item", parsed)) && matchIn(p.name, parsed)) {
          getAllNodes(p.children || []).forEach((node) => {
            if (node.nodeType !== "folder") return;
            const haystack = (node.name || "") + " " + (node.note || "");
            if (!matchTextAll(haystack, parsed)) return;
            if (!matchTags(node, parsed)) return;
            if (
              parsed.priority.length ||
              parsed.status.length ||
              parsed.context.length ||
              parsed.lang.length
            )
              return;
            const fullPath = findPathToNode(p.children || [], node.id) || [node.id];
            const folderPath = fullPath.slice(0, -1).join(",");
            out.push({
              type: "item",
              icon: "📁",
              label: "Projets",
              title: node.name,
              sub: `dossier dans ${p.name}`,
              url: withQuery(`project.html?id=${p.id}`, {
                path: folderPath || null,
                focus: node.id,
                kind: "folder",
              }),
              color: p.color,
            });
          });
        }
      });
    }

    // ── RH (dossiers & fiches) ──────────────────────────
    if (matchType("rh", parsed)) {
      const rhNodes = getAllNodes(getRhRoot().children || []);
      rhNodes.forEach((node) => {
        const title = node.name || node.title || "";
        const haystack =
          title + " " + (node.note || "") + " " + (node.url || "");
        if (!matchTextAll(haystack, parsed)) return;
        if (!matchTags(node, parsed)) return;
        if (
          parsed.priority.length ||
          parsed.status.length ||
          parsed.context.length ||
          parsed.lang.length ||
          parsed.in.length
        )
          return;
        if (
          parsed.folder.length &&
          node.nodeType !== "folder" &&
          !matchFolderName(title, parsed)
        )
          return;
        if (parsed.folder.length && !matchFolderName(title, parsed)) return;
        const rhPath = findPathToNode(getRhRoot().children || [], node.id) || [node.id];
        const rhParentPath = rhPath.slice(0, -1).join(",");
        out.push({
          type: "rh",
          icon: node.nodeType === "folder" ? "🗂" : "📋",
          label: "RH",
          title,
          sub: node.nodeType === "folder" ? "Dossier RH" : "Fiche RH",
          url: withQuery("rh.html", {
            path: rhParentPath || null,
            focus: node.id,
            kind: node.nodeType === "folder" ? "folder" : "document",
          }),
          color: "var(--success)",
        });
      });
    }

    // ── Tâches ──────────────────────────────────────────
    if (matchType("todo", parsed)) {
      getTodos().forEach((t) => {
        const haystack =
          (t.title || "") +
          " " +
          (t.description || "") +
          " " +
          (t.context || "") +
          " " +
          (t.tags || []).join(" ");
        if (!matchTextAll(haystack, parsed)) return;
        if (!matchPriority(t, parsed)) return;
        if (!matchStatus(t, parsed)) return;
        if (!matchContext(t, parsed)) return;
        if (!matchTags(t, parsed)) return;
        if (parsed.lang.length || parsed.in.length || parsed.folder.length)
          return;
        out.push({
          type: "todo",
          icon: "✓",
          label: "Tâches",
          title: t.title,
          sub: buildTodoSub(t),
          url: withQuery("todos.html", {
            focus: t.id,
            kind: "todo",
          }),
          color: priorityColor(t.priorityId),
        });
      });
    }

    // ── Snippets ────────────────────────────────────────
    if (matchType("snippet", parsed)) {
      const folderNameById = buildSnippetFolderNameIndex();
      getSnippets().forEach((s) => {
        const haystack =
          (s.title || "") +
          " " +
          (s.code || "") +
          " " +
          (s.tags || []).join(" ");
        if (!matchTextAll(haystack, parsed)) return;
        if (!matchTags(s, parsed)) return;
        if (!matchLang(s, parsed)) return;
        if (
          parsed.priority.length ||
          parsed.status.length ||
          parsed.context.length ||
          parsed.in.length
        )
          return;
        if (parsed.folder.length) {
          const fname = folderNameById[s.folderId] || "";
          if (!matchFolderName(fname, parsed)) return;
        }
        const snippetParent = s.folderId || "root";
        const snippetStack =
          typeof buildSnippetFolderStack === "function"
            ? buildSnippetFolderStack(snippetParent)
            : [snippetParent];
        const snippetPath = snippetStack.slice(1).join(",");
        out.push({
          type: "snippet",
          icon: "</>",
          label: "Snippets",
          title: s.title,
          sub: buildSnippetSub(s, folderNameById),
          url: withQuery("snippets.html", {
            path: snippetPath || null,
            focus: s.id,
            kind: "snippet",
          }),
          color: "var(--code-color)",
        });
      });
    }

    return out.slice(0, 30);
  }

  function buildTodoSub(t) {
    const bits = [];
    if (t.status) bits.push(statusLabel(t.status));
    if (t.priorityId) bits.push(priorityLabel(t.priorityId));
    if ((t.tags || []).length) bits.push("#" + t.tags.join(" #"));
    if (t.context) bits.push("· " + t.context.slice(0, 40));
    return bits.join(" · ") || "Tâche";
  }

  function buildSnippetSub(s, folderNameById) {
    const bits = [];
    if (s.language) bits.push(s.language);
    if ((s.tags || []).length) bits.push("#" + s.tags.join(" #"));
    const fname = folderNameById[s.folderId];
    if (fname) bits.push("📂 " + fname);
    return bits.join(" · ") || "Snippet";
  }

  function buildSnippetFolderNameIndex() {
    const idx = {};
    if (typeof listAllSnippetFolders === "function") {
      listAllSnippetFolders().forEach((f) => {
        idx[f.id] = f.name;
      });
    }
    return idx;
  }

  function priorityLabel(id) {
    const p = (getTodoPriorities() || []).find((x) => x.id === id);
    return p ? p.label : id;
  }
  function priorityColor(id) {
    const p = (getTodoPriorities() || []).find((x) => x.id === id);
    return p ? p.color : "var(--accent)";
  }
  function statusLabel(s) {
    return { todo: "À faire", inprogress: "En cours", done: "Terminé" }[s] || s;
  }

  function highlight(text, query) {
    if (!query) return escHtml(text);
    const terms = String(query)
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (!terms.length) return escHtml(text);
    let out = escHtml(text);
    terms.forEach((term) => {
      const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`(${safe})`, "ig"), "<mark>$1</mark>");
    });
    return out;
  }

  function getAllNodes(children) {
    return (children || []).reduce((acc, c) => {
      acc.push(c);
      if (c.children) acc.push(...getAllNodes(c.children));
      return acc;
    }, []);
  }

  function findPathToNode(children, targetId, path = []) {
    for (const node of children || []) {
      const nextPath = [...path, node.id];
      if (node.id === targetId) return nextPath;
      if (node.children?.length) {
        const found = findPathToNode(node.children, targetId, nextPath);
        if (found) return found;
      }
    }
    return null;
  }

  function withQuery(url, params) {
    const [base, rawQuery = ""] = String(url).split("?");
    const sp = new URLSearchParams(rawQuery);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === "") return;
      sp.set(k, String(v));
    });
    const q = sp.toString();
    return q ? `${base}?${q}` : base;
  }

  // ─────────────────────────────────────────────────────────
  // Mini-formulaires de création (utilisent createModal global)
  // ─────────────────────────────────────────────────────────
  function openNewTodo() {
    const parseEstimatedMinutes = (value) => {
      if (typeof parseEstimatedTimeExpression === "function") {
        return parseEstimatedTimeExpression(value);
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return { valid: false, minutes: 0 };
      return { valid: true, minutes: Math.floor(n) };
    };
    const content = el("div");
    const priorities = getTodoPriorities() || [];
    const prioOptions = priorities
      .map(
        (p) =>
          `<option value="${p.id}" ${p.id === "normal" ? "selected" : ""}>${escHtml(p.label)}</option>`,
      )
      .join("");
    content.innerHTML = `
      <div class="field"><label>Titre *</label><input type="text" id="qa-title" maxlength="120" placeholder="Ex: Préparer la revue de sprint"></div>
      <div class="field-row">
        <div class="field"><label>Priorité</label><select id="qa-prio">${prioOptions}</select></div>
        <div class="field"><label>Estimation (min)</label><input type="text" id="qa-est" inputmode="decimal" placeholder="Ex: 60 ou 60*5"></div>
      </div>
      <div class="field"><label>Contexte (optionnel)</label><textarea id="qa-ctx" rows="3"></textarea></div>`;
    createModal({
      title: "Nouvelle tâche",
      confirmLabel: "Créer",
      content,
      onConfirm: () => {
        const title = document.getElementById("qa-title")?.value.trim();
        if (!title) {
          showToast("Titre requis");
          return false;
        }
        const rawEstimated = document.getElementById("qa-est")?.value || "";
        const parsedEstimated = parseEstimatedMinutes(rawEstimated);
        if (rawEstimated.trim() && !parsedEstimated.valid) {
          showToast("Estimation invalide. Exemples: 60, 60*5, (30+30)");
          return false;
        }
        createTodo({
          title,
          priorityId: document.getElementById("qa-prio")?.value || "normal",
          estimatedTime: parsedEstimated.minutes,
          context: document.getElementById("qa-ctx")?.value.trim() || "",
        });
        showToast("Tâche créée");
        if (location.pathname.endsWith("todos.html")) location.reload();
      },
    });
    setTimeout(() => document.getElementById("qa-title")?.focus(), 30);
  }

  function openNewSnippet() {
    const content = el("div");
    const folders =
      typeof listAllSnippetFolders === "function"
        ? listAllSnippetFolders()
        : [{ id: "root", name: "Snippets", depth: 0 }];
    const folderOptions = folders
      .map(
        (f) =>
          `<option value="${f.id}">${"\u00a0\u00a0".repeat(f.depth)}${escHtml(f.name)}</option>`,
      )
      .join("");
    content.innerHTML = `
      <div class="field"><label>Titre *</label><input type="text" id="qa-title" maxlength="100"></div>
      <div class="field-row">
        <div class="field"><label>Langage</label><div id="qa-lang-wrap"></div></div>
        <div class="field"><label>Tags (virgule)</label><input type="text" id="qa-tags" placeholder="docker, bash…"></div>
      </div>
      <div class="field"><label>Dossier</label><select id="qa-folder">${folderOptions}</select></div>
      <div class="field"><label>Code *</label><textarea id="qa-code" style="font-family:var(--font-mono);font-size:.82rem;min-height:140px"></textarea></div>`;
    createModal({
      title: "Nouveau snippet",
      confirmLabel: "Créer",
      content,
      onConfirm: () => {
        const title = document.getElementById("qa-title")?.value.trim();
        const code = document.getElementById("qa-code")?.value;
        if (!title) {
          showToast("Titre requis");
          return;
        }
        if (!code) {
          showToast("Code requis");
          return;
        }
        const folderId = document.getElementById("qa-folder")?.value || "root";
        createSnippet({
          title,
          code,
          language:
            document.getElementById("qa-lang-sel")?.value || "plaintext",
          tags: document
            .getElementById("qa-tags")
            ?.value.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          folderId: folderId === "root" ? null : folderId,
        });
        showToast("Snippet créé");
        if (location.pathname.endsWith("snippets.html")) location.reload();
      },
    });
    setTimeout(() => {
      const w = document.getElementById("qa-lang-wrap");
      if (w && typeof createLangSelect === "function") {
        const sel = createLangSelect("javascript");
        sel.id = "qa-lang-sel";
        w.appendChild(sel);
      }
      document.getElementById("qa-title")?.focus();
    }, 30);
  }

  function openNewRhDoc() {
    const content = el("div");
    content.innerHTML = `
      <div class="field"><label>Titre *</label><input type="text" id="qa-title" maxlength="120"></div>
      <div class="field"><label>URL (optionnel)</label><input type="url" id="qa-url" placeholder="https://…"></div>
      <div class="field"><label>Date (optionnel)</label><input type="date" id="qa-date"></div>
      <div class="field"><label>Note (optionnel)</label><textarea id="qa-note" rows="3"></textarea></div>`;
    createModal({
      title: "Nouveau document RH",
      confirmLabel: "Créer",
      content,
      onConfirm: () => {
        const title = document.getElementById("qa-title")?.value.trim();
        if (!title) {
          showToast("Titre requis");
          return;
        }
        addRhNode("root", {
          id: uid(),
          nodeType: "document",
          title,
          url: document.getElementById("qa-url")?.value.trim() || "",
          date: document.getElementById("qa-date")?.value || "",
          note: document.getElementById("qa-note")?.value.trim() || "",
          file: null,
          createdAt: Date.now(),
        });
        showToast("Document RH créé");
        if (location.pathname.endsWith("rh.html")) location.reload();
      },
    });
    setTimeout(() => document.getElementById("qa-title")?.focus(), 30);
  }

  function openNewProject() {
    const content = el("div");
    const palette =
      typeof COLORS !== "undefined" && COLORS.length
        ? COLORS
        : ["#64b0ff", "#b482ff", "#f0a030", "#ff7080", "#4ecb8d"];
    const swatches = palette
      .map(
        (c, i) =>
          `<button type="button" class="qa-color" data-color="${c}" style="background:${c};width:28px;height:28px;border:2px solid ${i === 0 ? "var(--text)" : "transparent"};border-radius:50%;cursor:pointer"></button>`,
      )
      .join("");
    content.innerHTML = `
      <div class="field"><label>Nom du projet *</label><input type="text" id="qa-name" maxlength="60" placeholder="Ex: Migration Java 21"></div>
      <div class="field"><label>Couleur</label><div id="qa-colors" style="display:flex;gap:8px;flex-wrap:wrap">${swatches}</div></div>`;
    let chosen = palette[0];
    createModal({
      title: "Nouveau projet",
      confirmLabel: "Créer",
      content,
      onConfirm: () => {
        const name = document.getElementById("qa-name")?.value.trim();
        if (!name) {
          showToast("Nom requis");
          return;
        }
        const project = createProject({ name, color: chosen });
        showToast("Projet créé");
        window.location.href = `project.html?id=${project.id}`;
      },
    });
    setTimeout(() => {
      document.getElementById("qa-colors")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".qa-color");
        if (!btn) return;
        chosen = btn.dataset.color;
        document
          .querySelectorAll(".qa-color")
          .forEach((b) => (b.style.borderColor = "transparent"));
        btn.style.borderColor = "var(--text)";
      });
      document.getElementById("qa-name")?.focus();
    }, 30);
  }

  // Exposer pour les shortcuts
  window.openGlobalSearch = open;
  window.closeGlobalSearch = close;
})();

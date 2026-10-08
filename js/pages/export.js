// @ts-check
// ── pages/export.js ──
// Orchestration de la page Export.
// Dépendances :
//   • export-converters.js  — convertisseurs et utilitaires purs
//   • export-import.js      — bindImport, showImportChoiceModal, mergeImport

bootPage(() => {
  initPageCommon();

  renderStats();
  renderStorageWidget();
  renderSections();
  bindGlobalActions();
  bindImport();
});

// ════════════════════════════════════════════════════════
// WIDGET STOCKAGE
// ════════════════════════════════════════════════════════

function renderStorageWidget() {
  const sizeLabel = document.getElementById("storage-size-label");
  const bar       = document.getElementById("storage-bar");
  const countsEl  = document.getElementById("storage-counts");
  const warning   = document.getElementById("storage-warning");
  if (!sizeLabel) return;

  const data     = getData();
  const sections = [
    { label: "Projets",   count: (data.projects  || []).length },
    { label: "Tâches",    count: (data.todos      || []).length },
    { label: "Snippets",  count: (data.snippets   || []).length },
    { label: "Journal",   count: (data.journal    || []).length },
    { label: "Fiches RH", count: countTreeItems(data.rh) },
  ];

  sizeLabel.textContent = getStorageUsage().label + " / …";
  _paintCounts(countsEl, sections);

  if (typeof getStorageQuotaAsync !== "function") return;

  getStorageQuotaAsync().then(({ label: used, quotaLabel, percent }) => {
    const color = _storageColor(percent);
    sizeLabel.textContent  = used + " / " + quotaLabel;
    sizeLabel.style.color  = color;
    if (bar) { bar.style.width = Math.min(100, percent).toFixed(2) + "%"; bar.style.background = color; }
    if (warning && percent > 70) {
      warning.style.display = "flex";
      warning.className     = "export-storage-warning";
      warning.style.color   = color;
      warning.innerHTML     =
        `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
             stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M8 5v4M8 11v.5"/></svg>` +
        (percent > 80
          ? " Stockage presque plein — pensez à exporter vos données."
          : " Stockage à plus de 70% — un export préventif est conseillé.");
    }
  });
}

function _paintCounts(target, sections) {
  if (!target) return;
  target.innerHTML = sections
    .map(
      (s) =>
        `<div class="export-storage-count">
           <div class="export-storage-count-num">${s.count}</div>
           <div class="export-storage-count-lbl">${escHtml(s.label)}</div>
         </div>`,
    )
    .join("");
}

function _storageColor(percent) {
  return percent > 80
    ? "var(--danger)"
    : percent > 50
      ? "var(--warning, #f0a030)"
      : "var(--success)";
}

// ════════════════════════════════════════════════════════
// DÉFINITION DES SECTIONS EXPORTABLES
// ════════════════════════════════════════════════════════

function exportSections() {
  const data = getData();
  return [
    {
      id: "todos", icon: "✓", color: "var(--accent)",
      title: "Tâches",
      desc:  "Liste de tâches avec statut, priorité, échéances et rappels.",
      count: (data.todos || []).length + " tâche(s)",
      formats:  ["json", "md", "csv"],
      data:     () => data.todos || [],
      md:       () => todosToMarkdown(data.todos || []),
      csv:      () => todosToCsv(data.todos || []),
      filename: "todos",
    },
    {
      id: "snippets", icon: "</>", color: "var(--code-color, var(--accent))",
      title: "Snippets",
      desc:  "Fragments de code avec langage, tags et favoris.",
      count: (data.snippets || []).length + " snippet(s)",
      formats:  ["json", "md", "zip"],
      data:     () => ({ snippets: data.snippets || [], folders: data.snippetFolders || null }),
      md:       () => snippetsToMarkdown(data.snippets || []),
      zip:      () => snippetsToZipFiles(data.snippets || []),
      filename: "snippets",
    },
    {
      id: "journal", icon: "📓", color: "var(--accent)",
      title: "Journal",
      desc:  "Entrées datées du journal personnel.",
      count: (data.journal || []).length + " entrée(s)",
      formats:  ["json", "md", "zip"],
      data:     () => data.journal || [],
      md:       () => journalToMarkdown(data.journal || []),
      zip:      () => journalToZipFiles(data.journal || []),
      filename: "journal",
    },
    {
      id: "rh", icon: "📋", color: "var(--success)",
      title: "Notes RH",
      desc:  "Arborescence des dossiers et fiches RH.",
      count: countTreeItems(data.rh) + " note(s)",
      formats:  ["json", "md"],
      data:     () => data.rh || null,
      md:       () => treeToMarkdown(data.rh, "Notes RH"),
      filename: "rh",
    },
    {
      id: "projects", icon: "▦", color: "var(--info-color, var(--accent))",
      title: "Projets",
      desc:  "Tous les projets avec leurs catégories et leur contenu.",
      count: (data.projects || []).length + " projet(s)",
      formats:  ["json", "md", "zip"],
      data:     () => data.projects || [],
      md:       () => projectsToMarkdown(data.projects || []),
      zip:      () => projectsToZipFiles(data.projects || []),
      filename: "projets",
    },
    {
      id: "favorites", icon: "★", color: "var(--warning, #f0a030)",
      title: "Favoris",
      desc:  "Arborescence des éléments mis en favoris.",
      count: countTreeItems(data.favorites) + " entrée(s)",
      formats:  ["json", "md"],
      data:     () => data.favorites || null,
      md:       () => treeToMarkdown(data.favorites, "Favoris"),
      filename: "favoris",
    },
    {
      id: "settings", icon: "⚙", color: "var(--text-2)",
      title: "Paramètres",
      desc:  "Préférences (thème, priorités personnalisées).",
      count: "Configuration",
      formats:  ["json"],
      data:     () => data.settings || {},
      filename: "parametres",
    },
  ];
}

// ════════════════════════════════════════════════════════
// RENDU
// ════════════════════════════════════════════════════════

function renderStats() {
  const statsEl = document.getElementById("export-stats");
  if (!statsEl) return;
  const data  = getData();
  const total =
    (data.todos     || []).length +
    (data.snippets  || []).length +
    (data.journal   || []).length +
    (data.projects  || []).length +
    countTreeItems(data.rh) +
    countTreeItems(data.favorites);
  statsEl.textContent = total + " élément" + (total > 1 ? "s" : "") + " au total";
}

function renderSections() {
  const grid = document.getElementById("export-grid");
  if (!grid) return;
  grid.innerHTML = "";
  exportSections().forEach((s) => {
    const card = document.createElement("div");
    card.className = "export-card";
    card.innerHTML = `
      <div class="export-card-head">
        <div class="export-card-icon" style="color:${s.color}">${escHtml(s.icon)}</div>
        <div class="export-card-titles">
          <h3>${escHtml(s.title)}</h3>
          <div class="export-card-count">${escHtml(s.count)}</div>
        </div>
      </div>
      <p class="export-card-desc">${escHtml(s.desc)}</p>
      <div class="export-card-actions">
        ${s.formats
          .map(
            (f) =>
              `<button class="btn btn-ghost export-fmt-btn" data-fmt="${f}">
                 <span class="export-fmt-badge ${f}">${f.toUpperCase()}</span>
                 Télécharger
               </button>`,
          )
          .join("")}
      </div>`;
    card.querySelectorAll(".export-fmt-btn").forEach((btn) =>
      btn.addEventListener("click", () =>
        handleSectionExport(s, /** @type {HTMLElement} */ (btn).dataset.fmt),
      ),
    );
    grid.appendChild(card);
  });
}

// ════════════════════════════════════════════════════════
// EXPORT PAR SECTION
// ════════════════════════════════════════════════════════

async function handleSectionExport(section, fmt) {
  try {
    const stamp = todayStamp();
    const base  = `workspace-${section.filename}-${stamp}`;

    if (fmt === "json") {
      downloadBlob(
        new Blob([JSON.stringify(section.data(), null, 2)], { type: "application/json" }),
        `${base}.json`,
      );
    } else if (fmt === "md") {
      downloadBlob(
        new Blob([section.md()], { type: "text/markdown;charset=utf-8" }),
        `${base}.md`,
      );
    } else if (fmt === "csv") {
      const result = await downloadBlob(
        new Blob([section.csv()], { type: "text/csv;charset=utf-8" }),
        `${base}.csv`,
      );
      if (result?.saved === false) return;
    } else if (fmt === "zip") {
      const files = section.zip();
      if (!files?.length) { showToast("Aucun contenu à inclure dans le ZIP", "error"); return; }
      const result = await downloadBlob(createZip(files), `${base}.zip`);
      if (result?.saved === false) return;
    }
    showToast(section.title + " exporté(e)", "success");
  } catch (err) {
    console.error("[export]", err);
    showToast("Erreur lors de l'export", "error");
  }
}

// ════════════════════════════════════════════════════════
// ACTIONS GLOBALES
// ════════════════════════════════════════════════════════

function bindGlobalActions() {
  document.getElementById("btn-export-all-json")
    ?.addEventListener("click", () => void exportAllJson());
  document.getElementById("btn-export-all-zip")
    ?.addEventListener("click", () => void exportAllZip());

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const a = /** @type {HTMLElement} */ (btn).dataset.action;
      if (a === "all-json") void exportAllJson();
      else if (a === "all-md")  void exportAllMarkdown();
      else if (a === "all-zip") void exportAllZip();
    });
  });
}

async function exportAllJson() {
  const payload = {
    _meta: { app: "Workspace", version: 6, exportedAt: new Date().toISOString() },
    data: getData(),
  };
  const result = await downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `workspace-complet-${todayStamp()}.json`,
  );
  if (result?.saved === false) return;
  showToast("Sauvegarde JSON téléchargée", "success");
}

async function exportAllMarkdown() {
  const parts = [
    `# Sauvegarde Workspace`,
    `_Exportée le ${new Date().toLocaleString("fr-FR")}_`,
    ``,
  ];
  exportSections().forEach((s) => {
    if (typeof s.md !== "function") return;
    parts.push(`\n\n---\n\n## ${s.title}\n`, s.md());
  });
  const result = await downloadBlob(
    new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8" }),
    `workspace-complet-${todayStamp()}.md`,
  );
  if (result?.saved === false) return;
  showToast("Sauvegarde Markdown téléchargée", "success");
}

async function exportAllZip() {
  const stamp = todayStamp();
  const files = [
    {
      name: "workspace.json",
      content: JSON.stringify(
        { _meta: { app: "Workspace", version: 6, exportedAt: new Date().toISOString() }, data: getData() },
        null,
        2,
      ),
    },
    { name: "README.md", content: zipReadme() },
  ];

  exportSections().forEach((s) => {
    const dir = s.filename + "/";
    files.push({ name: dir + s.filename + ".json", content: JSON.stringify(s.data(), null, 2) });
    if (typeof s.md  === "function") files.push({ name: dir + s.filename + ".md",  content: s.md() });
    if (typeof s.zip === "function") {
      s.zip().forEach((f) => files.push({ name: dir + "items/" + f.name, content: f.content }));
    }
  });

  const result = await downloadBlob(createZip(files), `workspace-complet-${stamp}.zip`);
  if (result?.saved === false) return;
  showToast("Archive ZIP téléchargée", "success");
}

function zipReadme() {
  return [
    "# Workspace — Sauvegarde",
    "",
    "Exportée le " + new Date().toLocaleString("fr-FR") + ".",
    "",
    "## Contenu",
    "",
    "- `workspace.json`            — sauvegarde complète ré-importable depuis la page Export.",
    "- `<section>/<section>.json`  — données brutes d'une section.",
    "- `<section>/<section>.md`    — version Markdown lisible.",
    "- `<section>/items/`          — fichiers individuels (snippets, entrées journal, projets).",
    "",
    "Toutes les données proviennent du stockage local IndexedDB de votre navigateur.",
  ].join("\n");
}

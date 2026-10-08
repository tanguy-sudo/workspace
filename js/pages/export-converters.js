// @ts-check
// ── pages/export-converters.js ──
// Convertisseurs de données → Markdown, CSV, fichiers ZIP.
// Aucune dépendance DOM : fonctions pures utilisables partout.

// ════════════════════════════════════════════════════════
// TÂCHES
// ════════════════════════════════════════════════════════

function todosToMarkdown(todos) {
  if (!todos.length) return "_Aucune tâche._";
  const byStatus = {};
  todos.forEach((t) => {
    const k = t.status || (t.done ? "done" : "todo");
    (byStatus[k] = byStatus[k] || []).push(t);
  });
  const order  = ["todo", "in-progress", "blocked", "done"];
  const labels = {
    todo:        "À faire",
    "in-progress": "En cours",
    blocked:     "Bloqué",
    done:        "Terminées",
  };
  const out = ["# Tâches", ""];
  order.forEach((k) => {
    if (!byStatus[k]) return;
    out.push(`## ${labels[k] || k}`, "");
    byStatus[k].forEach((t) => {
      const tick = k === "done" ? "x" : " ";
      const prio = t.priority ? ` _[${t.priority}]_` : "";
      const due  = t.dueDate   ? ` 📅 ${t.dueDate}` : "";
      const rem  = t.reminderAt
        ? " ⏰ " + new Date(t.reminderAt).toLocaleString("fr-FR")
        : "";
      const pin  = t.pinned ? " 📌" : "";
      out.push(`- [${tick}] ${t.title || "(sans titre)"}${prio}${due}${rem}${pin}`);
      if (t.note) {
        out.push(...t.note.split("\n").map((l) => "  " + l));
      }
    });
    out.push("");
  });
  // Statuts hors ordre standard
  Object.keys(byStatus)
    .filter((k) => !order.includes(k))
    .forEach((k) => {
      out.push(`## ${labels[k] || k}`, "");
      byStatus[k].forEach((t) => out.push(`- ${t.title || "(sans titre)"}`));
      out.push("");
    });
  return out.join("\n");
}

function todosToCsv(todos) {
  const cols = [
    "id", "title", "status", "priority",
    "dueDate", "reminderAt", "pinned", "createdAt", "note",
  ];
  const rows = [cols.join(",")];
  todos.forEach((t) => {
    rows.push(cols.map((c) => csvField(t[c])).join(","));
  });
  return rows.join("\n");
}

// ════════════════════════════════════════════════════════
// SNIPPETS
// ════════════════════════════════════════════════════════

function snippetsToMarkdown(snippets) {
  if (!snippets.length) return "_Aucun snippet._";
  const out = ["# Snippets", ""];
  snippets.forEach((s) => {
    out.push(`## ${s.title || "(sans titre)"}`);
    if (s.tags && s.tags.length) out.push(`_Tags : ${s.tags.join(", ")}_`);
    if (s.language) out.push(`_Langage : ${s.language}_`);
    out.push("", "```" + (s.language || ""), s.code || "", "```", "");
  });
  return out.join("\n");
}

function snippetsToZipFiles(snippets) {
  return snippets.map((s) => ({
    name:
      slugifyFile(s.title || s.id) +
      "." +
      (extForLang(s.language) || "txt"),
    content: s.code || "",
  }));
}

// ════════════════════════════════════════════════════════
// JOURNAL
// ════════════════════════════════════════════════════════

function journalToMarkdown(entries) {
  if (!entries.length) return "_Aucune entrée._";
  const sorted = entries
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const out = ["# Journal", ""];
  sorted.forEach((e) => {
    const date = new Date(e.createdAt).toLocaleString("fr-FR");
    out.push(`## ${e.title || date}`);
    out.push(
      `_${date}` +
        (e.mood ? " · humeur : " + e.mood : "") +
        (e.tags && e.tags.length ? " · " + e.tags.join(", ") : "") +
        "_",
    );
    out.push("", e.content || "_(vide)_", "");
  });
  return out.join("\n");
}

function journalToZipFiles(entries) {
  return entries.map((e) => {
    const d     = new Date(e.createdAt);
    const stamp =
      d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    const slug  = slugifyFile(e.title || "entree");
    return {
      name: `${stamp}-${slug}.md`,
      content:
        `# ${e.title || "Entrée du " + d.toLocaleDateString("fr-FR")}\n` +
        `_${d.toLocaleString("fr-FR")}${e.mood ? " · " + e.mood : ""}_\n\n` +
        (e.content || ""),
    };
  });
}

// ════════════════════════════════════════════════════════
// PROJETS
// ════════════════════════════════════════════════════════

function projectsToMarkdown(projects) {
  if (!projects.length) return "_Aucun projet._";
  const out = ["# Projets", ""];
  projects.forEach((p) => {
    out.push(`## ${p.name}`);
    if (p.categories && p.categories.length)
      out.push(`_Catégories : ${p.categories.join(", ")}_`);
    out.push("", treeChildrenToMarkdown(p.children || [], 0), "");
  });
  return out.join("\n");
}

function projectsToZipFiles(projects) {
  const out = [];
  projects.forEach((p) => {
    out.push({
      name: slugifyFile(p.name) + "/_project.md",
      content:
        `# ${p.name}\n\n` +
        ((p.categories || []).length
          ? `_Catégories : ${p.categories.join(", ")}_\n\n`
          : "") +
        treeChildrenToMarkdown(p.children || [], 0),
    });
    walkItems(p.children || [], (item, path) => {
      out.push({
        name:
          slugifyFile(p.name) +
          "/" +
          path.map(slugifyFile).join("/") +
          (path.length ? "/" : "") +
          slugifyFile(item.name || item.title || item.id) +
          ".md",
        content: itemToMarkdown(item),
      });
    });
  });
  return out;
}

// ════════════════════════════════════════════════════════
// ARBRES GÉNÉRIQUES (RH, Favoris)
// ════════════════════════════════════════════════════════

function treeToMarkdown(tree, title) {
  if (!tree) return "_Aucune donnée._";
  return `# ${title}\n\n` + treeChildrenToMarkdown(tree.children || [], 0);
}

function treeChildrenToMarkdown(children, depth) {
  if (!children || !children.length) return depth === 0 ? "_(vide)_" : "";
  const lines = [];
  children.forEach((c) => {
    if (c.nodeType === "folder") {
      lines.push("  ".repeat(depth) + `- 📁 **${c.name || "(dossier)"}**`);
      const sub = treeChildrenToMarkdown(c.children || [], depth + 1);
      if (sub) lines.push(sub);
    } else {
      lines.push(
        "  ".repeat(depth) +
          `- 📄 **${c.name || c.title || "(sans titre)"}**`,
      );
      if (c.note) {
        String(c.note)
          .split("\n")
          .forEach((l) => lines.push("  ".repeat(depth + 1) + "> " + l));
      }
    }
  });
  return lines.filter(Boolean).join("\n");
}

function itemToMarkdown(item) {
  return (
    `# ${item.name || item.title || "(sans titre)"}\n\n` +
    (item.tags && item.tags.length
      ? `_Tags : ${item.tags.join(", ")}_\n\n`
      : "") +
    (item.note || item.content || "") +
    "\n"
  );
}

/** Parcourt récursivement les nœuds feuilles d'un arbre de projets. */
function walkItems(children, fn, path = []) {
  if (!children) return;
  children.forEach((c) => {
    if (c.nodeType === "folder") {
      walkItems(c.children || [], fn, [...path, c.name || "dossier"]);
    } else {
      fn(c, path);
    }
  });
}

// ════════════════════════════════════════════════════════
// UTILITAIRES PURS
// ════════════════════════════════════════════════════════

/** Retourne la date du jour au format YYYY-MM-DD. */
function todayStamp() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

/** Transforme une chaîne en slug valide pour un nom de fichier. */
function slugifyFile(s) {
  return (
    String(s || "sans-titre")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sans-titre"
  );
}

/** Retourne l'extension de fichier associée à un langage de snippet. */
function extForLang(lang) {
  const map = {
    javascript: "js",   typescript: "ts",  python: "py",
    ruby:       "rb",   java:       "java", csharp: "cs",
    cpp:        "cpp",  c:          "c",   go:     "go",
    rust:       "rs",   php:        "php", html:   "html",
    css:        "css",  scss:       "scss", json:  "json",
    yaml:       "yml",  xml:        "xml", markdown: "md",
    bash:       "sh",   shell:      "sh",  sql:    "sql",
    powershell: "ps1",  kotlin:     "kt",  swift:  "swift",
  };
  return map[(lang || "").toLowerCase()] || null;
}

/** Formate un champ pour inclusion dans un fichier CSV (RFC-4180). */
function csvField(v) {
  if (v == null) return "";
  const s = String(v);
  if (typeof v === "number") return s;
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Ouvre l'enregistrement natif si possible, sinon déclenche un téléchargement. */
async function downloadBlob(blob, filename) {
  if (typeof saveBlobAsFile === "function") {
    return saveBlobAsFile(blob, filename, { preferPicker: true });
  }

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// @ts-check
// ── markdown-editor.js ──
// Éditeur Markdown léger, sans dépendance, pour notes / fiches RH / contextes.
// - Toolbar : titres, gras, italique, listes, liens, code, citation, tâche, tableau, image
// - Modes : Édition / Aperçu / Split (côte à côte)
// - Raccourcis : Ctrl+B, Ctrl+I, Ctrl+K, Tab, Shift+Tab
// - Conserve les wiki-links [[titre]] (rendus via wiki-links.js si présent)
// - Rendu Markdown maison, échappé HTML → safe par construction
//
// API publique :
//   const ed = createMarkdownEditor({ initialValue, placeholder, minHeight, onChange });
//   document.body.appendChild(ed.root);
//   ed.getValue();  ed.setValue(s);  ed.focus();
//   window.renderMarkdown(text)         → string HTML
//   window.renderMarkdownInto(el, text) → rend + bind wiki-links

(function () {
  // ─────────────────────────────────────────────────────────
  // Renderer Markdown minimal (suffisant pour des notes)
  // ─────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInline(text) {
    let s = esc(text);
    // code inline
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    // gras / italique / barré
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/(^|[^a-z0-9])_([^_]+)_/gi, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    // images ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) =>
      isSafeUrl(u) ? `<img alt="${a}" src="${u}">` : esc(`![${a}](${u})`),
    );
    // liens [txt](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
      isSafeUrl(u)
        ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>`
        : esc(`[${t}](${u})`),
    );
    // URLs nues
    s = s.replace(
      /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`,
    );
    // wiki-links [[titre]] : on rend un span, wiki-links.js les bindera plus tard
    s = s.replace(
      /\[\[([^\]\n]+)\]\]/g,
      (_, t) =>
        `<span class="wiki-link" data-wiki="${t.trim()}">[[${t}]]</span>`,
    );
    return s;
  }

  function isSafeUrl(u) {
    if (typeof safeUrl === "function") return !!safeUrl(u);
    const s = String(u || "").trim();
    if (!s) return false;
    return /^(https?:|mailto:|#|\/|\.\.?\/)/i.test(s) && !s.startsWith("//");
  }

  // Rendu d'un bloc de lignes de liste avec support de l'indentation (listes imbriquées)
  function renderListBlock(listLines) {
    const parsed = listLines.map((l) => {
      const indent = (l.match(/^(\s*)/) || ["", ""])[1].length;
      const isOrdered = /^\s*\d+\./.test(l);
      const raw = l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
      const task = raw.match(/^\[([ xX])\]\s+(.*)$/);
      return { indent, isOrdered, raw, task };
    });

    let result = "";
    const stack = []; // { tag, indent }

    for (const item of parsed) {
      // Fermer les niveaux plus profonds
      while (stack.length > 0 && stack[stack.length - 1].indent > item.indent) {
        result += `</${stack.pop().tag}>`;
      }
      // Ouvrir un nouveau niveau si nécessaire
      if (stack.length === 0 || stack[stack.length - 1].indent < item.indent) {
        const tag = item.isOrdered ? "ol" : "ul";
        stack.push({ tag, indent: item.indent });
        result += `<${tag}>`;
      }
      // Émettre l'item
      if (item.task) {
        const checked = item.task[1].toLowerCase() === "x";
        result += `<li class="task-item"><input type="checkbox" disabled${checked ? " checked" : ""}> ${renderInline(item.task[2])}</li>`;
      } else {
        result += `<li>${renderInline(item.raw)}</li>`;
      }
    }
    // Fermer tous les niveaux ouverts
    while (stack.length > 0) {
      result += `</${stack.pop().tag}>`;
    }
    return result;
  }

  function isHorizontalRuleLine(line) {
    return /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(
      String(line || ""),
    );
  }

  function render(md) {
    if (!md) return "";
    const lines = String(md).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Bloc code ```lang
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        const lang = fence[1] || "";
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i]))
          buf.push(lines[i++]);
        i++;
        out.push(
          `<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(buf.join("\n"))}</code></pre>`,
        );
        continue;
      }

      // Titres
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`);
        i++;
        continue;
      }

      // Séparateur
      if (isHorizontalRuleLine(line)) {
        out.push("<hr>");
        i++;
        continue;
      }

      // Citation
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        out.push(`<blockquote>${render(buf.join("\n"))}</blockquote>`);
        continue;
      }

      // Listes (puces, numérotées, cases à cocher) — avec support imbrication
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const listLines = [];
        while (
          i < lines.length &&
          (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))
        ) {
          listLines.push(lines[i]);
          i++;
        }
        out.push(renderListBlock(listLines));
        continue;
      }

      // Tableau GFM minimal
      if (
        /\|/.test(line) &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:-]+\|[\s:|\-]+/.test(lines[i + 1])
      ) {
        const header = splitRow(line);
        i += 2;
        const rows = [];
        while (
          i < lines.length &&
          /\|/.test(lines[i]) &&
          lines[i].trim() !== ""
        ) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push(
          '<div class="md-table-wrap"><table><thead><tr>' +
            header.map((h) => `<th>${renderInline(h)}</th>`).join("") +
            "</tr></thead><tbody>" +
            rows
              .map(
                (r) =>
                  "<tr>" +
                  r.map((c) => `<td>${renderInline(c)}</td>`).join("") +
                  "</tr>",
              )
              .join("") +
            "</tbody></table></div>",
        );
        continue;
      }

      // Ligne vide
      if (!line.trim()) {
        i++;
        continue;
      }

      // Paragraphe (regroupe lignes consécutives)
      const buf = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6}\s|>\s|```|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i]) &&
        !isHorizontalRuleLine(lines[i]) &&
        !(
          /\|/.test(lines[i]) &&
          i + 1 < lines.length &&
          /^\s*\|?[\s:-]+\|/.test(lines[i + 1])
        )
      ) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<p>${renderInline(buf.join("\n").replace(/\n/g, "<br>"))}</p>`);
    }

    return out.join("\n");
  }

  function splitRow(line) {
    return line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim());
  }

  // ─────────────────────────────────────────────────────────
  // API rendu
  // ─────────────────────────────────────────────────────────
  window.renderMarkdown = render;
  window.renderMarkdownInto = function (el, text) {
    if (!el) return;
    el.classList.add("md-rendered");
    el.innerHTML = render(text || "");
    // wiki-links : si la page expose un resolver + onClick, on les bind après coup.
    if (
      typeof bindWikiLinks === "function" &&
      typeof getWikiResolver === "function"
    ) {
      try {
        const resolver = getWikiResolver();
        bindWikiLinks(el, resolver, (n) => {
          if (n?.url) window.open(n.url, "_blank");
        });
      } catch (_) {}
    }
  };

  // ─────────────────────────────────────────────────────────
  // Éditeur
  // ─────────────────────────────────────────────────────────
  const TOOLBAR = [
    { cmd: "h", label: "H1", title: "Titre (Ctrl+1/2/3)" },
    { cmd: "bold", label: "B", title: "Gras (Ctrl+B)" },
    { cmd: "italic", label: "I", title: "Italique (Ctrl+I)" },
    { cmd: "strike", label: "S", title: "Barré" },
    { sep: true },
    { cmd: "link", label: "🔗", title: "Lien (Ctrl+K)" },
    { cmd: "image", label: "🖼", title: "Image" },
    { sep: true },
    { cmd: "ul", label: "•", title: "Liste à puces" },
    { cmd: "ol", label: "1.", title: "Liste numérotée" },
    { cmd: "task", label: "☑", title: "Case à cocher" },
    { sep: true },
    { cmd: "quote", label: "❝", title: "Citation" },
    { cmd: "code", label: "`", title: "Code inline" },
    { cmd: "codeblock", label: "{ }", title: "Bloc de code" },
    { cmd: "table", label: "⊞", title: "Tableau" },
    { cmd: "hr", label: "—", title: "Séparateur" },
    { sep: true },
    { cmd: "wiki", label: "[[ ]]", title: "Lien wiki" },
  ];

  window.createMarkdownEditor = function (opts = {}) {
    const {
      initialValue = "",
      placeholder = "Écrivez en Markdown…  **gras**  *italique*  [lien](url)  `code`  - liste",
      minHeight = 140,
      onChange,
    } = opts;

    const root = document.createElement("div");
    root.className = "md-editor";
    root.innerHTML = `
      <div class="md-toolbar">
        ${TOOLBAR.map((b) =>
          b.sep
            ? `<span class="md-sep"></span>`
            : `<button type="button" class="md-btn" data-cmd="${b.cmd}" title="${b.title}">${b.label}</button>`,
        ).join("")}
        <span class="md-spacer"></span>
        <div class="md-mode" role="tablist">
          <button type="button" class="md-mode-btn active" data-mode="edit">Édition</button>
          <button type="button" class="md-mode-btn" data-mode="split">Côte à côte</button>
          <button type="button" class="md-mode-btn" data-mode="preview">Aperçu</button>
        </div>
      </div>
      <div class="md-body">
        <textarea class="md-input" spellcheck="true" placeholder="${esc(placeholder)}"></textarea>
        <div class="md-preview md-rendered"></div>
      </div>`;
    const ta = root.querySelector(".md-input");
    const preview = root.querySelector(".md-preview");
    ta.style.minHeight = minHeight + "px";
    ta.value = initialValue || "";

    // Autosize
    const autosize = () => {
      ta.style.height = "auto";
      ta.style.height = Math.max(minHeight, ta.scrollHeight) + "px";
    };
    setTimeout(autosize, 0);
    ta.addEventListener("input", () => {
      autosize();
      if (root.dataset.mode !== "edit") refreshPreview();
      onChange?.(ta.value);
    });

    // Modes
    const refreshPreview = () => {
      window.renderMarkdownInto(preview, ta.value);
    };
    const setMode = (mode) => {
      root.dataset.mode = mode;
      root
        .querySelectorAll(".md-mode-btn")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
      if (mode !== "edit") refreshPreview();
    };
    root
      .querySelectorAll(".md-mode-btn")
      .forEach((b) =>
        b.addEventListener("click", () => setMode(b.dataset.mode)),
      );
    setMode("edit");

    // Boutons
    root
      .querySelectorAll(".md-btn")
      .forEach((b) =>
        b.addEventListener("click", () => applyCmd(b.dataset.cmd)),
      );

    // Raccourcis
    ta.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (k === "b") {
          e.preventDefault();
          applyCmd("bold");
          return;
        }
        if (k === "i") {
          e.preventDefault();
          applyCmd("italic");
          return;
        }
        if (k === "k") {
          e.preventDefault();
          applyCmd("link");
          return;
        }
        if (k === "1" || k === "2" || k === "3") {
          e.preventDefault();
          wrapLine("#".repeat(parseInt(k, 10)) + " ");
          return;
        }
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) outdent();
        else indent();
        return;
      }
      if (e.key === "Enter") {
        // Continuation de listes
        const { line } = selectionInfo();
        const m =
          line.match(/^(\s*)([-*+]\s+\[([ x])\]\s+)/) ||
          line.match(/^(\s*)([-*+]\s+)/) ||
          line.match(/^(\s*)(\d+)\.\s+/);
        if (m) {
          // Si la ligne courante est vide après le marqueur → on l'efface
          const afterMarker = line.slice(m[0].length);
          if (!afterMarker.trim()) {
            e.preventDefault();
            replaceCurrentLine("");
            return;
          }
          e.preventDefault();
          let next;
          if (m[3] !== undefined) {
            // [ ] → on garde [ ]
            next = "\n" + m[1] + "- [ ] ";
          } else if (/^\d+$/.test(m[2])) {
            next = "\n" + m[1] + (parseInt(m[2], 10) + 1) + ". ";
          } else {
            next = "\n" + m[1] + m[2];
          }
          insertAtCursor(next);
        }
      }
    });

    // ─── Commandes ──────────────────────────────────────
    function applyCmd(cmd) {
      switch (cmd) {
        case "bold":
          return wrapSel("**", "**", "texte en gras");
        case "italic":
          return wrapSel("*", "*", "texte en italique");
        case "strike":
          return wrapSel("~~", "~~", "texte barré");
        case "code":
          return wrapSel("`", "`", "code");
        case "h":
          return wrapLine("# ");
        case "ul":
          return wrapLine("- ");
        case "ol":
          return wrapLine("1. ");
        case "task":
          return wrapLine("- [ ] ");
        case "quote":
          return wrapLine("> ");
        case "link": {
          const url = prompt("URL du lien :", "https://");
          if (url == null) return;
          return wrapSel("[", `](${url})`, "texte du lien");
        }
        case "image": {
          const url = prompt("URL de l'image :", "https://");
          if (url == null) return;
          return wrapSel("![", `](${url})`, "alt");
        }
        case "wiki":
          return wrapSel("[[", "]]", "Titre");
        case "codeblock":
          return insertAround("\n```\n", "\n```\n", "code");
        case "table":
          return insertAtCursor(
            "\n| Colonne 1 | Colonne 2 |\n| --- | --- |\n| valeur | valeur |\n",
          );
        case "hr":
          return insertAtCursor("\n\n***\n\n");
      }
    }

    function selectionInfo() {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = ta.value;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = value.indexOf("\n", end);
      const line = value.slice(
        lineStart,
        lineEnd === -1 ? value.length : lineEnd,
      );
      return { start, end, value, lineStart, lineEnd, line };
    }

    function wrapSel(prefix, suffix, placeholderText) {
      const { start, end, value } = selectionInfo();
      const sel = value.slice(start, end) || placeholderText;
      const replacement = prefix + sel + suffix;
      ta.setRangeText(replacement, start, end, "end");
      if (!value.slice(start, end)) {
        ta.selectionStart = start + prefix.length;
        ta.selectionEnd = start + prefix.length + placeholderText.length;
      }
      ta.dispatchEvent(new Event("input"));
      ta.focus();
    }

    function insertAround(prefix, suffix, placeholderText) {
      wrapSel(prefix, suffix, placeholderText);
    }

    function wrapLine(prefix) {
      const { start, end, value, lineStart, lineEnd } = selectionInfo();
      const blockEnd = lineEnd === -1 ? value.length : lineEnd;
      const block = value.slice(lineStart, blockEnd);
      const replaced = block
        .split("\n")
        .map((l) => prefix + l)
        .join("\n");
      ta.setRangeText(replaced, lineStart, blockEnd, "end");
      ta.dispatchEvent(new Event("input"));
      ta.focus();
    }

    function replaceCurrentLine(text) {
      const { value, lineStart, lineEnd } = selectionInfo();
      const blockEnd = lineEnd === -1 ? value.length : lineEnd;
      ta.setRangeText(text, lineStart, blockEnd, "end");
      ta.dispatchEvent(new Event("input"));
    }

    function insertAtCursor(text) {
      const { start, end } = selectionInfo();
      ta.setRangeText(text, start, end, "end");
      ta.dispatchEvent(new Event("input"));
      ta.focus();
    }

    function indent() {
      const { start, end, value, lineStart } = selectionInfo();
      if (start === end) {
        ta.setRangeText("  ", start, end, "end");
      } else {
        const block = value.slice(lineStart, end);
        const replaced = block
          .split("\n")
          .map((l) => "  " + l)
          .join("\n");
        ta.setRangeText(replaced, lineStart, end, "end");
      }
      ta.dispatchEvent(new Event("input"));
    }
    function outdent() {
      const { end, value, lineStart } = selectionInfo();
      const block = value.slice(lineStart, end);
      const replaced = block
        .split("\n")
        .map((l) => l.replace(/^( {1,2}|\t)/, ""))
        .join("\n");
      ta.setRangeText(replaced, lineStart, end, "end");
      ta.dispatchEvent(new Event("input"));
    }

    return {
      root,
      getValue: () => ta.value,
      setValue: (v) => {
        ta.value = v || "";
        autosize();
        if (root.dataset.mode !== "edit") refreshPreview();
      },
      focus: () => ta.focus(),
      textarea: ta,
    };
  };
})();

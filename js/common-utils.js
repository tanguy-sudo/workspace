// @ts-check
// ── common-utils.js ── helpers partagés ──
//
// PATTERN D'UTILISATION :
// - Utilisé par: components.js, project.js, export.js, rh.js et d'autres pages
// - Charge sur toutes les pages HTML (après db.js, avant components.js)
// - Fournit: debounce, walkTree, countTreeNodes, collectTreeNodes
//
// IMPORTANT REFACTOR (v2026.06) :
// Les fonctions _countAll() et _countFolders() ont été supprimées de components.js
// au profit de countTreeNodes() avec prédicats pour meilleure réutilisabilité.
// Exemple:
//   countTreeNodes(children, (n) => n.nodeType === "item" && n.type === "link")

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function walkTree(children, visitor, path = []) {
  if (!children) return;
  children.forEach((node) => {
    visitor(node, path);
    if (node.nodeType === "folder") {
      walkTree(node.children || [], visitor, [...path, node.name || "dossier"]);
    }
  });
}

function countTreeNodes(children, predicate = () => true) {
  let count = 0;
  walkTree(children, (node, path) => {
    if (predicate(node, path)) count++;
  });
  return count;
}

function collectTreeNodes(children, predicate = () => true) {
  const nodes = [];
  walkTree(children, (node, path) => {
    if (predicate(node, path)) nodes.push(node);
  });
  return nodes;
}

/** Returns a browser-safe URL, or null for unsupported schemes and origins. */
function safeUrl(value, baseHref) {
  const raw = String(value ?? "").trim();
  if (!raw || /[\u0000-\u001f\u007f\\]/.test(raw) || raw.startsWith("//")) return null;
  if (raw.startsWith("#")) return raw;
  const explicit = raw.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (explicit && !["http", "https", "mailto"].includes(explicit)) return null;
  try {
    const base = new URL(baseHref || (typeof location !== "undefined" ? location.href : "https://workspace.invalid/"));
    const parsed = new URL(raw, base);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return !explicit && parsed.origin === base.origin ? raw : parsed.href;
  } catch (_) {
    return null;
  }
}

function sanitizePreviewCss(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/<\/?style/gi, "")
    .replace(/@import[^;{}]*(?:;|$)/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/(?:behavior|-moz-binding)\s*:[^;{}]*(?:;|$)/gi, "")
    .replace(/javascript\s*:/gi, "");
}

function sanitizePreviewHtml(value) {
  const source = String(value ?? "");
  if (typeof DOMParser === "undefined") return escHtml(source);
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed.querySelectorAll("script, iframe, object, embed, form, base, link, meta, svg, math, template").forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "action" || name === "formaction") element.removeAttribute(attribute.name);
      else if (name === "href" || name === "src") {
        const url = safeUrl(attribute.value, "https://preview.invalid/");
        if (url) element.setAttribute(attribute.name, url); else element.removeAttribute(attribute.name);
      } else if (name === "style") {
        const css = sanitizePreviewCss(attribute.value);
        if (css) element.setAttribute(attribute.name, css); else element.removeAttribute(attribute.name);
      }
    });
  });
  parsed.querySelectorAll("style").forEach((style) => { style.textContent = sanitizePreviewCss(style.textContent); });
  return parsed.body.innerHTML;
}

function countTreeItems(tree) {
  return countTreeNodes(tree?.children || [], (node) => node.nodeType !== "folder");
}

function parseEstimatedTimeExpression(input) {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      return { valid: false, minutes: 0, error: "invalid-number", raw: String(input) };
    }
    return { valid: true, minutes: Math.floor(input), raw: String(input) };
  }

  const raw = String(input ?? "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, minutes: 0, raw, empty: true };
  }

  if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) {
    return { valid: false, minutes: 0, error: "invalid-chars", raw };
  }

  let idx = 0;

  function skipSpaces() {
    while (idx < trimmed.length && /\s/.test(trimmed[idx])) idx += 1;
  }

  function parseNumber() {
    skipSpaces();
    const start = idx;
    let sawDigit = false;
    let sawDot = false;

    while (idx < trimmed.length) {
      const ch = trimmed[idx];
      if (ch >= "0" && ch <= "9") {
        sawDigit = true;
        idx += 1;
        continue;
      }
      if (ch === ".") {
        if (sawDot) break;
        sawDot = true;
        idx += 1;
        continue;
      }
      break;
    }

    if (!sawDigit) return null;
    const n = Number(trimmed.slice(start, idx));
    return Number.isFinite(n) ? n : null;
  }

  function parsePrimary() {
    skipSpaces();
    if (trimmed[idx] === "(") {
      idx += 1;
      const v = parseExpression();
      skipSpaces();
      if (trimmed[idx] !== ")") throw new Error("missing-paren");
      idx += 1;
      return v;
    }
    const n = parseNumber();
    if (n === null) throw new Error("invalid-number");
    return n;
  }

  function parseUnary() {
    skipSpaces();
    const ch = trimmed[idx];
    if (ch === "+") {
      idx += 1;
      return parseUnary();
    }
    if (ch === "-") {
      idx += 1;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parseTerm() {
    let value = parseUnary();
    while (true) {
      skipSpaces();
      const op = trimmed[idx];
      if (op !== "*" && op !== "/") break;
      idx += 1;
      const rhs = parseUnary();
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (true) {
      skipSpaces();
      const op = trimmed[idx];
      if (op !== "+" && op !== "-") break;
      idx += 1;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  let result;
  try {
    result = parseExpression();
    skipSpaces();
    if (idx !== trimmed.length) {
      return { valid: false, minutes: 0, error: "trailing-chars", raw };
    }
  } catch (_) {
    return { valid: false, minutes: 0, error: "parse-error", raw };
  }

  if (!Number.isFinite(result) || result < 0) {
    return { valid: false, minutes: 0, error: "out-of-range", raw };
  }

  return {
    valid: true,
    minutes: Math.floor(result),
    raw,
    evaluated: result,
  };
}

function parseEstimatedTimeMinutes(input, fallback = 0) {
  const parsed = parseEstimatedTimeExpression(input);
  return parsed.valid ? parsed.minutes : fallback;
}

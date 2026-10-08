// @ts-check
// ── wiki-links.js ── système de liens [[titre]] ──

/**
 * Transforme le texte brut en HTML avec les [[liens]] cliquables
 * @param {string} text
 * @param {Function} resolver - (title) => node|null  — retourne le nœud cible ou null
 * @param {Function} onClick  - (node) => void
 * @returns {string} HTML
 */
function renderWikiText(text, resolver, onClick) {
  if (!text) return '';
  // Échapper d'abord le HTML
  const escaped = escHtml(text);
  // Remplacer les [[...]]
  return escaped.replace(/\[\[([^\]]+)\]\]/g, (match, title) => {
    const node = resolver(title);
    const id   = 'wl-' + Math.random().toString(36).slice(2);
    // On stocke un data-attr pour attacher l'event après insertion dans le DOM
    if (node) {
      return `<span class="wiki-link" data-wiki-id="${id}" data-wiki-title="${escHtml(title)}">[[${escHtml(title)}]]</span>`;
    } else {
      return `<span class="wiki-link broken" title="Note introuvable : ${escHtml(title)}">[[${escHtml(title)}]]</span>`;
    }
  });
}

/**
 * Attache les handlers sur les wiki-links rendus dans un conteneur
 * @param {HTMLElement} container
 * @param {Function} resolver - (title) => node|null
 * @param {Function} onClick  - (node, title) => void
 */
function bindWikiLinks(container, resolver, onClick) {
  container.querySelectorAll('.wiki-link:not(.broken)').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const title = el.dataset.wikiTitle;
      const node  = resolver(title);
      if (node) onClick(node, title);
    });
  });
}

/**
 * Ouvre une modale avec le contenu d'un nœud wiki
 * @param {Object} node
 */
function openWikiModal(node) {
  const content = document.createElement('div');

  const safeNodeUrl = typeof safeUrl === 'function' ? safeUrl(node.url) : null;
  if (safeNodeUrl) {
    const urlEl = document.createElement('a');
    urlEl.href = safeNodeUrl; urlEl.target = '_blank'; urlEl.rel = 'noopener noreferrer';
    urlEl.textContent = safeNodeUrl;
    urlEl.style.cssText = 'font-family:var(--font-mono);font-size:.78rem;color:var(--link-color);display:block;margin-bottom:12px;word-break:break-all;';
    content.appendChild(urlEl);
  }

  if (node.note || node.code) {
    const noteText = node.code || node.note;
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;font-size:.84rem;color:var(--text-2);line-height:1.6;background:var(--bg-3);padding:12px;border-radius:8px;overflow-x:auto;font-family:' + (node.code ? 'var(--font-mono)' : 'var(--font-sans)');
    pre.textContent = noteText;
    content.appendChild(pre);
  }

  if (!safeNodeUrl && !node.note && !node.code) {
    content.innerHTML = '<p style="color:var(--text-3);font-size:.85rem">Aucun contenu.</p>';
  }

  createModal({
    title: node.title || node.name,
    content,
    onConfirm: () => {},
    confirmLabel: 'Fermer',
    hideCancel: true,
  });
}

// @ts-check
// ── highlight-init.js ── wrapper Highlight.js ──

function highlightAll() {
  if (typeof hljs !== 'undefined') {
    document.querySelectorAll('pre code').forEach(el => {
      hljs.highlightElement(el);
    });
  }
}

function highlightBlock(el) {
  if (typeof hljs !== 'undefined') hljs.highlightElement(el);
}

/** Crée un bloc code avec coloration syntaxique */
function createCodeBlock(code, language) {
  const wrap = document.createElement('div');
  wrap.className = 'code-block-wrap';

  const header = document.createElement('div');
  header.className = 'code-block-lang';
  header.innerHTML = `<span>${language || 'texte'}</span>`;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-icon';
  copyBtn.title = 'Copier';
  copyBtn.innerHTML = IC.copy;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.innerHTML = IC.check;
      setTimeout(() => { copyBtn.innerHTML = IC.copy; }, 1500);
    });
  });
  header.appendChild(copyBtn);

  const pre  = document.createElement('pre');
  const code_el = document.createElement('code');
  if (language) code_el.className = `language-${language}`;
  code_el.textContent = code;
  pre.appendChild(code_el);

  wrap.appendChild(header);
  wrap.appendChild(pre);

  // Colorer après insertion
  requestAnimationFrame(() => highlightBlock(code_el));
  return wrap;
}

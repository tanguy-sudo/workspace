const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\\]/;
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(value: unknown, base = 'https://workspace.invalid/'): string | null {
  const raw = String(value ?? '').trim();
  if (!raw || CONTROL_CHARACTERS.test(raw) || raw.startsWith('//')) return null;
  if (raw.startsWith('#')) return raw;

  const explicitProtocol = raw.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (explicitProtocol && !SAFE_PROTOCOLS.has(`${explicitProtocol}:`)) return null;

  try {
    const baseUrl = new URL(base);
    const parsed = new URL(raw, baseUrl);
    if (!SAFE_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) return null;
    if (explicitProtocol === undefined && parsed.origin === baseUrl.origin) return raw;
    return parsed.href;
  } catch {
    return null;
  }
}

function sanitizeCss(value: unknown): string {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/<\/?style/gi, '')
    .replace(/@import[^;{}]*(?:;|$)/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/(?:behavior|-moz-binding)\s*:[^;{}]*(?:;|$)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

export function sanitizePreviewCss(value: unknown): string {
  return sanitizeCss(value);
}

export function sanitizePreviewHtml(value: unknown): string {
  const source = String(value ?? '');
  if (typeof DOMParser === 'undefined') {
    return escapeHtml(source);
  }

  const document = new DOMParser().parseFromString(source, 'text/html');
  document.querySelectorAll('script, iframe, object, embed, form, base, link, meta, svg, math, template').forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'action' || name === 'formaction') {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'src') {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'href') {
        const url = safeUrl(attribute.value, 'https://preview.invalid/');
        if (!url) element.removeAttribute(attribute.name);
        else element.setAttribute(attribute.name, url);
        continue;
      }
      if (name === 'style') {
        const css = sanitizeCss(attribute.value);
        if (css) element.setAttribute(attribute.name, css);
        else element.removeAttribute(attribute.name);
      }
    }
  });
  document.querySelectorAll('style').forEach((style) => {
    style.textContent = sanitizeCss(style.textContent);
  });
  return document.body.innerHTML;
}

export function buildSandboxPreview(source: string, language: 'html' | 'css'): string {
  if (language === 'css') {
    return `<style>${sanitizeCss(source)}</style><div class="preview-sample"><p>Previsualisation CSS</p><h2>Titre exemple</h2><button>Bouton</button></div>`;
  }
  return sanitizePreviewHtml(source);
}

export function renderSafeMarkdown(value: unknown): string {
  const lines = String(value ?? '').replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      index += 1;
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
      output.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      output.push(`<blockquote>${renderSafeMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const list: string[] = [];
      while (index < lines.length && (/^\s*[-*+]\s+/.test(lines[index]) || /^\s*\d+\.\s+/.test(lines[index]))) list.push(lines[index++]);
      const ordered = /^\s*\d+\./.test(list[0]);
      const items = list.map((item) => item.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')).map((item) => {
        const task = item.match(/^\[([ xX])\]\s+(.*)$/);
        return task ? `<li><input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${renderInline(task[2])}</li>` : `<li>${renderInline(item)}</li>`;
      }).join('');
      output.push(`<${ordered ? 'ol' : 'ul'}>${items}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    if (/\|/.test(line) && index + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|\-]+/.test(lines[index + 1])) {
      const header = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /\|/.test(lines[index]) && lines[index].trim()) rows.push(splitRow(lines[index++]));
      output.push(`<table><thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|>\s|```|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[index])) paragraph.push(lines[index++]);
    output.push(`<p>${renderInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  return output.join('\n');
}

function renderInline(value: string): string {
  const tokens: string[] = [];
  const protect = (html: string): string => `\u0000${tokens.push(html) - 1}\u0000`;
  let text = value;

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, rawUrl) => {
    const url = safeUrl(rawUrl);
    return url ? protect(`<img alt="${escapeHtml(alt)}" src="${escapeHtml(url)}">`) : match;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, rawUrl) => {
    const url = safeUrl(rawUrl);
    return url ? protect(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`) : match;
  });
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (match, prefix, rawUrl) => {
    const url = safeUrl(rawUrl);
    return url ? `${prefix}${protect(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawUrl)}</a>`)}` : match;
  });
  text = text.replace(/\[\[([^\]\n]+)\]\]/g, (_match, title) => protect(`<span class="wiki-link" role="button" tabindex="0" data-wiki="${escapeHtml(title.trim())}">[[${escapeHtml(title)}]]</span>`));

  let escaped = escapeHtml(text);
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/(^|[^a-z0-9])_([^_]+)_/gi, '$1<em>$2</em>');
  escaped = escaped.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return escaped.replace(/\u0000(\d+)\u0000/g, (_match, token) => tokens[Number(token)] ?? '');
}

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
}

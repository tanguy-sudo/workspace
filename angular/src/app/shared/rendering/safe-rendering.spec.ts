import { renderSafeMarkdown, safeUrl } from './safe-rendering';

describe('safe rendering', () => {
  it('renders the supported markdown subset and wiki-links', () => {
    const html = renderSafeMarkdown('# Title\n\n**bold** *italic* `code`\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[[Policy]]');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('<span class="wiki-link" role="button" tabindex="0" data-wiki="Policy">');
  });

  it('escapes raw HTML and rejects dangerous URLs', () => {
    const html = renderSafeMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1)) ![bad](data:text/html,boom)');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img');
  });

  it('allows web, mail and local fragment URLs but rejects unsafe schemes', () => {
    expect(safeUrl('https://example.invalid/path')).toBe('https://example.invalid/path');
    expect(safeUrl('mailto:user@example.invalid')).toBe('mailto:user@example.invalid');
    expect(safeUrl('#section')).toBe('#section');
    expect(safeUrl('project.html?id=one')).toBe('project.html?id=one');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,alert(1)')).toBeNull();
    expect(safeUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeUrl('file:///C:/secret.txt')).toBeNull();
    expect(safeUrl('//evil.invalid/path')).toBeNull();
    expect(safeUrl('java\u0000script:alert(1)')).toBeNull();
    expect(safeUrl('https://user:password@example.invalid')).toBeNull();
    expect(safeUrl('https:\\evil.invalid/path')).toBeNull();
  });
});

// A small Markdown renderer. Everything is escaped before any tag is added, so
// text from the model or a web page can never become live HTML.
(function (root) {
  const escape = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function inline(text) {
    const codes = [];
    return escape(text)
      .replace(/`([^`\n]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[index]}</code>`);
  }

  function render(markdown) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    const flush = () => {
      if (paragraph.length) html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
      paragraph = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) {
        flush();
        const code = [];
        for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
        html.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
        continue;
      }
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      if (heading) {
        flush();
        const level = Math.min(heading[1].length + 1, 4);
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }
      const list = /^\s*([-*]|\d+\.)\s+/.exec(line);
      if (list) {
        flush();
        const tag = /\d/.test(list[1]) ? 'ol' : 'ul';
        const items = [];
        for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) {
          items.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
        }
        i--;
        html.push(`<${tag}>${items.join('')}</${tag}>`);
        continue;
      }
      if (line.startsWith('> ')) {
        flush();
        html.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
        continue;
      }
      if (!line.trim()) flush();
      else paragraph.push(line);
    }
    flush();
    return html.join('');
  }

  root.renderMarkdown = render;
})(globalThis);

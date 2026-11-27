import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export const escapeHTML = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function safeLink(url) {
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) return url;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Guide links must use local paths or HTTPS.');
  return url;
}
function inline(text) {
  const pattern = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/gu;
  let output = '', start = 0;
  for (const match of text.matchAll(pattern)) {
    output += escapeHTML(text.slice(start, match.index));
    if (match[1]) output += `<a href="${escapeHTML(safeLink(match[2]))}"${match[2].startsWith('https:') ? ' rel="noreferrer"' : ''}>${escapeHTML(match[1])}</a>`;
    else output += match[3] ? `<strong>${escapeHTML(match[3])}</strong>` : `<code>${escapeHTML(match[4])}</code>`;
    start = match.index + match[0].length;
  }
  return output + escapeHTML(text.slice(start));
}
// Supported Markdown: headings, paragraphs, lists, bold, inline code, links,
// single-line blockquotes, and local SVG diagrams. HTML is always escaped.
export function renderMarkdown(markdown) {
  let result = '', paragraph = [], list = null; const ids = new Set();
  const flush = () => { if (paragraph.length) { result += `<p>${inline(paragraph.join(' '))}</p>\n`; paragraph = []; } };
  const endList = () => { if (list) { result += `</${list}>\n`; list = null; } };
  for (const line of markdown.split('\n')) {
    if (!line.trim()) { flush(); endList(); continue; }
    const diagram = /^!\[([^\]]+)\]\((\/guides\/diagrams\/[a-z0-9-]+\.svg)\)$/u.exec(line);
    if (diagram) {
      flush(); endList();
      result += `<figure class="guide-diagram"><img src="${diagram[2]}" alt="${escapeHTML(diagram[1])}"></figure>\n`;
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/u.exec(line);
    const item = /^(?:([-*]) |\d+\. )(.+)$/u.exec(line);
    if (heading) {
      flush(); endList(); if (heading[1].length === 1) continue;
      const base = heading[2].toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
      let id = base, suffix = 2; while (ids.has(id)) id = `${base}-${suffix++}`; ids.add(id);
      result += `<h${heading[1].length} id="${id}">${inline(heading[2])}</h${heading[1].length}>\n`;
    } else if (item) {
      flush(); const type = item[1] ? 'ul' : 'ol'; if (list !== type) { endList(); result += `<${type}>\n`; list = type; }
      result += `<li>${inline(item[2])}</li>\n`;
    } else if (line.startsWith('> ')) { flush(); endList(); result += `<aside class="guide-note">${inline(line.slice(2))}</aside>\n`; }
    else { endList(); paragraph.push(line.trim()); }
  }
  flush(); endList(); return result;
}
function page({ title, description, body, article = false, published }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escapeHTML(description)}"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#18191c"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(title)} — encryptfs</title><meta property="og:title" content="${escapeHTML(title)}"><meta property="og:description" content="${escapeHTML(description)}"><meta property="og:type" content="${article ? 'article' : 'website'}">${published ? `<meta property="article:published_time" content="${published}T00:00:00Z">` : ''}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/efs/guide.css"><link rel="stylesheet" href="/guides/guides.css"><link rel="describedby" href="/llms.txt" type="text/plain"><link rel="alternate" href="${article ? `/guides/${article}/index.md` : '/guides/index.md'}" type="text/markdown"></head>
<body><header class="site-header"><a href="/" class="brand" aria-label="encryptfs home"><img class="brand-mark" src="/favicon.svg" width="30" height="30" alt="">encrypt<span class="brand-fs">fs</span></a><nav class="reading-nav" aria-label="Main navigation"><a href="/guides/">Guides</a><a href="/efs/">File format</a><a href="/" class="secondary-button">Open encryptfs</a></nav></header><main class="efs-main guides-main">${body}</main></body></html>\n`;
}
export async function buildGuides() {
  const guides = JSON.parse(await readFile(path.join(root, 'content/guides/index.json'), 'utf8'));
  const slugs = new Set();
  for (const guide of guides) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(guide.slug) || slugs.has(guide.slug) || !guide.title || !guide.description || !/^\d{4}-\d{2}-\d{2}$/u.test(guide.published)) throw new Error('Invalid guide metadata.');
    slugs.add(guide.slug);
    const markdown = await readFile(path.join(root, `content/guides/${guide.slug}.md`), 'utf8');
    if (!markdown.startsWith(`# ${guide.title}\n`)) throw new Error('Guide title must match metadata.');
    const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${guide.published}T00:00:00Z`));
    const body = `<article class="guide-post"><a href="/guides/" class="back-link">← All guides</a><header class="guide-intro"><span class="guide-version">FILE PRIVACY GUIDE</span><h1>${escapeHTML(guide.title)}</h1><time datetime="${guide.published}">${date}</time></header><div class="post-body">${renderMarkdown(markdown)}</div><footer class="post-footer"><a href="/" class="primary-button">Open encryptfs</a><a href="/efs/">Read about the .efs format</a></footer></article>`;
    const directory = path.join(root, `dist/guides/${guide.slug}`); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), page({ ...guide, body, article: guide.slug }));
    await writeFile(path.join(directory, 'index.md'), markdown);
  }
  const cards = guides.map(guide => `<article class="guide-card"><span class="guide-version">${escapeHTML(guide.category || "File privacy guide")}</span><h2><a href="/guides/${guide.slug}/">${escapeHTML(guide.title)}</a></h2><p>${escapeHTML(guide.description)}</p><a class="read-guide" href="/guides/${guide.slug}/">Read guide →</a></article>`).join('\n');
  const body = `<header class="guide-intro"><h1>Guides</h1><p>Steps to encrypt, store, and restore your files.</p></header><div class="guides-list">${cards}</div>`;
  await writeFile(path.join(root, 'dist/guides/index.html'), page({ title: 'Guides', description: 'Simple guides to encrypt files before cloud storage and restore them when needed.', body }));
  const links = guides.map(guide => `- [${guide.title}](/guides/${guide.slug}/index.md): ${guide.description}`).join('\n');
  await writeFile(path.join(root, 'dist/guides/index.md'), `# encryptfs guides\n\n${links}\n`);
  const llmsPath = path.join(root, 'dist/llms.txt');
  const llms = (await readFile(llmsPath, 'utf8')).split('\n## Guides\n')[0].trimEnd();
  await writeFile(llmsPath, `${llms}\n\n## Guides\n\n- [Guides index](/guides/index.md): Read the available guides.\n${links}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildGuides();

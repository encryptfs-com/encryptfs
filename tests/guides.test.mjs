import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderMarkdown, buildGuides } from '../scripts/build-guides.mjs';
import { serve } from '../scripts/serve.mjs';
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const route = '/guides/encrypt-photos-videos-google-drive-icloud';
test('guide renderer escapes HTML and rejects executable or cross-origin-relative link schemes', () => {
  const html = renderMarkdown('## Test\n\n<script>alert(1)</script>\n\n**<img src=x>** and `a < b`\n\n[Guide](/efs/)');
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('<code>a &lt; b</code>'));
  assert.ok(html.includes('href="/efs/"'));
  for (const url of ['javascript:alert', 'data:text/html', '//example.com', '/\\evil.test']) assert.throws(() => renderMarkdown(`[Link](${url})`));
});
test('guide index and article routes serve static HTML, with source Markdown available', async () => {
  for (const url of ['/guides', route]) {
    let status, type, body;
    await serve({ url }, { writeHead(value, headers) { status = value; type = headers['Content-Type']; }, end(value) { body = value.toString(); } });
    assert.equal(status, 200); assert.equal(type, 'text/html'); assert.equal((body.match(/<h1>/gu) || []).length, 1); assert.ok(!/<script\b/iu.test(body));
  }
  const article = await read(`dist${route}/index.html`);
  assert.ok(article.includes('iCloud Drive')); assert.ok(article.includes('Do not use iCloud Photos'));
  assert.ok(article.includes('Test a restore before you remove any originals'));
  assert.ok(article.includes('There is no password recovery.'));
  assert.ok(article.includes('support.google.com/drive/answer/2424368'));
  assert.ok(article.includes('support.apple.com/guide/icloud/'));
  assert.equal(await read(`dist${route}/index.md`), await read('content/guides/encrypt-photos-videos-google-drive-icloud.md'));
});
test('guide builds are repeatable and do not duplicate discovery links', async () => {
  const before = await read('dist/llms.txt'); await buildGuides();
  assert.equal(await read('dist/llms.txt'), before);
  assert.equal((before.match(/## Guides/gu) || []).length, 1);
});
test('each guide serves a local SVG diagram with alternative text', async () => {
  const guides = JSON.parse(await read('content/guides/index.json'));
  for (const { slug } of guides) {
    const article = await read(`dist/guides/${slug}/index.html`);
    const diagram = /<img src="(\/guides\/diagrams\/[a-z0-9-]+\.svg)" alt="([^"]+)">/u.exec(article);
    assert.ok(diagram, slug);
    await serve({ url: diagram[1] }, {
      writeHead(status, headers) {
        assert.equal(status, 200);
        assert.equal(headers['Content-Type'], 'image/svg+xml');
      },
      end(body) { assert.match(body.toString(), /^<svg\b/u); }
    });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = name => readFile(new URL(`../dist/${name}`, import.meta.url), 'utf8');
test('crawler resources contain their actual formats, not an HTML fallback', async () => {
  const robots = await read('robots.txt'); assert.match(robots, /^User-agent: \*\nAllow: \/\n$/u);
  const llms = await read('llms.txt'); assert.match(llms, /^# encryptfs\n/u); assert.match(llms, /\[[^\]]+\]\([^)]+\)/u);
  const catalog = JSON.parse(await read('ai-catalog.json'));
  assert.equal(catalog.specVersion, '1.0'); assert.equal(catalog.host.displayName, 'encryptfs'); assert.ok(Array.isArray(catalog.entries));
  for (const entry of catalog.entries) { assert.match(entry.identifier, /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/u); assert.equal(typeof entry.displayName, 'string'); assert.equal(entry.type, 'application/json'); assert.equal(typeof entry.data, 'object'); assert.equal(entry.url, undefined); }
  assert.equal(await read('ai-catalog.json'), await read('.well-known/ai-catalog.json'));
  assert.match(await read('404.html'), /<h1>Page not found<\/h1>/u);
});
test('file containers use groups with native selection controls, not invalid listbox children', async () => {
  const html = await read('index.html'); assert.equal(html.includes('role="listbox"'), false);
  for (const id of ['plain-list', 'encrypted-list', 'results-list']) assert.match(html, new RegExp(`id="${id}"[^>]+role="group"`));
  const app = await read('app.js'); assert.equal(app.includes("setAttribute('role', 'option')"), false);
  assert.match(app, /Encryption complete/u);
});

test('static server responds with text/JSON for discovery paths and a real 404 for missing resources', async () => {
  const { serve } = await import('../scripts/serve.mjs');
  async function request(url) {
    const result = {};
    await serve({ url }, { writeHead(status, headers) { Object.assign(result, { status, headers }); }, end(data) { result.body = data.toString(); } });
    return result;
  }
  for (const url of ['/robots.txt', '/llms.txt']) {
    const result = await request(url); assert.equal(result.status, 200); assert.match(result.headers['Content-Type'], /^text\/plain/u); assert.ok(!result.body.startsWith('<'));
  }
  for (const url of ['/ai-catalog.json', '/.well-known/ai-catalog.json']) {
    const result = await request(url); assert.equal(result.status, 200); assert.equal(result.headers['Content-Type'], 'application/json'); assert.equal(JSON.parse(result.body).specVersion, '1.0');
  }
  assert.equal((await request('/not-a-real-resource.json')).status, 404);
  assert.equal((await request('/efs')).status, 200);
});

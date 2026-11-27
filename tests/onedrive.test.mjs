import test from 'node:test';
import assert from 'node:assert/strict';
import { OneDriveImportSource, graphURL, oneDriveDownloadURL } from '../dist/lib/onedrive.js';
const config = { clientId: '11111111-1111-1111-1111-111111111111' };
const item = { id: 'a', name: 'a.txt', size: 2, file: { mimeType: 'text/plain' }, '@microsoft.graph.downloadUrl': 'https://x.files.1drv.com/a?secret=private' };
const collect = async values => { const out = []; for await (const value of values) out.push(value); return out; };
const options = { remainingBytes: () => 100 };
function mock(extra = {}) {
  const calls = []; let settings;
  const client = { initialize: async () => {}, clearCache: async () => calls.push('clear'), acquireTokenPopup: request => { calls.push(request); return Promise.resolve({ accessToken: 'private-token' }); } };
  const source = new OneDriveImportSource(config, { scope: { location: { href: 'http://localhost:4173/' } }, load: async () => ({ PublicClientApplication: class { constructor(value) { settings = value; return client; } } }), select: async () => [item], ...extra });
  return { source, client, calls, settings: () => settings };
}
test('OneDrive configuration is optional and loads no SDK until requested', async () => {
  let loaded = false; const source = new OneDriveImportSource({}, { load: () => { loaded = true; } });
  await assert.rejects(source.prepare(), /not configured/); assert.equal(loaded, false);
  const missing = mock({ load: async () => { throw new Error('module missing'); } }); await assert.rejects(missing.source.prepare(), /assets are missing/);
});
test('popup starts synchronously with read-only scope; credentials use memory only', async () => {
  const mockup = mock(); await mockup.source.prepare(); const pending = mockup.source.pick();
  assert.deepEqual(mockup.calls[0].scopes, ['Files.Read']); assert.equal(mockup.settings().cache.cacheLocation, 'memoryStorage');
  assert.equal(mockup.settings().auth.redirectUri, 'http://localhost:4173/onedrive-redirect.html');
  assert.deepEqual(await pending, [item]); mockup.source.clear(); assert.equal(mockup.source.ready, false);
});
test('Graph destination rejects token exfiltration and download links restrict hosts', () => {
  assert.equal(graphURL('me/drive/root/children'), 'https://graph.microsoft.com/v1.0/me/drive/root/children');
  for (const url of ['https://evil.test/', '//evil.test/', 'https://user@graph.microsoft.com/v1.0/me', 'https://graph.microsoft.com/beta/me']) assert.throws(() => graphURL(url));
  assert.equal(oneDriveDownloadURL(item['@microsoft.graph.downloadUrl']), item['@microsoft.graph.downloadUrl']);
  for (const url of ['http://x.1drv.com/a', 'https://1drv.com.evil.test/a', 'https://evil.test/a', 'https://user@x.1drv.com/a']) assert.throws(() => oneDriveDownloadURL(url));
});
test('Graph requests carry tokens only to fixed API and downloads carry no credentials', async () => {
  const requests = [];
  const mockup = mock({ fetch: async (url, init) => { requests.push({ url, init }); return url.startsWith('https://graph.microsoft.com/') ? Response.json({ value: [item] }) : new Response('ok'); }, select: async ({ list }) => (await list('me/drive/root/children')).items });
  await mockup.source.prepare(); const selected = await mockup.source.pick();
  const results = await collect(mockup.source.read(selected, options)); assert.equal(await results[0].file.text(), 'ok');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer private-token'); assert.equal(requests[1].init.headers, undefined);
  assert.equal(requests[1].init.credentials, 'omit'); assert.equal(requests[1].init.referrerPolicy, 'no-referrer'); assert.equal(requests[1].init.redirect, 'error');
});
test('oversized, truncated, and expired files yield errors and later files remain importable', async () => {
  const mockup = mock({ fetch: async () => new Response('ok') });
  const values = await collect(mockup.source.read([{ ...item, id: 'big', size: 101 }, { ...item, id: 'short', size: 3 }, item], options));
  assert.match(values[0].error, /workspace/); assert.match(values[1].error, /incomplete/); assert.equal(await values[2].file.text(), 'ok');
  const expired = mock({ fetch: async () => new Response('', { status: 403 }) }); assert.match((await collect(expired.source.read([item], options)))[0].error, /expired/);
});
test('clear and abort ignore late authentication and sanitize network errors', async () => {
  const mockup = mock(); await mockup.source.prepare(); let finish; mockup.client.acquireTokenPopup = () => new Promise(resolve => { finish = resolve; });
  const pending = mockup.source.pick(); mockup.source.clear(); finish({ accessToken: 'private' }); await assert.rejects(pending, { name: 'AbortError' });
  const bad = mock({ fetch: async () => { throw new Error('secret signed url'); } }); const result = await collect(bad.source.read([item], options)); assert.equal(result[0].error.includes('secret'), false);
  const controller = new AbortController(); controller.abort(); await assert.rejects(collect(bad.source.read([item], { ...options, signal: controller.signal })), { name: 'AbortError' });
});

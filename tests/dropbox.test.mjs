import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DropboxImportSource, dropboxDownloadURL, isDropboxConfigured } from '../dist/lib/dropbox.js';
import { inspect } from '../dist/lib/format.js';

const config = { appKey: 'test-public-app-key' };
const file = (name = 'a.txt', bytes = 2, extra = {}) => ({ id: name, name, bytes, link: `https://dl.dropboxusercontent.com/test/${name}?token=temporary`, isDir: false, ...extra });
function mockDropbox() {
  const calls = [];
  const scope = { Dropbox: { choose(options) { calls.push(options); }, isBrowserSupported: () => true } };
  return { scope, calls };
}
async function select(source, mock, files = [file()]) {
  const pending = source.pick({ sizeLimit: 1024 }); mock.calls.at(-1).success(files); return pending;
}
const collect = async iterator => { const values = []; for await (const value of iterator) values.push(value); return values; };

test('unconfigured Dropbox never loads its external library', async () => {
  let loaded = false;
  const source = new DropboxImportSource({}, { scope: {}, document: { createElement() { loaded = true; } } });
  assert.equal(isDropboxConfigured(config), true); assert.equal(isDropboxConfigured({}), false);
  await assert.rejects(source.prepare(), /not configured/); assert.equal(loaded, false);
});
test('Chooser opens synchronously for direct multi-file selection without predictable popup names', async () => {
  const mock = mockDropbox(); const source = new DropboxImportSource(config, { scope: mock.scope });
  const pending = source.pick({ sizeLimit: 1000 }); assert.equal(mock.calls.length, 1);
  const options = mock.calls[0]; assert.equal(options.linkType, 'direct'); assert.equal(options.multiselect, true);
  assert.equal(options.folderselect, false); assert.equal(options.sizeLimit, 1000); assert.equal(options.windowName, undefined);
  options.success([file()]); assert.deepEqual(await pending, [file()]);
  assert.equal(JSON.stringify(source), '{}');
});
test('Chooser cancellation, unsupported browsers and thrown popup errors are handled', async () => {
  const mock = mockDropbox(); const source = new DropboxImportSource(config, { scope: mock.scope });
  let pending = source.pick(); mock.calls.at(-1).cancel(); assert.deepEqual(await pending, []);
  const controller = new AbortController(); pending = source.pick({ signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); mock.calls.at(-1).success([null]);
  pending = source.pick(); source.clear(); await assert.rejects(pending, { name: 'AbortError' });
  mock.scope.Dropbox.isBrowserSupported = () => false; await assert.rejects(source.pick(), /does not support/);
  mock.scope.Dropbox.isBrowserSupported = () => true; mock.scope.Dropbox.choose = () => { throw new Error('popup blocked'); };
  await assert.rejects(source.pick(), /Allow popups/);
});
test('download links must be HTTPS Dropbox content destinations', () => {
  for (const url of ['https://dl.dropboxusercontent.com/a?signature=private', 'https://a.dropboxusercontent.com/a', 'https://dl.dropbox.com/a']) assert.equal(dropboxDownloadURL(url), url);
  for (const url of ['http://dl.dropboxusercontent.com/a', 'https://evil.test/a', 'https://dropboxusercontent.com.evil.test/a', 'https://evildropboxusercontent.com/a', 'https://user:pass@dl.dropboxusercontent.com/a', 'https://dl.dropboxusercontent.com:444/a', 'https://dl.dropboxusercontent.com/a#fragment', 'javascript:alert(1)']) assert.throws(() => dropboxDownloadURL(url));
});
test('streamed files preserve .efs bytes and omit account cookies', async () => {
  const vector = JSON.parse(await readFile(new URL('./vectors.json', import.meta.url), 'utf8'));
  const data = Buffer.from(vector.containerBase64, 'base64'); const mock = mockDropbox(); let options; const progress = [];
  const source = new DropboxImportSource(config, { scope: mock.scope, fetch: async (url, init) => { options = init; return new Response(data, { headers: { 'Content-Type': 'application/octet-stream' } }); } });
  const selected = await select(source, mock, [file('misleading.txt', data.length)]);
  const results = await collect(source.read(selected, { remainingBytes: () => 10000, onProgress: value => progress.push(value) }));
  assert.equal(results[0].file.name, 'misleading.txt'); assert.ok(await inspect(results[0].file));
  assert.deepEqual(new Uint8Array(await results[0].file.arrayBuffer()), new Uint8Array(data));
  assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.headers, undefined);
  assert.equal(progress.at(-1).done, data.length);
});
test('size limits, whole folders, expired links and partial failures leave later files importable', async () => {
  const mock = mockDropbox(); const source = new DropboxImportSource(config, { scope: mock.scope, fetch: async url => url.includes('expired') ? new Response('', { status: 403 }) : new Response('ok') });
  const selected = [file('big', 20), file('folder', 0, { isDir: true }), file('expired', 2), file('ok', 2)];
  const results = await collect(source.read(selected, { remainingBytes: () => 10 }));
  assert.match(results[0].error, /workspace/); assert.match(results[1].error, /folder/); assert.match(results[2].error, /expired/);
  assert.equal(await results[3].file.text(), 'ok');
  await assert.rejects(collect(source.read(selected, { maxFiles: 2, remainingBytes: () => 10 })), /no more than 2/);
});
test('size changes, incomplete streams, and cancellation never expose partial files', async () => {
  const mock = mockDropbox(); const source = new DropboxImportSource(config, { scope: mock.scope, fetch: async () => new Response('abc') });
  const result = await collect(source.read([file('large', 2), file('short', 4)], { remainingBytes: () => 10 }));
  assert.match(result[0].error, /changed size/); assert.match(result[1].error, /incomplete/);
  assert.ok(result.every(item => !item.file));
  const controller = new AbortController();
  await assert.rejects(collect(source.read([file('cancel', 3)], { signal: controller.signal, remainingBytes: () => 10, onProgress: value => { if (value.done) controller.abort(); } })), { name: 'AbortError' });
});
test('network errors cannot leak temporary signed URLs into application messages', async () => {
  const mock = mockDropbox(); const source = new DropboxImportSource(config, { scope: mock.scope, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('Failed at https://dl.dropboxusercontent.com/file?private=secret')); } })) });
  const result = await collect(source.read([file()], { remainingBytes: () => 10 }));
  assert.match(result[0].error, /interrupted/); assert.equal(result[0].error.includes('private='), false);
});

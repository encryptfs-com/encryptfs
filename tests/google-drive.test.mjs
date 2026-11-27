import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GoogleDriveImportSource, DRIVE_SCOPE, isDriveConfigured } from '../dist/lib/google-drive.js';
import { inspect } from '../dist/lib/format.js';

const config = { clientId: 'test.apps.googleusercontent.com', apiKey: 'public-test-picker-api-key', appId: '1234567890' };
function mockGoogle() {
  const state = { requests: [], pickers: [], clients: [] };
  class DocsView {
    setIncludeFolders(value) { state.includeFolders = value; return this; }
    setSelectFolderEnabled(value) { state.selectFolders = value; return this; }
    setMode() { return this; }
  }
  class PickerBuilder {
    addView() { return this; } enableFeature() { return this; }
    setOAuthToken(token) { state.pickerToken = token; return this; }
    setDeveloperKey(key) { state.key = key; return this; }
    setAppId(id) { state.appId = id; return this; }
    setOrigin(origin) { state.origin = origin; return this; }
    setTitle() { return this; } setCallback(callback) { this.callback = callback; return this; }
    build() { const picker = { callback: this.callback, setVisible(value) { this.visible = value; }, dispose() { this.disposed = true; } }; state.pickers.push(picker); return picker; }
  }
  const oauth2 = {
    hasGrantedAllScopes: (response, scope) => response.scope?.split(' ').includes(scope),
    initTokenClient(options) {
      state.clients.push(options);
      return { requestAccessToken(request) {
        state.requests.push(request);
        if (!state.deferAuth) options.callback({ access_token: 'private-access-token', expires_in: 3600, scope: DRIVE_SCOPE });
      } };
    }
  };
  const scope = { location: { origin: 'http://127.0.0.1:4173' }, google: { accounts: { oauth2 }, picker: {
    DocsView, PickerBuilder, ViewId: { DOCS: 'docs' }, DocsViewMode: { LIST: 'list' }, Feature: { MULTISELECT_ENABLED: 'multi' }, Action: { CANCEL: 'cancel', PICKED: 'picked' }
  } } };
  for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(scope, key, { get() { throw new Error('Sensitive data must not enter browser storage'); } });
  return { scope, state };
}
async function connect(source, mock, docs = [{ id: 'file_1', name: 'selected.bin' }]) {
  const promise = source.pick();
  mock.state.pickers.at(-1).callback({ action: 'picked', docs });
  return promise;
}
const metadata = (size, extra = {}) => new Response(JSON.stringify({ id: 'file_1', name: 'test.txt', mimeType: 'text/plain', size: String(size), modifiedTime: '2024-01-01T00:00:00Z', capabilities: { canDownload: true }, ...extra }), { status: 200 });
const collect = async iterable => { const values = []; for await (const value of iterable) values.push(value); return values; };

test('unconfigured Drive does not load external libraries', async () => {
  let loaded = false;
  const source = new GoogleDriveImportSource({}, { scope: {}, document: { createElement() { loaded = true; } } });
  assert.equal(isDriveConfigured({}), false); assert.equal(isDriveConfigured(config), true);
  await assert.rejects(source.prepare(), /not configured/); assert.equal(loaded, false);
});
test('authorization starts synchronously, uses drive.file, and preserves selected IDs/resource keys', async () => {
  const mock = mockGoogle(); const source = new GoogleDriveImportSource(config, { scope: mock.scope });
  const promise = source.pick();
  assert.equal(mock.state.requests.length, 1, 'Popup request must occur inside the user gesture');
  assert.equal(mock.state.clients[0].scope, DRIVE_SCOPE); assert.equal(mock.state.clients[0].include_granted_scopes, false);
  assert.equal(mock.state.selectFolders, false); assert.equal(mock.state.includeFolders, true);
  mock.state.pickers[0].callback({ action: 'picked', docs: [{ id: 'a', name: 'photo.jpg', resourceKey: 'key_1' }] });
  assert.deepEqual(await promise, [{ id: 'a', name: 'photo.jpg', resourceKey: 'key_1' }]);
  assert.equal(mock.state.pickers[0].disposed, true); assert.equal(source.connected, true);
  assert.equal(JSON.stringify(source).includes('private-access-token'), false);
  source.clear(); assert.equal(source.connected, false);
});
test('valid tokens are reused; expired tokens require a new user authorization', async () => {
  const mock = mockGoogle(); let now = 0;
  const source = new GoogleDriveImportSource(config, { scope: mock.scope, now: () => now });
  await connect(source, mock); await connect(source, mock);
  assert.equal(mock.state.requests.length, 1);
  now = 3600000; assert.equal(source.connected, false);
  await connect(source, mock); assert.equal(mock.state.requests.length, 2);
});
test('picker cancellation, denied scope, blocked popup, and late OAuth callbacks settle safely', async () => {
  const mock = mockGoogle(); const source = new GoogleDriveImportSource(config, { scope: mock.scope });
  let promise = source.pick(); mock.state.pickers.at(-1).callback({ action: 'cancel' }); assert.deepEqual(await promise, []);
  source.clear(); mock.state.deferAuth = true;
  promise = source.pick(); mock.state.clients.at(-1).callback({ error: 'access_denied' }); await assert.rejects(promise, /not granted/);
  promise = source.pick(); mock.state.clients.at(-1).error_callback({ type: 'popup_failed_to_open' }); await assert.rejects(promise, /Allow popups/);
  const controller = new AbortController(); promise = source.pick({ signal: controller.signal }); controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  mock.state.clients.at(-1).callback({ access_token: 'too-late', expires_in: 3600, scope: DRIVE_SCOPE }); assert.equal(source.connected, false);
});
test('downloads stream into File objects, preserve .efs bytes, and use only the fixed Drive API endpoint', async () => {
  const vector = JSON.parse(await readFile(new URL('./vectors.json', import.meta.url), 'utf8'));
  const data = Buffer.from(vector.containerBase64, 'base64'); const mock = mockGoogle(); const requests = []; const progress = [];
  const source = new GoogleDriveImportSource(config, { scope: mock.scope, fetch: async (url, options) => {
    requests.push({ url, options }); return url.includes('alt=media') ? new Response(data) : metadata(data.length, { name: 'misleading.txt', mimeType: 'application/octet-stream' });
  } });
  const selected = await connect(source, mock, [{ id: 'file_1', name: 'misleading.txt', resourceKey: 'resource_key' }]);
  const results = await collect(source.read(selected, { remainingBytes: () => 10000, onProgress: value => progress.push(value) }));
  assert.equal(results[0].file.name, 'misleading.txt'); assert.ok(await inspect(results[0].file));
  assert.deepEqual(new Uint8Array(await results[0].file.arrayBuffer()), new Uint8Array(data));
  assert.ok(requests.every(request => request.url.startsWith('https://www.googleapis.com/drive/v3/files/file_1?')));
  assert.ok(requests.every(request => !request.url.includes('private-access-token')));
  assert.equal(requests[0].options.headers['X-Goog-Drive-Resource-Keys'], 'file_1/resource_key');
  assert.equal(requests[0].options.credentials, 'omit'); assert.equal(progress.at(-1).done, data.length);
});
test('default fetch keeps the browser receiver for metadata and media requests', async t => {
  t.mock.method(globalThis, 'fetch', async function (url) {
    assert.equal(this, globalThis);
    return url.includes('alt=media') ? new Response('ok') : metadata(2);
  });
  const mock = mockGoogle();
  const source = new GoogleDriveImportSource(config, { scope: mock.scope });
  const selected = await connect(source, mock);
  const [result] = await collect(source.read(selected, { remainingBytes: () => 10 }));
  assert.equal(result.error, undefined);
  assert.equal(await result.file.text(), 'ok');
  assert.equal(globalThis.fetch.mock.callCount(), 2);
});
test('oversized and incomplete files fail while later files still import', async () => {
  const mock = mockGoogle();
  const source = new GoogleDriveImportSource(config, { scope: mock.scope, fetch: async url => {
    if (url.includes('/large?')) return metadata(100);
    if (url.includes('/short?')) return url.includes('alt=media') ? new Response('x') : metadata(3);
    return url.includes('alt=media') ? new Response('ok') : metadata(2);
  } });
  await connect(source, mock);
  const selected = ['large', 'short', 'good'].map(id => ({ id, name: id }));
  const result = await collect(source.read(selected, { remainingBytes: () => 10 }));
  assert.match(result[0].error, /workspace/); assert.match(result[1].error, /incomplete/); assert.equal(await result[2].file.text(), 'ok');
  await assert.rejects(collect(source.read(selected, { remainingBytes: () => 10, maxFiles: 2 })), /no more than 2/);
});
test('stream size growth and cancellation never release partial files', async () => {
  const mock = mockGoogle();
  const source = new GoogleDriveImportSource(config, { scope: mock.scope, fetch: async url => url.includes('alt=media') ? new Response('too long') : metadata(3) });
  const selected = await connect(source, mock);
  const result = await collect(source.read(selected, { remainingBytes: () => 100 })); assert.match(result[0].error, /changed size/); assert.equal(result[0].file, undefined);
  const cancelSource = new GoogleDriveImportSource(config, { scope: mock.scope, fetch: async url => url.includes('alt=media') ? new Response('yes') : metadata(3) });
  await connect(cancelSource, mock);
  const controller = new AbortController();
  await assert.rejects(collect(cancelSource.read(selected, { signal: controller.signal, remainingBytes: () => 100, onProgress: value => { if (value.done) controller.abort(); } })), { name: 'AbortError' });
});
test('native Google documents and restricted downloads are rejected; expired tokens clear', async () => {
  const mock = mockGoogle(); let mode = 'native';
  const source = new GoogleDriveImportSource(config, { scope: mock.scope, fetch: async () => mode === 'native' ? metadata(0, { mimeType: 'application/vnd.google-apps.document' }) : mode === 'denied' ? metadata(1, { capabilities: { canDownload: false } }) : new Response('', { status: 401 }) });
  const selected = await connect(source, mock);
  assert.match((await collect(source.read(selected, { remainingBytes: () => 10 })))[0].error, /not supported/);
  mode = 'denied'; assert.match((await collect(source.read(selected, { remainingBytes: () => 10 })))[0].error, /does not allow/);
  mode = 'expired'; assert.match((await collect(source.read(selected, { remainingBytes: () => 10 })))[0].error, /expired/); assert.equal(source.connected, false);
});

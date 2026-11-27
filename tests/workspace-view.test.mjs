import test from 'node:test';
import assert from 'node:assert/strict';
import { unlockedEntries, batchProgress, isDevelopmentHost } from '../dist/lib/workspace-view.js';
import { DownloadReceipts } from '../dist/lib/download-receipts.js';
const folder = { manifest: { name: 'Vacation', kind: 'folder', entries: [
  { path: 'photos/10.jpg', size: 10 }, { path: 'photos/2.jpg', size: 2 }, { path: 'notes.txt', size: 1 }
] }, decrypted: new Set([2]) };
test('unlocked search includes folder names, excludes moved entries, and preserves crypto indices', () => {
  assert.deepEqual(unlockedEntries(folder).map(entry => entry.index), [1, 0]);
  assert.deepEqual(unlockedEntries(folder, 'VACATION photos/2').map(entry => entry.index), [1]);
  assert.deepEqual(unlockedEntries(folder, 'notes'), []);
  assert.deepEqual(unlockedEntries(folder, '', true).map(entry => entry.index), [0, 1]);
  assert.deepEqual(unlockedEntries({ name: 'secret.efs' }, 'secret'), []);
});
test('batch progress advances across files, clamps fractions, and handles unknown totals', () => {
  assert.equal(batchProgress(1, 4, { done: 50, total: 100 }).done, 375);
  assert.equal(batchProgress(2, 4, { done: 200, total: 100 }).done, 750);
  assert.equal(batchProgress(2, 4, { done: -1, total: 100 }).done, 500);
  assert.equal(batchProgress(1, 4, { total: 0 }).done, 250);
  assert.equal(batchProgress(0, 0).done, 0);
});
test('development provider visibility is limited to loopback and localhost domains', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.0.0.2', '[::1]', '::1']) assert.equal(isDevelopmentHost(host), true);
  for (const host of ['encryptfs.com', 'localhost.evil.com', '192.168.1.2', 'notlocalhost']) assert.equal(isDevelopmentHost(host), false);
});
function receiptFixture() {
  const timers = new Map(); let serial = 0, changes = 0;
  const receipts = new DownloadReceipts({ onChange: () => changes++, setTimer: (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; }, clearTimer: id => timers.delete(id) });
  return { receipts, timers, changes: () => changes };
}
test('retry copies retain exact encrypted bytes, count toward memory, and expire', async () => {
  const { receipts, timers } = receiptFixture(); const blob = new Blob(['encrypted bytes']);
  receipts.add({ blob, name: 'random.efs', sourceName: 'original.txt' });
  assert.equal(receipts.bytes, blob.size); assert.equal(receipts.entries[0].blob, blob);
  assert.equal(await receipts.entries[0].blob.text(), 'encrypted bytes');
  assert.equal([...timers.values()][0].delay, 120000);
  [...timers.values()][0].callback(); assert.equal(receipts.bytes, 0); assert.equal(receipts.entries.length, 0); assert.equal(timers.size, 0);
});
test('dismissal and workspace cleanup release retry copies and all expiry timers', () => {
  const { receipts, timers } = receiptFixture();
  const first = receipts.add({ blob: new Blob(['a']), name: 'a.efs' });
  receipts.add({ blob: new Blob(['bb']), name: 'b.efs' });
  receipts.remove(first); assert.equal(receipts.bytes, 2); assert.equal(timers.size, 1);
  receipts.clear(); assert.equal(receipts.entries.length, 0); assert.equal(receipts.bytes, 0); assert.equal(timers.size, 0);
});

test('default receipt timers keep the global Window receiver for scheduling and cleanup', context => {
  let scheduled; const cleared = [];
  context.mock.method(globalThis, 'setTimeout', function(callback, delay) {
    assert.equal(this, globalThis, 'Window.setTimeout must receive the global object');
    assert.equal(delay, 120000); scheduled = callback; return 123;
  });
  context.mock.method(globalThis, 'clearTimeout', function(timer) {
    assert.equal(this, globalThis, 'Window.clearTimeout must receive the global object');
    cleared.push(timer);
  });
  const receipts = new DownloadReceipts();
  receipts.add({ blob: new Blob(['encrypted']), name: 'test.efs' });
  scheduled(); assert.equal(receipts.bytes, 0); assert.deepEqual(cleared, [123]);
  receipts.add({ blob: new Blob(['second']), name: 'second.efs' });
  receipts.clear(); assert.equal(receipts.bytes, 0); assert.deepEqual(cleared, [123, 123]);
});
test('failed expiry scheduling does not leave an orphaned retry copy', () => {
  const receipts = new DownloadReceipts({ setTimer() { throw new Error('timer failed'); } });
  assert.throws(() => receipts.add({ blob: new Blob(['encrypted']), name: 'test.efs' }), /timer failed/);
  assert.equal(receipts.bytes, 0); assert.equal(receipts.entries.length, 0);
});

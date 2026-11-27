import test from 'node:test';
import assert from 'node:assert/strict';
import { outputFile, createOutputBatch } from '../dist/lib/disk-output.js';
import { createEncryptedSession } from '../dist/lib/encrypted-storage.js';
const notFound = () => new DOMException('Not found', 'NotFoundError');
test('disk output preserves directories, avoids existing names, and can remove a failed placeholder', async () => {
  const existing = new Set(['a.txt']); const events = [];
  const directory = {
    async getDirectoryHandle(name) { events.push(['directory', name]); return directory; },
    async getFileHandle(name, options) { if (options?.create) { events.push(['create', name]); existing.add(name); return { name }; } if (existing.has(name)) return { name }; throw notFound(); },
    async removeEntry(name) { existing.delete(name); }
  };
  const result = await outputFile(directory, 'folder/a.txt');
  assert.equal(result.handle.name, 'a (1).txt'); assert.ok(existing.has('a.txt')); assert.deepEqual(events, [['directory', 'folder'], ['create', 'a (1).txt']]);
  await result.remove(); assert.equal(existing.has('a (1).txt'), false); assert.ok(existing.has('a.txt'));
  await assert.rejects(outputFile(directory, '../unsafe.txt'), /not safe/);
  const batch = await createOutputBatch(directory); assert.match(batch.name, /^encryptfs-[0-9a-f-]{36}$/u);
});
test('temporary ciphertext cleanup removes abandoned sessions and protects another live tab', async () => {
  const stale = '11111111-1111-1111-1111-111111111111';
  const live = '22222222-2222-2222-2222-222222222222'; const removed = [];
  const root = {
    async *entries() { yield [stale, {}]; yield [live, {}]; yield ['unknown', {}]; },
    async removeEntry(name) { removed.push(name); },
    async getDirectoryHandle(name) { return { name }; }
  };
  const locks = { async request(name, options, callback) { if (typeof options === 'function') return options({}); return callback(name.endsWith(live) ? null : {}); } };
  const storage = { async getDirectory() { return { async getDirectoryHandle(name) { assert.equal(name, 'encryptfs-encrypted-output'); return root; } }; } };
  const session = await createEncryptedSession({ storage, locks });
  assert.deepEqual(removed, [stale]); await session.clear();
  assert.deepEqual(removed, [stale, session.directory.name]); assert.ok(!removed.includes(live));
});
test('unsupported/private storage falls back, and denied session locks fail without hanging', async () => {
  assert.equal(await createEncryptedSession({ storage: {}, locks: {} }), null);
  const locks = { request: async () => { throw new Error('lock denied'); } };
  const storage = { async getDirectory() { return { async getDirectoryHandle() { return {}; } }; } };
  await assert.rejects(createEncryptedSession({ storage, locks }), /lock denied/);
  const denied = { getDirectory: async () => { throw new DOMException('Private', 'SecurityError'); } };
  assert.equal(await createEncryptedSession({ storage: denied, locks }), null);
});

test('a transient browser storage error falls back and releases any acquired session lock', async () => {
  const error = new DOMException('The operation failed for an unknown transient reason.', 'UnknownError');
  let released = false;
  const locks = { async request(name, callback) { await callback({}); released = true; } };
  assert.equal(await createEncryptedSession({
    storage: { async getDirectory() { throw error; } }, locks
  }), null);
  const root = { async *entries() {}, async getDirectoryHandle() { throw error; } };
  assert.equal(await createEncryptedSession({
    storage: { async getDirectory() { return { async getDirectoryHandle() { return root; } }; } }, locks
  }), null);
  assert.equal(released, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractZip } from '../dist/lib/zip-extract.js';

const { BlobWriter, TextReader, ZipWriter } = globalThis.zip;

async function archive(entries, options = {}) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, ...options });
  for (const [path, content] of entries) await writer.add(path, new TextReader(content));
  return writer.close();
}

test('ZIP extraction preserves paths, file contents and byte progress', async () => {
  const zip = await archive([['folder/a.txt', 'first'], ['b.txt', 'second'.repeat(50)], ['empty', '']]);
  const updates = [];
  const files = await extractZip(zip, { maxFiles: 3, onProgress: progress => updates.push(progress) });
  assert.deepEqual(files.map(file => file.path), ['folder/a.txt', 'b.txt', 'empty']);
  assert.deepEqual(await Promise.all(files.map(file => file.blob.text())), ['first', 'second'.repeat(50), '']);
  assert.equal(updates.at(-1).done, 305);
  assert.equal(updates.at(-1).total, 305);
});

test('ZIP extraction rejects conflicting paths, oversized entry lists and encrypted archives', async () => {
  const zip = await archive([['folder', 'file'], ['folder/a.txt', 'child']]);
  await assert.rejects(extractZip(zip, { maxFiles: 1 }), /more files than the workspace/);
  await assert.rejects(extractZip(zip, { maxFiles: 2 }), /paths collide/);
  const encrypted = await archive([['secret.txt', 'secret']], { password: 'zip-test', zipCrypto: true });
  await assert.rejects(extractZip(encrypted, { maxFiles: 1 }), /Password-protected ZIP/);
});

test('ZIP extraction stops if cancelled during extraction', async () => {
  const zip = await archive([['a.txt', 'first'], ['b.txt', 'second']]);
  const controller = new AbortController();
  await assert.rejects(extractZip(zip, {
    maxFiles: 2, signal: controller.signal,
    onProgress(progress) { if (progress.done) controller.abort(); }
  }), { name: 'AbortError' });
});

test('the app worker returns extracted blobs over its request protocol', async () => {
  const messages = [];
  globalThis.self = { postMessage: value => messages.push(structuredClone(value)) };
  try {
    await import('../dist/crypto-worker.js');
    const blob = await archive([['folder/file.txt', 'hello']]);
    await self.onmessage({ data: { request: 1, action: 'extract-zip', payload: { blob, maxFiles: 1 } } });
    const { request, result } = messages.at(-1);
    assert.equal(request, 1);
    assert.equal(result[0].path, 'folder/file.txt');
    assert.equal(await result[0].blob.text(), 'hello');
  } finally {
    delete globalThis.self;
  }
});

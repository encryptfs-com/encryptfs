import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, unlock, decryptEntry, CHUNK_SIZE, validateManifest } from '../dist/lib/format.js';
import { createFileSink } from '../dist/lib/output-sinks.js';
import { contentProgress } from '../dist/lib/workspace-view.js';

test('files above 256 MiB stream with bounded reads and preserve selective decryption', async () => {
  const size = 270 * CHUNK_SIZE + 17;
  let largestRead = 0, written = 0, ordinal = 0; const saved = new Map(); let busy = false;
  const source = { size, slice(start, end) { const length = Math.min(size, end) - start; largestRead = Math.max(largestRead, length); return new Blob([new Uint8Array(length)]); } };
  const sink = {
    async write(value) {
      assert.equal(busy, false, 'Writer must apply backpressure'); busy = true;
      const bytes = new Uint8Array(value);
      if (ordinal < 2 || bytes.length < 100) saved.set(written, bytes.slice());
      written += bytes.length; ordinal++; await Promise.resolve(); busy = false;
    }, async close() { return written; }, async abort() { assert.fail('Unexpected abort'); }
  };
  const tail = new Blob(['tail']);
  await encrypt([{ path: 'large.bin', blob: source, type: '', lastModified: 0 }, { path: 'tail.txt', blob: tail, type: 'text/plain', lastModified: 0 }], 'stream-test', { kind: 'folder', name: 'Large', sink });
  assert.equal(largestRead, CHUNK_SIZE); assert.ok(written > 256 * CHUNK_SIZE);
  const file = { size: written, slice(start, end) {
    const value = saved.get(start); assert.ok(value, `Read should seek to a saved record at ${start}`);
    return new Blob([value.subarray(0, end - start)]);
  } };
  const handle = await unlock(file, 'stream-test');
  assert.equal(handle.manifest.entries[0].size, size);
  assert.equal(await (await decryptEntry(handle, 1)).text(), 'tail');
});
test('streamed decryption aborts output and never closes it after a late authentication failure', async () => {
  const file = await encrypt([{ path: 'a', blob: new Blob([new Uint8Array(CHUNK_SIZE + 2)]), type: '', lastModified: 0 }], 'test');
  const damaged = new Uint8Array(await file.arrayBuffer()); damaged[damaged.length - 1] ^= 1;
  const handle = await unlock(new Blob([damaged]), 'test');
  let writes = 0, closed = false, aborted = false;
  await assert.rejects(decryptEntry(handle, 0, { sink: {
    async write(value) { assert.equal(value.length, CHUNK_SIZE); writes++; }, async close() { closed = true; }, async abort() { aborted = true; }
  } }), /authentication/);
  assert.equal(writes, 1); assert.equal(closed, false); assert.equal(aborted, true);
});
test('disk sink commits only on close and supports rollback on abort', async () => {
  const events = []; const blob = new Blob(['done']);
  const sink = await createFileSink({ async createWritable() { return { async write(value) { events.push(['write', value.length]); }, async close() { events.push('close'); }, async abort() { events.push('abort'); } }; }, async getFile() { events.push('file'); return blob; } });
  await sink.write(new Uint8Array(5)); assert.deepEqual(events, [['write', 5]]);
  assert.equal(await sink.close(), blob); assert.deepEqual(events, [['write', 5], 'close', 'file']);
});
test('byte progress weights bytes rather than giving small and large files equal weight', () => {
  assert.equal(contentProgress(1, 1000, { done: 499, total: 999 }).done, 500);
  assert.equal(contentProgress(0, 1000, { phase: 'Deriving encryption key', total: 0 }).indeterminate, true);
  assert.equal(contentProgress(0, 1000, { done: 1000, total: 1000, finalizing: true }).done, 1000);
  assert.equal(contentProgress(0, 0).done, 0);
  assert.doesNotThrow(() => validateManifest({ kind: 'file', name: 'big', entries: [{ path: 'big', size: 5 * 1024 ** 3, type: '', lastModified: 0 }] }));
});

test('cancellation during finalization aborts before a streamed file is committed', async () => {
  const controller = new AbortController(); let closed = false, aborted = false;
  await assert.rejects(encrypt([{ path: 'a', blob: new Blob(['a']), type: '', lastModified: 0 }], 'test', {
    signal: controller.signal, onProgress: progress => { if (progress.finalizing) controller.abort(); },
    sink: { async write() {}, async close() { closed = true; }, async abort() { aborted = true; } }
  }), { name: 'AbortError' });
  assert.equal(closed, false); assert.equal(aborted, true);
});

test('an unreadable source identifies the failing file in a folder and aborts output', async () => {
  const error = new DOMException('The operation failed for an unknown transient reason.', 'NotReadableError');
  const source = { size: 1, slice: () => ({ async arrayBuffer() { throw error; } }) };
  let aborted = false;
  await assert.rejects(encrypt([
    { path: 'ok.txt', blob: new Blob(['ok']) },
    { path: 'videos/unreadable.mp4', blob: source }
  ], 'test', {
    kind: 'folder', name: 'batch1',
    sink: { async write() {}, async close() { assert.fail('Unexpected close'); }, async abort() { aborted = true; } }
  }), failure => {
    assert.match(failure.message, /Could not read “videos\/unreadable\.mp4” at byte offset 0 of 1/);
    assert.equal(failure.cause, error);
    return true;
  });
  assert.equal(aborted, true);
});

test('encryption retries a failed chunk read and preserves the original contents', async () => {
  const original = new Blob([new Uint8Array(CHUNK_SIZE), 'tail']);
  const offsets = [];
  const source = {
    size: original.size,
    slice(start, end) {
      offsets.push(start);
      if (offsets.length === 2) return { async arrayBuffer() { throw new DOMException('I/O failure', 'NotReadableError'); } };
      return original.slice(start, end);
    }
  };
  const encrypted = await encrypt([{ path: 'video.mov', blob: source }], 'test');
  assert.deepEqual(offsets, [0, CHUNK_SIZE, CHUNK_SIZE]);
  const decrypted = await decryptEntry(await unlock(encrypted, 'test'), 0);
  assert.equal(decrypted.size, original.size);
  assert.equal(await decrypted.slice(CHUNK_SIZE).text(), 'tail');
});

test('a failed sequential read resumes from the first unencrypted chunk', async () => {
  const first = new Uint8Array(CHUNK_SIZE).fill(7);
  const original = new Blob([first, 'tail']);
  const offsets = [];
  let reads = 0;
  const source = {
    size: original.size,
    stream() {
      return new ReadableStream({
        pull(controller) {
          if (++reads === 1) controller.enqueue(first.slice(0, 100));
          else if (reads === 2) {
            const bytes = new Uint8Array(CHUNK_SIZE - 98);
            bytes.set(first.subarray(100));
            bytes.set([116, 97], CHUNK_SIZE - 100);
            controller.enqueue(bytes);
          } else controller.error(new DOMException('The object can not be found here', 'NotFoundError'));
        }
      }, { highWaterMark: 0 });
    },
    slice(start, end) { offsets.push(start); return original.slice(start, end); }
  };
  const encrypted = await encrypt([{ path: 'video.mov', blob: source }], 'test');
  assert.deepEqual(offsets, [CHUNK_SIZE]);
  const decrypted = await decryptEntry(await unlock(encrypted, 'test'), 0);
  assert.deepEqual(await decrypted.arrayBuffer(), await original.arrayBuffer());
});

test('encryption rejects truncated output and output with the wrong header', async () => {
  for (const damage of ['truncate', 'header']) {
    const chunks = [];
    const sink = {
      async write(chunk) { chunks.push(new Uint8Array(chunk)); },
      async close() {
        if (damage === 'truncate') chunks.pop();
        else chunks[0][0] ^= 1;
        return new Blob(chunks);
      },
      async abort() {}
    };
    await assert.rejects(encrypt([{ path: 'video.mov', blob: new Blob(['content']) }], 'test', { sink }), {
      code: 'OUTPUT', message: damage === 'truncate' ? /incomplete/ : /invalid header/
    });
  }
});

test('the encryption worker identifies output storage failures and permits a folder retry', async () => {
  const messages = [];
  let removed;
  globalThis.self = { postMessage: message => messages.push(message) };
  try {
    await import('../dist/crypto-worker.js');
    const payload = { entries: [{ path: 'sample.txt', blob: new Blob(['sample']) }], password: 'test password', kind: 'file', name: 'sample.txt', outputName: 'vault.efs' };
    const failingDirectory = {
      async getFileHandle() {
        return { async createWritable() { throw new DOMException('Storage full.', 'QuotaExceededError'); } };
      },
      async removeEntry(name) { removed = name; }
    };
    await self.onmessage({ data: { request: 1, action: 'encrypt', payload: { ...payload, directory: failingDirectory } } });
    assert.equal(messages.at(-1).error.code, 'OUTPUT_STORAGE');
    assert.equal(removed, 'vault.efs');

    const parts = [];
    const folder = {
      async getFileHandle() {
        return {
          async createWritable() { return { async write(bytes) { parts.push(new Blob([bytes])); }, async close() {} }; },
          async getFile() { return new Blob(parts); }
        };
      }
    };
    await self.onmessage({ data: { request: 2, action: 'encrypt', payload: { ...payload, directory: folder, savedToDisk: true } } });
    assert.deepEqual(messages.at(-1).result, { size: new Blob(parts).size });
    assert.equal(await (await decryptEntry(await unlock(new Blob(parts), payload.password), 0)).text(), 'sample');
  } finally {
    delete globalThis.self;
  }
});

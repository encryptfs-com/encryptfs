import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { encrypt, unlock, decryptEntry, inspect, validateManifest, safePath, CHUNK_SIZE, ITERATIONS, MAX_BYTES } from '../dist/lib/format.js';
import { detectPreview } from '../dist/lib/previews.js';

const password = 'a long test password 🔑';
const entry = (path, value, type = 'text/plain') => ({ path, blob: new Blob([value]), type, lastModified: 1700000000000 });
const single = (value = 'hello, private world') => encrypt([entry('secret.txt', value)], password);
const changeByte = async (blob, offset) => { const data = new Uint8Array(await blob.arrayBuffer()); data[offset] ^= 1; return new Blob([data]); };

test('single-file round trip, encrypted metadata, nonextractable key', async () => {
  const blob = await single(); const handle = await unlock(blob, password);
  assert.equal(handle.key.extractable, false);
  assert.equal(handle.manifest.name, 'secret.txt');
  assert.equal(handle.manifest.entries[0].type, 'text/plain');
  const data = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(data).includes('secret.txt'), false);
  assert.equal(new TextDecoder().decode(data).includes('text/plain'), false);
  assert.equal(await (await decryptEntry(handle, 0)).text(), 'hello, private world');
});
test('wrong passwords and damaged metadata fail authentication', async () => {
  const blob = await single();
  await assert.rejects(unlock(blob, 'wrong'), { code: 'NO_MATCH' });
  await assert.rejects(unlock(await changeByte(blob, 65), password), { code: 'NO_MATCH' });
  await assert.rejects(unlock(await changeByte(blob, 40), password), { code: 'NO_MATCH' });
});
test('each encryption has fresh salt, identifier and ciphertext', async () => {
  const a = new Uint8Array(await (await single()).arrayBuffer());
  const b = new Uint8Array(await (await single()).arrayBuffer());
  assert.notDeepEqual(a.slice(24, 40), b.slice(24, 40)); assert.notDeepEqual(a.slice(40, 56), b.slice(40, 56));
  assert.notDeepEqual(a, b);
});
test('empty file has an authenticated payload record', async () => {
  const blob = await single(''); const handle = await unlock(blob, password);
  assert.equal(handle.positions.entries[0].chunks, 1);
  assert.equal((await decryptEntry(handle, 0)).size, 0);
  await assert.rejects(decryptEntry(await unlock(await changeByte(blob, blob.size - 1), password), 0), { code: 'AUTH' });
});
test('multiple chunks, folder paths and independently decryptable entries', async () => {
  const large = new Uint8Array(CHUNK_SIZE + 11); large.fill(87);
  const blob = await encrypt([entry('photos/a.bin', large, 'application/octet-stream'), entry('notes/b.txt', 'second file')], password, { kind: 'folder', name: 'Vacation' });
  const handle = await unlock(blob, password);
  assert.equal(handle.positions.entries[0].chunks, 2);
  assert.equal(await (await decryptEntry(handle, 1)).text(), 'second file');
  assert.deepEqual(new Uint8Array(await (await decryptEntry(handle, 0)).arrayBuffer()), large);
  // Corrupt the first file. The second remains independently accessible.
  const damaged = await changeByte(blob, handle.positions.entries[0].offset + 4);
  const damagedHandle = await unlock(damaged, password);
  assert.equal(await (await decryptEntry(damagedHandle, 1)).text(), 'second file');
  await assert.rejects(decryptEntry(damagedHandle, 0), { code: 'AUTH' });
});
test('chunks cannot be reordered or substituted from another container', async () => {
  const blob = await single(new Uint8Array(CHUNK_SIZE * 2)); const handle = await unlock(blob, password);
  const data = new Uint8Array(await blob.arrayBuffer()); const offset = handle.positions.entries[0].offset;
  const length = CHUNK_SIZE + 16; const first = data.slice(offset, offset + length);
  data.copyWithin(offset, offset + length, offset + length * 2); data.set(first, offset + length);
  await assert.rejects(decryptEntry(await unlock(new Blob([data]), password), 0), { code: 'AUTH' });
  const other = await single(new Uint8Array(CHUNK_SIZE * 2));
  const replacement = new Uint8Array(await other.arrayBuffer()); replacement.set(new Uint8Array(await blob.slice(offset).arrayBuffer()), offset);
  await assert.rejects(decryptEntry(await unlock(new Blob([replacement]), password), 0), { code: 'AUTH' });
});
test('truncation and trailing bytes are rejected after manifest unlock', async () => {
  const blob = await single();
  await assert.rejects(unlock(blob.slice(0, blob.size - 1), password), /truncated/);
  await assert.rejects(unlock(new Blob([blob, new Uint8Array([0])]), password), /unexpected data/);
});
test('header-based detection and strict version/parameter limits', async () => {
  assert.equal(await inspect(new Blob(['ordinary plaintext'])), null);
  const blob = await single(); const original = new Uint8Array(await blob.arrayBuffer());
  for (const offset of [8, 10, 12, 14, 16, 20, 60]) {
    const data = original.slice(); data[offset] ^= 1;
    await assert.rejects(inspect(new Blob([data])), { code: 'UNSUPPORTED' });
  }
  await assert.rejects(inspect(blob.slice(0, 32)), /Truncated/);
  const badLength = original.slice(); new DataView(badLength.buffer).setUint32(56, 0xffffffff);
  await assert.rejects(inspect(new Blob([badLength])), { code: 'LIMIT' });
});
test('unsafe paths, duplicate paths, collisions and limits are rejected', () => {
  const valid = { path: 'a.txt', size: 1, type: '', lastModified: 0 };
  const folder = entries => ({ kind: 'folder', name: 'Folder', entries });
  for (const path of ['../a', '/a', 'a//b', 'a\\b', 'a/../b', 'a\0b', 'a.', ' a', 'a:b']) assert.equal(safePath(path), false, path);
  assert.equal(safePath('旅行/hello world.txt'), true);
  assert.throws(() => validateManifest(folder([valid, valid])), /duplicate/);
  assert.throws(() => validateManifest(folder([valid, { ...valid, path: 'a.txt/b' }])), /collide/);
  for (const size of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER, MAX_BYTES + 1]) assert.throws(() => validateManifest(folder([{ ...valid, size }])));
  assert.throws(() => validateManifest({ kind: 'file', name: 'b', entries: [valid] }));
  assert.throws(() => validateManifest(folder([])));
});
test('passwords preserve spaces and Unicode; invalid and empty passwords fail', async () => {
  for (const value of ['', '\ud800', 'a'.repeat(1025)]) await assert.rejects(encrypt([entry('a', '')], value), { code: 'PASSWORD' });
  const blob = await encrypt([entry('a', 'x')], ' spaced password ');
  await assert.rejects(unlock(blob, 'spaced password'), { code: 'NO_MATCH' });
  assert.equal(await (await decryptEntry(await unlock(blob, ' spaced password '), 0)).text(), 'x');
});
test('progress and cancellation between chunks do not return partial files', async () => {
  const controller = new AbortController(); const phases = [];
  await assert.rejects(encrypt([entry('a', new Uint8Array(CHUNK_SIZE + 2))], password, { signal: controller.signal, onProgress(p) {
    phases.push(p.phase); if (p.done > 0) controller.abort();
  } }), { name: 'AbortError' });
  assert.ok(phases.includes('Deriving encryption key')); assert.ok(phases.includes('Encrypting contents'));
  const blob = await single(new Uint8Array(CHUNK_SIZE + 2)); const handle = await unlock(blob, password);
  const stop = new AbortController();
  await assert.rejects(decryptEntry(handle, 0, { signal: stop.signal, onProgress() { stop.abort(); } }), { name: 'AbortError' });
});
test('change password produces independent output; old copy retains old password', async () => {
  const old = await single(); const plain = await decryptEntry(await unlock(old, password), 0);
  const changed = await encrypt([{ ...entry('secret.txt', ''), blob: plain }], 'a new password');
  await assert.rejects(unlock(changed, password), { code: 'NO_MATCH' });
  assert.equal(await (await decryptEntry(await unlock(changed, 'a new password'), 0)).text(), await plain.text());
  assert.equal((await unlock(old, password)).manifest.name, 'secret.txt');
});
test('preview registry detects content instead of trusting extensions or MIME', async () => {
  assert.equal((await detectPreview(new Blob(['<script>alert(1)</script>'], { type: 'text/html' }))).kind, 'text');
  assert.equal((await detectPreview(new Blob(['%PDF-1.7\n']))).kind, 'pdf');
  assert.equal((await detectPreview(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]))).kind, 'image');
  assert.equal((await detectPreview(new Blob([new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112])]))).kind, 'video');
  assert.equal((await detectPreview(new Blob([new Uint8Array([0, 1, 255])]))).kind, 'unsupported');
});
test('published vector decrypts with codec and independent Node crypto implementation', async () => {
  const vector = JSON.parse(await readFile(new URL('./vectors.json', import.meta.url), 'utf8'));
  const data = Buffer.from(vector.containerBase64, 'base64'); const blob = new Blob([data]);
  const handle = await unlock(blob, vector.password);
  assert.deepEqual(handle.manifest, vector.manifest);
  assert.equal(await (await decryptEntry(handle, 0)).text(), vector.plaintext);
  const key = pbkdf2Sync(Buffer.from(vector.password, 'utf8'), data.subarray(24, 40), ITERATIONS, 32, 'sha256');
  const independentDecrypt = (ciphertext, ordinal) => {
    const iv = Buffer.alloc(12); iv.writeBigUInt64BE(BigInt(ordinal), 4);
    const aad = Buffer.alloc(72); data.copy(aad, 0, 0, 64); aad.writeBigUInt64BE(BigInt(ordinal), 64);
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(aad); decipher.setAuthTag(ciphertext.subarray(-16));
    return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  };
  const manifestLength = data.readUInt32BE(56);
  assert.deepEqual(JSON.parse(independentDecrypt(data.subarray(64, 64 + manifestLength), 0).toString('utf8')), vector.manifest);
  assert.equal(independentDecrypt(data.subarray(64 + manifestLength), 1).toString('utf8'), vector.plaintext);
});

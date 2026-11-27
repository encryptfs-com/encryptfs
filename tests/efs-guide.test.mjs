import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ITERATIONS, CHUNK_SIZE } from '../dist/lib/format.js';
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
test('public format specification stays identical to the canonical specification', async () => {
  assert.equal(await read('../dist/efs/format-v1.md'), await read('../docs/format-v1.md'));
});
test('guide describes the implemented algorithms and separates unlocking from payload checks', async () => {
  const guide = await read('../dist/efs/index.html');
  assert.ok(guide.includes(ITERATIONS.toLocaleString('en-US')));
  assert.ok(guide.includes(CHUNK_SIZE.toLocaleString('en-US')));
  for (const text of ['PBKDF2-HMAC-SHA-256', 'AES-256-GCM', '128 bits (16 bytes)',
    'Unlocking the names does not check all file contents.', 'no independent security review',
    'There is no password recovery.', 'file list size are visible']) assert.ok(guide.includes(text), text);
  assert.ok(!/<script\b/iu.test(guide), 'Informational page needs no scripts');
});

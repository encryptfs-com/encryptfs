import { createBlobSink } from './output-sinks.js';
export const MAGIC = new Uint8Array([0x45, 0x46, 0x53, 0, 13, 10, 26, 10]);
export const CHUNK_SIZE = 1024 * 1024;
export const MAX_BYTES = Number.MAX_SAFE_INTEGER - Math.ceil(Number.MAX_SAFE_INTEGER / CHUNK_SIZE) * 16 - 4 * 1024 * 1024 - 160064;
export const MAX_ENTRIES = 10000;
export const MAX_MANIFEST = 4 * 1024 * 1024;
export const ITERATIONS = 600000;
export const MAX_CONTAINER = Number.MAX_SAFE_INTEGER;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class FormatError extends Error {
  constructor(message, code = 'FORMAT') { super(message); this.name = 'FormatError'; this.code = code; }
}
const fail = (message, code) => { throw new FormatError(message, code); };
const bytes = value => encoder.encode(value);
const abort = signal => { if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError'); };
const safeNumber = n => Number.isSafeInteger(n) && n >= 0;
export function safePath(path) {
  return typeof path === 'string' && bytes(path).length <= 4096 && path.split('/').every(part =>
    part.length > 0 && part !== '.' && part !== '..' && bytes(part).length <= 255 &&
    !/[\\\x00-\x1f\x7f<>:"|?*]/u.test(part) && part.trim() === part && !part.endsWith('.'));
}
export function validateManifest(value) {
  if (!value || !['file', 'folder'].includes(value.kind) || !safePath(value.name) || value.name.includes('/') ||
    !Array.isArray(value.entries) || !value.entries.length || value.entries.length > MAX_ENTRIES) fail('Invalid file manifest.');
  const seen = new Set(); let total = 0;
  for (const entry of value.entries) {
    if (!entry || !safePath(entry.path) || !safeNumber(entry.size) || !safeNumber(entry.lastModified) ||
      typeof entry.type !== 'string' || bytes(entry.type).length > 255 || /[\x00-\x1f\x7f]/u.test(entry.type) || seen.has(entry.path)) {
      fail('Invalid or duplicate file entry.');
    }
    seen.add(entry.path); total += entry.size;
    if (!Number.isSafeInteger(total) || total > MAX_BYTES) fail('Container size exceeds the safe integer range.', 'LIMIT');
  }
  for (const path of seen) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join('/'))) fail('File and folder paths collide.');
  }
  if (value.kind === 'file' && (value.entries.length !== 1 || value.entries[0].path !== value.name)) fail('Invalid single-file manifest.');
  return value;
}
export async function inspect(file) {
  const prefix = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (!MAGIC.every((b, i) => prefix[i] === b)) return null;
  if (prefix.length !== 64) fail('Truncated encryptfs header.');
  const view = new DataView(prefix.buffer);
  if (view.getUint16(8) !== 1 || view.getUint16(10) !== 0) fail('This .efs version is not supported.', 'UNSUPPORTED');
  if (view.getUint16(12) !== 1 || view.getUint16(14) !== 0 || view.getUint32(60) !== 0) fail('Unsupported .efs features.', 'UNSUPPORTED');
  if (view.getUint32(16) !== ITERATIONS || view.getUint32(20) !== CHUNK_SIZE) fail('Unsupported cryptographic parameters.', 'UNSUPPORTED');
  const length = view.getUint32(56);
  if (length < 18 || length > MAX_MANIFEST + 16 || file.size < 64 + length || file.size > MAX_CONTAINER || !safeNumber(file.size)) fail('Invalid container size.', 'LIMIT');
  return { header: prefix, length };
}
function parameters(header, ordinal) {
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setBigUint64(4, BigInt(ordinal));
  const additionalData = new Uint8Array(72);
  additionalData.set(header);
  new DataView(additionalData.buffer).setBigUint64(64, BigInt(ordinal));
  return { name: 'AES-GCM', iv, additionalData, tagLength: 128 };
}
async function derive(password, header) {
  if (typeof password !== 'string' || !password.length || !password.isWellFormed() || bytes(password).length > 1024) {
    fail('Use a password of 1–1024 UTF-8 bytes without invalid Unicode.', 'PASSWORD');
  }
  const raw = bytes(password);
  try {
    const material = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: header.slice(24, 40), iterations: ITERATIONS },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { raw.fill(0); }
}
function layout(manifest, start) {
  let offset = start; let ordinal = 1;
  const entries = manifest.entries.map(entry => {
    const chunks = Math.max(1, Math.ceil(entry.size / CHUNK_SIZE));
    const result = { offset, ordinal, chunks };
    offset += entry.size + chunks * 16; ordinal += chunks;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(ordinal)) fail('Container offsets exceed the safe integer range.', 'LIMIT');
    return result;
  });
  return { entries, size: offset };
}

async function readPlainChunk(entry, offset, signal) {
  const end = Math.min(offset + CHUNK_SIZE, entry.blob.size);
  for (let attempt = 0; ; attempt++) {
    abort(signal);
    try {
      const chunk = new Uint8Array(await entry.blob.slice(offset, end).arrayBuffer());
      if (chunk.byteLength !== end - offset) {
        chunk.fill(0);
        throw new DOMException('The file returned fewer bytes than expected.', 'NotReadableError');
      }
      return chunk;
    } catch (error) {
      abort(signal);
      if (attempt === 0 && ['NotReadableError', 'NotFoundError', 'UnknownError'].includes(error.name)) {
        await new Promise(resolve => setTimeout(resolve, 150));
        continue;
      }
      throw new Error(`Could not read “${entry.path}” at byte offset ${offset} of ${entry.blob.size}. Use a fully downloaded copy on a local drive, then remove and re-add the file. Browser error: ${error.message}`, { cause: error });
    }
  }
}

async function* plainChunks(entry, signal) {
  const size = entry.blob.size;
  let offset = 0;
  if (size && typeof entry.blob.stream === 'function') {
    let reader, chunk, pending;
    try {
      reader = entry.blob.stream().getReader();
      let filled = 0;
      while (offset < size) {
        abort(signal);
        const result = await reader.read();
        if (result.done) break;
        pending = result.value;
        let consumed = 0;
        while (consumed < pending.length && offset < size) {
          abort(signal);
          chunk ??= new Uint8Array(Math.min(CHUNK_SIZE, size - offset));
          const count = Math.min(chunk.length - filled, pending.length - consumed);
          chunk.set(pending.subarray(consumed, consumed + count), filled);
          filled += count;
          consumed += count;
          if (filled === chunk.length) {
            offset += chunk.length;
            yield chunk;
            chunk = undefined;
            filled = 0;
          }
        }
        pending.fill(0);
        pending = undefined;
      }
    } catch (error) {
      if (!['NotReadableError', 'NotFoundError', 'UnknownError'].includes(error.name)) throw error;
    } finally {
      chunk?.fill(0);
      pending?.fill(0);
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }
  // Resume at the first chunk that has not been handed to the encryptor.
  if (!size) yield await readPlainChunk(entry, 0, signal);
  for (; offset < size; offset += CHUNK_SIZE) yield await readPlainChunk(entry, offset, signal);
}

export async function encrypt(entries, password, { kind = 'file', name = entries[0]?.path, signal, onProgress = () => {}, sink } = {}) {
  const output = sink || createBlobSink();
  try {
  abort(signal);
  const manifest = validateManifest({ kind, name, entries: entries.map(entry => ({
    path: entry.path, size: entry.blob.size, type: entry.type || '', lastModified: entry.lastModified || 0
  })) });
  const plaintext = bytes(JSON.stringify(manifest));
  if (plaintext.length > MAX_MANIFEST) fail('Folder manifest is too large.', 'LIMIT');
  const expectedSize = layout(manifest, 64 + plaintext.length + 16).size;
  const header = new Uint8Array(64); header.set(MAGIC);
  const view = new DataView(header.buffer);
  view.setUint16(8, 1); view.setUint16(12, 1); view.setUint32(16, ITERATIONS); view.setUint32(20, CHUNK_SIZE);
  crypto.getRandomValues(header.subarray(24, 56));
  view.setUint32(56, plaintext.length + 16);
  onProgress({ phase: 'Deriving encryption key', done: 0, total: 0 });
  const key = await derive(password, header); abort(signal);
  let encryptedManifest;
  try { encryptedManifest = await crypto.subtle.encrypt(parameters(header, 0), key, plaintext); }
  finally { plaintext.fill(0); }
  await output.write(header); await output.write(encryptedManifest);
  let ordinal = 1; let done = 0;
  const total = manifest.entries.reduce((sum, e) => sum + e.size, 0);
  for (const entry of entries) {
    for await (const chunk of plainChunks(entry, signal)) {
      try {
        abort(signal);
        await output.write(await crypto.subtle.encrypt(parameters(header, ordinal++), key, chunk));
        done += chunk.length;
      } finally { chunk.fill(0); }
      onProgress({ phase: 'Encrypting contents', done, total });
    }
  }
  abort(signal);
  onProgress({ phase: 'Finishing output', done: total, total, finalizing: true });
  abort(signal);
  const result = await output.close();
  if (result instanceof Blob) {
    if (result.size !== expectedSize) fail(`Encrypted output is incomplete (${result.size} of ${expectedSize} bytes).`, 'OUTPUT');
    let savedHeader;
    try { savedHeader = new Uint8Array(await result.slice(0, header.length).arrayBuffer()); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      fail(`Could not read encrypted output. Browser error: ${error.message}`, 'OUTPUT');
    }
    if (!header.every((value, index) => savedHeader[index] === value)) fail('Encrypted output has an invalid header.', 'OUTPUT');
  }
  return result;
  } catch (error) { await output.abort().catch(() => {}); throw error; }
}

export async function unlock(file, password, { signal, onProgress = () => {} } = {}) {
  abort(signal);
  const info = await inspect(file);
  if (!info) fail('This file is not an encryptfs container.');
  onProgress({ phase: 'Checking password', done: 0, total: 0 });
  const key = await derive(password, info.header); abort(signal);
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(parameters(info.header, 0), key,
      await file.slice(64, 64 + info.length).arrayBuffer()));
  } catch { fail('Password did not match, or encrypted metadata is damaged.', 'NO_MATCH'); }
  let manifest;
  try { manifest = validateManifest(JSON.parse(decoder.decode(plaintext))); }
  catch (error) { if (error instanceof FormatError) throw error; fail('Invalid encrypted manifest.'); }
  finally { plaintext.fill(0); }
  const positions = layout(manifest, 64 + info.length);
  if (positions.size !== file.size) fail('Container is truncated or contains unexpected data.');
  abort(signal);
  return { file, key, header: info.header, manifest, positions };
}

export async function decryptChunk(handle, index, chunk, signal) {
  const entry = handle.manifest.entries[index];
  const position = handle.positions.entries[index];
  if (!position || !Number.isSafeInteger(chunk) || chunk < 0 || chunk >= position.chunks) fail('Unknown file chunk.');
  abort(signal);
  const offset = position.offset + chunk * (CHUNK_SIZE + 16);
  const length = Math.min(CHUNK_SIZE, entry.size - chunk * CHUNK_SIZE);
  let encrypted;
  try { encrypted = await handle.file.slice(offset, offset + length + 16).arrayBuffer(); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(`Could not read the vault at byte ${offset}. ${error.name}: ${error.message}`, { cause: error });
  }
  abort(signal);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(parameters(handle.header, position.ordinal + chunk), handle.key, encrypted));
  } catch { fail('File contents failed authentication. The container may be damaged.', 'AUTH'); }
}

export async function decryptEntry(handle, index, { signal, onProgress = () => {}, sink } = {}) {
  const output = sink || createBlobSink(handle.manifest.entries[index]?.type);
  let ioStep;
  try {
    const entry = handle.manifest.entries[index];
    const position = handle.positions.entries[index];
    if (!entry || !position) fail('Unknown folder entry.');
    let done = 0;
    for (let chunk = 0; chunk < position.chunks; chunk++) {
      const plain = await decryptChunk(handle, index, chunk, signal);
      ioStep = `Could not store decrypted output at byte ${done}`;
      try { await output.write(plain); } finally { plain.fill(0); }
      ioStep = undefined;
      done += plain.length;
      onProgress({ phase: 'Decrypting contents', done, total: entry.size });
    }
    abort(signal);
    onProgress({ phase: 'Finishing output', done, total: entry.size, finalizing: true });
    abort(signal);
    ioStep = 'Could not finish decrypted output';
    return await output.close();
  } catch (error) {
    await output.abort().catch(() => {});
    if (!ioStep || error.name === 'AbortError') throw error;
    throw new Error(`${ioStep}. ${error.name}: ${error.message}`, { cause: error });
  }
}

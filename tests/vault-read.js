import { CHUNK_SIZE, decryptEntry, unlock } from '../lib/format.js';

const failedOffset = 6391168450;
const recordSize = CHUNK_SIZE + 16;

async function verify(file, password) {
  self.postMessage('Unlocking the vault…');
  try {
    const handle = await unlock(file, password);
    const sink = { async write() {}, async close() {}, async abort() {} };
    for (const [index, entry] of handle.manifest.entries.entries()) {
      let previousPercent = -1;
      await decryptEntry(handle, index, {
        sink,
        onProgress({ done, total }) {
          const percent = total ? Math.floor(done / total * 100) : 100;
          if (percent === previousPercent) return;
          previousPercent = percent;
          self.postMessage(`Verifying ${entry.path}: ${percent}%`);
        }
      });
    }
    self.postMessage('Authentication passed for every chunk. Decrypted bytes were discarded.');
  } catch (error) {
    self.postMessage(`Authentication test failed: ${error.message}`);
  }
}

self.onmessage = async ({ data: { action, file, password } }) => {
  if (action === 'verify') {
    await verify(file, password);
    return;
  }
  if (file.size < failedOffset + recordSize) {
    self.postMessage('This file is too short to contain the reported byte range.');
    return;
  }

  let offset = failedOffset;
  let stage = 'Direct read';
  const scanStart = failedOffset % recordSize;
  try {
    const direct = await file.slice(offset, offset + recordSize).arrayBuffer();
    if (direct.byteLength !== recordSize) throw new Error('Short read');
    self.postMessage('Direct read passed. Scanning the vault in the worker…');
    stage = 'Sequential scan after the direct read passed';
    for (offset = scanStart; offset < file.size; offset += recordSize) {
      const end = Math.min(file.size, offset + recordSize);
      const bytes = await file.slice(offset, end).arrayBuffer();
      if (bytes.byteLength !== end - offset) throw new Error('Short read');
      if ((offset - scanStart) % (recordSize * 256) === 0) {
        self.postMessage(`Direct read passed. Scan ${Math.floor(end / file.size * 100)}% complete.`);
      }
    }
    self.postMessage(`Direct read and sequential scan passed (${file.size} bytes).`);
  } catch (error) {
    self.postMessage(`${stage} failed at byte ${offset}: ${error.name}: ${error.message}`);
  }
};

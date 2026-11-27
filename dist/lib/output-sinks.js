// Backpressure keeps only one crypto chunk in JavaScript memory at a time.
export function createBlobSink(type = 'application/octet-stream') {
  let parts = [];
  return {
    async write(bytes) { parts.push(new Blob([bytes])); },
    async close() { const result = new Blob(parts, { type }); parts = []; return result; },
    async abort() { parts = []; }
  };
}
export async function createFileSink(handle) {
  const writable = await handle.createWritable();
  return {
    write: bytes => writable.write(bytes),
    async close() { await writable.close(); return handle.getFile(); },
    abort: () => writable.abort()
  };
}

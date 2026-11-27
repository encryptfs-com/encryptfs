import { validateManifest } from './format.js';
import '../vendor/zipjs/zip-native.min.js';

const { BlobReader, ZipReader } = globalThis.zip;

export async function extractZip(blob, { maxFiles, signal, onProgress = () => {} }) {
  const reader = new ZipReader(new BlobReader(blob), { checkCrc32: true, useWebWorkers: false, signal });
  try {
    onProgress({ phase: 'Reading ZIP directory', total: 0 });
    const entries = [];
    for await (const entry of reader.getEntriesGenerator()) {
      signal?.throwIfAborted();
      if (entry.directory) continue;
      if (entry.encrypted) throw new Error('Password-protected ZIP files are unsupported.');
      if (entries.length >= maxFiles) throw new Error('The ZIP has more files than the workspace can hold.');
      entries.push(entry);
    }
    if (!entries.length) throw new Error('The ZIP contains no files.');
    const manifest = validateManifest({
      kind: 'folder',
      name: 'ZIP',
      entries: entries.map(entry => ({
        path: entry.filename,
        size: entry.uncompressedSize,
        type: '',
        lastModified: Math.max(0, entry.lastModDate?.getTime() || 0)
      }))
    });

    const total = manifest.entries.reduce((bytes, entry) => bytes + entry.size, 0);
    let done = 0;
    const files = [];
    for (const [index, entry] of entries.entries()) {
      signal?.throwIfAborted();
      const { path, size, type, lastModified } = manifest.entries[index];
      const parts = [];
      let written = 0;
      const output = new WritableStream({
        write(chunk) {
          signal?.throwIfAborted();
          written += chunk.byteLength;
          if (written > size) throw new Error('ZIP entry exceeded its declared size.');
          parts.push(new Blob([chunk]));
          done += chunk.byteLength;
          onProgress({ phase: `Extracting file ${index + 1} of ${entries.length}`, done, total, unit: 'bytes' });
        }
      });
      await entry.getData(output);
      files.push({ path, blob: new Blob(parts), type, lastModified });
    }
    signal?.throwIfAborted();
    return files;
  } finally {
    await reader.close();
  }
}

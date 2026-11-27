import { safePath } from './format.js';
export async function createOutputBatch(parent) {
  const name = `encryptfs-${crypto.randomUUID()}`;
  return { name, directory: await parent.getDirectoryHandle(name, { create: true }) };
}
export async function outputFile(directory, path) {
  if (!safePath(path)) throw new Error('The output path is not safe.');
  const parts = path.split('/'); const filename = parts.pop();
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  for (let index = 0; index < 10000; index++) {
    const name = index ? `${stem} (${index})${extension}` : filename;
    try { await directory.getFileHandle(name); }
    catch (error) {
      if (error.name === 'NotFoundError') {
        const handle = await directory.getFileHandle(name, { create: true });
        return { handle, remove: () => directory.removeEntry(name) };
      }
      throw error;
    }
  }
  throw new Error('Too many output files have the same name.');
}

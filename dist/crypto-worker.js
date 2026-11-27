import { createBlobSink, createFileSink } from './lib/output-sinks.js';
import { CHUNK_SIZE, decryptChunk, encrypt, unlock, decryptEntry } from './lib/format.js';

const handles = new Map();
const controllers = new Map();
const videoReaders = new Map();

function openVideoReader({ id, index, token, port, type }) {
  const handle = handles.get(id);
  const entry = handle?.manifest.entries[index];
  if (!entry?.size || videoReaders.size >= 8) {
    port.postMessage({ error: 'The video is unavailable or has too many open streams.' });
    port.close();
    return;
  }
  const controller = new AbortController();
  let reading = false;
  function close(error) {
    if (error) port.postMessage({ error });
    controller.abort();
    videoReaders.delete(port);
    port.close();
  }
  videoReaders.set(port, { id, token, close });
  port.onmessage = async ({ data }) => {
    if (data === 'close') { close(); return; }
    const { start, end } = data;
    if (reading || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || start >= end || end > entry.size ||
        Math.floor(start / CHUNK_SIZE) !== Math.floor((end - 1) / CHUNK_SIZE)) {
      close('Invalid video byte range.');
      return;
    }
    reading = true;
    let plain;
    try {
      plain = await decryptChunk(handle, index, Math.floor(start / CHUNK_SIZE), controller.signal);
      if (controller.signal.aborted) return;
      const offset = start % CHUNK_SIZE;
      const bytes = plain.slice(offset, offset + end - start);
      port.postMessage({ bytes }, [bytes.buffer]);
    } catch (error) {
      if (!controller.signal.aborted) {
        self.postMessage({ videoPreviewError: { token, message: error.message } });
        close(error.message);
      }
    } finally {
      plain?.fill(0);
      reading = false;
    }
  };
  port.postMessage({ size: entry.size, chunkSize: CHUNK_SIZE, type });
}

function encryptedOutputError(action, error) {
  if (error.name === 'AbortError') return error;
  const hint = error.name === 'QuotaExceededError' ? ' Free up disk or browser storage and try again.' : '';
  return Object.assign(new Error(`Could not ${action} encrypted output.${hint} Browser error: ${error.message}`, { cause: error }), { code: 'OUTPUT_STORAGE' });
}

async function encryptedOutputStep(action, operation) {
  try { return await operation(); }
  catch (error) { throw encryptedOutputError(action, error); }
}

function encryptedOutputSink(sink) {
  return {
    write: bytes => encryptedOutputStep('write', () => sink.write(bytes)),
    close: () => encryptedOutputStep('finish', () => sink.close()),
    abort: () => sink.abort()
  };
}

async function encryptToDirectory(payload, options) {
  const { directory, outputName } = payload;
  try {
    const sink = await encryptedOutputStep('open', async () =>
      createFileSink(await directory.getFileHandle(outputName, { create: true })));
    return await encrypt(payload.entries, payload.password, { ...options, sink: encryptedOutputSink(sink) });
  } catch (error) {
    await directory.removeEntry(outputName).catch(() => {});
    throw error;
  }
}

self.onmessage = async ({ data }) => {
  const { request, action, payload } = data;
  if (action === 'cancel') { controllers.get(payload.request)?.abort(); return; }
  if (action === 'open-video-reader') { openVideoReader(payload); return; }
  if (action === 'close-video' || action === 'release') {
    for (const reader of videoReaders.values()) {
      if (action === 'release' ? reader.id === payload.id : reader.token === payload.token) reader.close('Video preview closed.');
    }
    if (action === 'release') handles.delete(payload.id);
    return;
  }
  const controller = new AbortController(); controllers.set(request, controller);
  const options = { signal: controller.signal, onProgress: progress => self.postMessage({ request, progress }) };
  try {
    let result;
    if (action === 'encrypt') {
      const encryptionOptions = { ...options, kind: payload.kind, name: payload.name };
      const output = payload.directory
        ? await encryptToDirectory(payload, encryptionOptions)
        : await encrypt(payload.entries, payload.password, { ...encryptionOptions, sink: encryptedOutputSink(createBlobSink()) });
      result = payload.savedToDisk ? { size: output.size } : output;
    }
    else if (action === 'extract-zip') {
      const { extractZip } = await import('./lib/zip-extract.js');
      result = await extractZip(payload.blob, { ...options, maxFiles: payload.maxFiles });
    } else if (action === 'unlock') {
      const handle = await unlock(payload.file, payload.password, options);
      handles.set(payload.id, handle); result = handle.manifest;
    } else if (action === 'decrypt') {
      const handle = handles.get(payload.id);
      if (!handle) throw new Error('Please unlock this container again.');
      result = await decryptEntry(handle, payload.index, options);
      // A Blob can exist before the browser finishes backing it with readable bytes.
      try {
        const probe = await result.slice(0, 512).arrayBuffer();
        new Uint8Array(probe).fill(0);
      } catch (error) {
        throw new Error(`The browser could not read the decrypted output. ${error.name}: ${error.message}`, { cause: error });
      }
      if (controller.signal.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
    } else throw new Error('Unknown operation.');
    try { self.postMessage({ request, result }); }
    catch (error) {
      if (action === 'encrypt' && !payload.savedToDisk) {
        throw encryptedOutputError('send', error);
      }
      if (action !== 'decrypt') throw error;
      throw new Error(`Could not send decrypted output to the workspace. ${error.name}: ${error.message}`, { cause: error });
    }
  } catch (error) {
    self.postMessage({ request, error: { message: error.message, code: error.name === 'AbortError' ? 'AbortError' : error.code || error.name } });
  } finally { controllers.delete(request); }
};

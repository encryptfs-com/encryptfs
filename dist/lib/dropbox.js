const abort = () => new DOMException('Dropbox import cancelled.', 'AbortError');
const check = signal => { if (signal?.aborted) throw abort(); };
export const isDropboxConfigured = config => typeof config?.appKey === 'string' && /^[A-Za-z0-9_-]{5,128}$/u.test(config.appKey);

// Signed Chooser links grant temporary file access. Restrict destinations, omit
// cookies, and never put these URLs in workspace rows, logs, or browser storage.
export function dropboxDownloadURL(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Dropbox returned an invalid download link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
    !(url.hostname === 'dropboxusercontent.com' || url.hostname.endsWith('.dropboxusercontent.com') || url.hostname === 'dl.dropbox.com')) {
    throw new Error('Dropbox returned an unsupported download link. Select this file again.');
  }
  return url.href;
}

export class DropboxImportSource {
  #config; #scope; #document; #fetch; #cancelPicker;
  constructor(config, { scope = globalThis.window, document = globalThis.document, fetch = globalThis.fetch } = {}) {
    this.#config = config; this.#scope = scope; this.#document = document; this.#fetch = fetch;
  }
  get configured() { return isDropboxConfigured(this.#config); }
  get ready() { return typeof this.#scope?.Dropbox?.choose === 'function'; }
  clear() { this.#cancelPicker?.(); }
  async prepare({ signal } = {}) {
    if (!this.configured) throw new Error('Dropbox is not configured for this installation yet.');
    check(signal); if (this.ready) return;
    await new Promise((resolve, reject) => {
      const script = this.#document.createElement('script');
      script.id = 'dropboxjs'; script.src = 'https://www.dropbox.com/static/api/2/dropins.js';
      script.setAttribute('data-app-key', this.#config.appKey); script.async = true;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); script.onload = null; script.onerror = null; };
      const cancel = () => { cleanup(); script.remove(); reject(abort()); };
      const timer = setTimeout(() => { cleanup(); script.remove(); reject(new Error('Dropbox took too long to load. Check your connection and try again.')); }, 20000);
      script.onload = () => { cleanup(); resolve(); };
      script.onerror = () => { cleanup(); script.remove(); reject(new Error('Dropbox could not load. Check your connection or browser content blockers.')); };
      signal?.addEventListener('abort', cancel, { once: true }); this.#document.head.append(script);
    });
    check(signal);
    if (!this.ready) throw new Error('Dropbox did not initialize. Please try again.');
  }
  // Called synchronously by a click after prepare(): Chooser opens a popup.
  pick({ signal, sizeLimit } = {}) {
    check(signal);
    if (!this.configured || !this.ready) return Promise.reject(new Error('Prepare Dropbox before choosing files.'));
    if (this.#scope.Dropbox.isBrowserSupported?.() === false) return Promise.reject(new Error('This browser does not support the Dropbox chooser. Use local import instead.'));
    if (this.#cancelPicker) return Promise.reject(new Error('The Dropbox chooser is already open.'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, files) => {
        if (settled) return; settled = true; this.#cancelPicker = null;
        signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(files);
      };
      const cancel = () => finish(abort()); this.#cancelPicker = cancel;
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const options = { linkType: 'direct', multiselect: true, folderselect: false,
          success: files => {
            if (settled) return;
            if (!Array.isArray(files)) { finish(new Error('Dropbox returned an invalid selection.')); return; }
            finish(null, files.map(file => ({ id: file?.id, name: file?.name, link: file?.link, bytes: file?.bytes, isDir: file?.isDir })));
          }, cancel: () => finish(null, []) };
        if (Number.isSafeInteger(sizeLimit) && sizeLimit > 0) options.sizeLimit = sizeLimit;
        // Omit windowName: Dropbox generates an unpredictable popup name.
        this.#scope.Dropbox.choose(options);
      } catch { finish(new Error('Dropbox could not open. Allow popups for this site and try again.')); }
    });
  }
  async *read(selected, { signal, remainingBytes, maxFiles = 10000, onProgress = () => {} } = {}) {
    if (!Array.isArray(selected) || selected.length > maxFiles) throw new Error(`Select no more than ${maxFiles} files for this workspace.`);
    const seen = new Set();
    for (let index = 0; index < selected.length; index++) {
      check(signal); const item = selected[index];
      const identity = item.id || item.link; if (seen.has(identity)) continue; seen.add(identity);
      try {
        if (item.isDir) throw new Error('Whole-folder imports from Dropbox are not supported yet. Select individual files inside the folder.');
        if (typeof item.name !== 'string' || !item.name) throw new Error('Dropbox did not provide a filename.');
        const size = item.bytes; const budget = remainingBytes();
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Dropbox did not provide a valid file size.');
        if (!Number.isSafeInteger(budget) || size > budget) throw new Error('This file exceeds the remaining workspace size limit.');
        const url = dropboxDownloadURL(item.link);
        onProgress({ phase: `Downloading ${index + 1}/${selected.length}: ${item.name}`, done: 0, total: size });
        let response;
        try { response = await this.#fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' }); }
        catch (error) { if (signal?.aborted || error.name === 'AbortError') throw abort(); throw new Error('Dropbox download could not start. Select the file again and check your connection.'); }
        if (response.url) dropboxDownloadURL(response.url);
        if (!response.ok) throw new Error([401, 403, 404, 410].includes(response.status) ? 'Dropbox access expired or this file is unavailable. Select it again.' : `Dropbox download failed (${response.status}). Try again.`);
        if (!response.body?.getReader) throw new Error('This browser cannot stream a Dropbox download safely.');
        const reader = response.body.getReader(); const chunks = []; let doneBytes = 0;
        try {
          while (true) {
            check(signal); let chunk;
            try { chunk = await reader.read(); } catch { if (signal?.aborted) throw abort(); throw new Error('Dropbox download was interrupted. Select this file again.'); }
            const { done, value } = chunk; if (done) break;
            doneBytes += value.byteLength;
            if (doneBytes > budget || doneBytes > size) throw new Error('The file changed size or exceeds the workspace limit. Select it again.');
            chunks.push(new Blob([value])); onProgress({ phase: `Downloading ${index + 1}/${selected.length}: ${item.name}`, done: doneBytes, total: size });
          }
          if (doneBytes !== size) throw new Error('The download was incomplete. Try importing this file again.');
          check(signal);
          yield { file: new File(chunks, item.name, { type: response.headers.get('Content-Type')?.split(';')[0] || '', lastModified: 0 }) };
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) throw abort();
        // Reader/network exceptions may mention a signed URL. Only expose known
        // messages raised here, never raw transport errors containing the link.
        const message = error instanceof TypeError ? 'Dropbox download was interrupted. Select this file again.' : error.message;
        yield { name: item.name || 'Dropbox file', error: message };
      }
    }
  }
}

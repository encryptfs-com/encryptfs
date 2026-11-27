const cancelled = () => new DOMException('OneDrive import cancelled.', 'AbortError');
const check = signal => { if (signal?.aborted) throw cancelled(); };
export const isOneDriveConfigured = config => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(config?.clientId || '');
export function graphURL(value) {
  const url = new URL(value, 'https://graph.microsoft.com/v1.0/');
  if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password || url.hash) throw new Error('OneDrive returned an invalid API destination.');
  return url.href;
}
export function oneDriveDownloadURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !['.1drv.com', '.sharepoint.com', '.storage.live.com', '.onedrive.live.com'].some(suffix => url.hostname.endsWith(suffix))) throw new Error('OneDrive returned an unsupported download destination.');
  return url.href;
}
export class OneDriveImportSource {
  #config; #client; #fetch; #load; #select; #scope; #controller; #generation = 0;
  constructor(config, { fetch = globalThis.fetch, scope = globalThis.window,
    load = () => import('../vendor/msal/auth.js'), select } = {}) {
    this.#config = config; this.#fetch = fetch; this.#scope = scope; this.#load = load; this.#select = select;
  }
  get configured() { return isOneDriveConfigured(this.#config); }
  get ready() { return !!this.#client; }
  clear() { this.#generation++; this.#controller?.abort(); const client = this.#client; this.#client = null; void client?.clearCache().catch(() => {}); }
  async prepare({ signal } = {}) {
    if (!this.configured) throw new Error('OneDrive is not configured for this installation yet.');
    check(signal); if (this.ready) return;
    const generation = this.#generation;
    let sdk;
    try { sdk = await this.#load(); } catch { throw new Error('OneDrive sign-in assets are missing. Follow docs/onedrive.md to build them.'); }
    const client = new sdk.PublicClientApplication({ auth: { clientId: this.#config.clientId,
      authority: 'https://login.microsoftonline.com/common', redirectUri: new URL('./onedrive-redirect.html', this.#scope.location.href).href },
      cache: { cacheLocation: 'memoryStorage' }, system: { loggerOptions: { loggerCallback() {}, piiLoggingEnabled: false } } });
    await client.initialize(); check(signal);
    if (generation !== this.#generation) { await client.clearCache(); throw cancelled(); }
    this.#client = client;
  }
  // Start sign-in directly in the click handler to retain popup activation.
  pick({ signal } = {}) {
    check(signal); if (!this.ready) return Promise.reject(new Error('Prepare OneDrive before choosing files.'));
    const client = this.#client, generation = this.#generation;
    const controller = new AbortController(); this.#controller = controller;
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
    const auth = client.acquireTokenPopup({ scopes: ['Files.Read'], prompt: 'select_account' });
    return (async () => {
      try {
        const result = await new Promise((resolve, reject) => {
          const onAbort = () => reject(cancelled());
          controller.signal.addEventListener('abort', onAbort, { once: true });
          auth.then(value => {
            controller.signal.removeEventListener('abort', onAbort);
            if (controller.signal.aborted || generation !== this.#generation) { void client.clearCache().catch(() => {}); reject(cancelled()); }
            else resolve(value);
          }, error => { controller.signal.removeEventListener('abort', onAbort); reject(error); });
          if (controller.signal.aborted) onAbort();
        }); check(controller.signal);
        if (generation !== this.#generation) throw cancelled();
        const token = result.accessToken;
        const list = async path => {
          check(controller.signal);
          const response = await this.#fetch(graphURL(path), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
          if (!response.ok) throw new Error('OneDrive could not list files. Check your account access and try again.');
          const data = await response.json(); check(controller.signal);
          if (!Array.isArray(data.value)) throw new Error('OneDrive returned an invalid folder listing.');
          return { items: data.value, next: data['@odata.nextLink'] ? graphURL(data['@odata.nextLink']) : null };
        };
        return await this.#select({ list, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw cancelled();
        if (error.errorCode === 'user_cancelled') return [];
        // SDK/transport exceptions can include credentials or signed links.
        throw new Error('OneDrive import could not complete. Allow sign-in popups, check your connection, and try again.');
      } finally { signal?.removeEventListener('abort', cancel); if (this.#controller === controller) this.#controller = null; }
    })();
  }
  async *read(selected, { signal, remainingBytes, maxFiles = 10000, onProgress = () => {} } = {}) {
    if (!Array.isArray(selected) || selected.length > maxFiles) throw new Error(`Select no more than ${maxFiles} files for this workspace.`);
    const seen = new Set();
    for (const item of selected) {
      check(signal); if (seen.has(item.id)) continue; seen.add(item.id);
      try {
        const budget = remainingBytes(), size = item.size;
        if (!item.file || typeof item.name !== 'string' || !item.name) throw new Error('Select individual files, rather than whole folders.');
        if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(budget) || size > budget) throw new Error('This file exceeds the remaining workspace size limit.');
        const url = oneDriveDownloadURL(item['@microsoft.graph.downloadUrl']);
        const response = await this.#fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
        if (!response.ok) throw new Error('OneDrive access expired or this file is unavailable. Select it again.');
        if (!response.body?.getReader) throw new Error('This browser cannot stream OneDrive downloads.');
        const reader = response.body.getReader(), chunks = []; let count = 0;
        try {
          while (true) {
            check(signal); const { done, value } = await reader.read(); if (done) break;
            count += value.byteLength;
            if (count > size || count > budget) throw new Error('The file changed size or exceeds the workspace limit.');
            chunks.push(new Blob([value])); onProgress({ phase: `Downloading ${item.name}`, done: count, total: size });
          }
          check(signal); if (count !== size) throw new Error('The download was incomplete. Select this file again.');
          yield { file: new File(chunks, item.name, { type: item.file.mimeType || '', lastModified: 0 }) };
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw cancelled();
        yield { name: item.name || 'OneDrive file', error: error instanceof TypeError || !['This file exceeds', 'Select individual', 'OneDrive access', 'This browser', 'The file changed', 'The download was'].some(prefix => error.message.startsWith(prefix)) ? 'OneDrive download failed. Select the file again and check your connection.' : error.message };
      }
    }
  }
}

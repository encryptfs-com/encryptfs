export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/files/';
const ABORT = () => new DOMException('Google Drive import cancelled.', 'AbortError');
const check = signal => { if (signal?.aborted) throw ABORT(); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/u.test(value);

export function isDriveConfigured(config) {
  return typeof config?.clientId === 'string' && config.clientId.endsWith('.apps.googleusercontent.com') &&
    typeof config.apiKey === 'string' && config.apiKey.length >= 20 && /^\d+$/u.test(String(config.appId));
}

function loadScript(document, src, signal) {
  return new Promise((resolve, reject) => {
    check(signal);
    const script = document.createElement('script'); script.src = src; script.async = true;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); script.onload = null; script.onerror = null; };
    const cancel = () => { cleanup(); script.remove(); reject(ABORT()); };
    const timer = setTimeout(() => { cleanup(); script.remove(); reject(new Error('Google Drive took too long to load. Check your connection and try again.')); }, 20000);
    script.onload = () => { cleanup(); resolve(); };
    script.onerror = () => { cleanup(); script.remove(); reject(new Error('Google Drive could not load. Check your connection or browser content blockers.')); };
    signal?.addEventListener('abort', cancel, { once: true }); document.head.append(script);
  });
}

// This adapter only sees Google tokens and selected remote files. Crypto passwords
// and keys are never passed to it. Tokens are private fields and never persisted.
export class GoogleDriveImportSource {
  #config; #scope; #document; #fetch; #now; #token = null; #expires = 0; #cancelPicker;
  constructor(config, { scope = globalThis.window, document = globalThis.document, fetch = globalThis.fetch.bind(globalThis), now = Date.now } = {}) {
    this.#config = config; this.#scope = scope; this.#document = document; this.#fetch = fetch; this.#now = now;
  }
  get configured() { return isDriveConfigured(this.#config); }
  get ready() { return Boolean(this.#scope?.google?.accounts?.oauth2 && this.#scope?.google?.picker?.PickerBuilder); }
  get connected() { return Boolean(this.#token && this.#expires > this.#now()); }
  clear() { this.#cancelPicker?.(); this.#token = null; this.#expires = 0; }

  async prepare({ signal } = {}) {
    if (!this.configured) throw new Error('Google Drive is not configured for this installation yet.');
    check(signal); if (this.ready) return;
    const scripts = [];
    if (!this.#scope.google?.accounts?.oauth2) scripts.push(loadScript(this.#document, 'https://accounts.google.com/gsi/client', signal));
    if (!this.#scope.gapi) scripts.push(loadScript(this.#document, 'https://apis.google.com/js/api.js', signal));
    await Promise.all(scripts); check(signal);
    if (!this.#scope.google?.picker?.PickerBuilder) await new Promise((resolve, reject) => {
      const finish = (error) => { signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(); };
      const cancel = () => finish(ABORT());
      signal?.addEventListener('abort', cancel, { once: true });
      this.#scope.gapi.load('picker', { callback: () => finish(), onerror: () => finish(new Error('Google file picker could not load.')),
        timeout: 20000, ontimeout: () => finish(new Error('Google file picker took too long to load.')) });
    });
    check(signal);
    if (!this.ready) throw new Error('Google Drive did not initialize. Please try again.');
  }

  // A warm picker should be called directly from the click handler so a
  // blocked first authorization can be retried with fresh user activation.
  pick({ signal } = {}) {
    check(signal);
    if (!this.configured || !this.ready) return Promise.reject(new Error('Prepare Google Drive before connecting.'));
    if (this.#cancelPicker) return Promise.reject(new Error('The Google Drive picker is already open.'));
    return new Promise((resolve, reject) => {
      let settled = false; let picker;
      const finish = (error, files) => {
        if (settled) return; settled = true; this.#cancelPicker = null;
        signal?.removeEventListener('abort', cancel);
        picker?.setVisible(false); picker?.dispose?.();
        error ? reject(error) : resolve(files);
      };
      const cancel = () => finish(ABORT()); this.#cancelPicker = cancel;
      signal?.addEventListener('abort', cancel, { once: true });
      const show = () => {
        if (settled) return;
        try {
          const api = this.#scope.google.picker;
          const view = new api.DocsView(api.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(api.DocsViewMode.LIST);
          picker = new api.PickerBuilder().addView(view).enableFeature(api.Feature.MULTISELECT_ENABLED)
            .setOAuthToken(this.#token).setDeveloperKey(this.#config.apiKey).setAppId(String(this.#config.appId))
            .setOrigin(this.#scope.location.origin).setTitle('Import from Google Drive').setCallback(data => {
              if (data.action === api.Action.CANCEL) finish(null, []);
              else if (data.action === api.Action.PICKED) {
                if (!Array.isArray(data.docs)) finish(new Error('Google Drive returned an invalid selection.'));
                else finish(null, data.docs.map(item => ({ id: item.id, name: item.name || 'Drive file', resourceKey: item.resourceKey || undefined })));
              } else if (data.action === 'error') finish(new Error('Google Drive could not open the file picker. Check the installation configuration.'));
            }).build();
          picker.setVisible(true);
        } catch { finish(new Error('Google Drive could not open the file picker. Check the installation configuration.')); }
      };
      if (this.connected) { show(); return; }
      try {
        const oauth = this.#scope.google.accounts.oauth2;
        const client = oauth.initTokenClient({ client_id: this.#config.clientId, scope: DRIVE_SCOPE, include_granted_scopes: false,
          callback: response => {
            if (settled) return;
            if (response.error || !response.access_token || !oauth.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
              finish(new Error('Google Drive access was not granted. No files were imported.')); return;
            }
            const seconds = Number(response.expires_in);
            if (!Number.isFinite(seconds) || seconds <= 0) { finish(new Error('Google Drive returned an invalid authorization lifetime.')); return; }
            this.#token = response.access_token; this.#expires = this.#now() + Math.max(0, seconds - 30) * 1000; show();
          },
          error_callback: error => finish(new Error(error.type === 'popup_closed' ? 'Google authorization was closed. No files were imported.' : 'Google sign-in could not open. Click the Drive icon again. Allow popups for this site if the browser still blocks it.'))
        });
        client.requestAccessToken({ prompt: 'select_account' });
      } catch { finish(new Error('Google authorization could not start. Please try again.')); }
    });
  }

  async #response(id, resourceKey, query, signal) {
    check(signal);
    if (!this.connected) { this.#token = null; throw new Error('Google Drive authorization expired. Reconnect and select the files again.'); }
    if (!validId(id)) throw new Error('Google Drive returned an invalid file ID.');
    const headers = { Authorization: `Bearer ${this.#token}` };
    if (resourceKey !== undefined) {
      if (!validId(resourceKey)) throw new Error('Google Drive returned an invalid resource key.');
      headers['X-Goog-Drive-Resource-Keys'] = `${id}/${resourceKey}`;
    }
    const response = await this.#fetch(`${API}${encodeURIComponent(id)}?${query}`, { headers, signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (response.status === 401) { this.#token = null; this.#expires = 0; throw new Error('Google Drive authorization expired. Reconnect and try again.'); }
    if (!response.ok) throw new Error(response.status === 403 ? 'You do not have permission to download this file, or Drive has limited the request.' : `Google Drive download failed (${response.status}). Try again.`);
    return response;
  }

  async *read(selected, { signal, remainingBytes, maxFiles = 10000, onProgress = () => {} } = {}) {
    if (!Array.isArray(selected) || selected.length > maxFiles) throw new Error(`Select no more than ${maxFiles} files for this workspace.`);
    const seen = new Set();
    for (let index = 0; index < selected.length; index++) {
      check(signal); const item = selected[index];
      if (seen.has(item.id)) continue; seen.add(item.id);
      try {
        const fields = 'id,name,mimeType,size,modifiedTime,capabilities(canDownload),resourceKey';
        const metadataResponse = await this.#response(item.id, item.resourceKey, `fields=${encodeURIComponent(fields)}&supportsAllDrives=true`, signal);
        const metadata = await metadataResponse.json(); check(signal);
        if (metadata.mimeType?.startsWith('application/vnd.google-apps.')) throw new Error('Select an ordinary file. Google documents, shortcuts, and whole-folder imports are not supported yet.');
        if (metadata.capabilities?.canDownload !== true) throw new Error('The owner does not allow downloading this file.');
        const expected = Number(metadata.size);
        if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Google Drive did not provide a valid file size.');
        const budget = remainingBytes();
        if (!Number.isSafeInteger(budget) || expected > budget) throw new Error('This file exceeds the remaining workspace size limit.');
        onProgress({ phase: `Downloading ${index + 1}/${selected.length}: ${metadata.name}`, done: 0, total: expected });
        const response = await this.#response(item.id, metadata.resourceKey || item.resourceKey, 'alt=media&supportsAllDrives=true', signal);
        if (!response.body?.getReader) throw new Error('This browser cannot stream a Google Drive download safely.');
        const reader = response.body.getReader(); const chunks = []; let size = 0;
        try {
          while (true) {
            check(signal); const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > budget || size > expected) throw new Error('The file changed size or exceeds the workspace limit. Select it again.');
            chunks.push(new Blob([value])); onProgress({ phase: `Downloading ${index + 1}/${selected.length}: ${metadata.name}`, done: size, total: expected });
          }
          if (size !== expected) throw new Error('The download was incomplete. Try importing this file again.');
          check(signal);
          yield { file: new File(chunks, metadata.name, { type: metadata.mimeType || '', lastModified: Date.parse(metadata.modifiedTime) || 0 }) };
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) throw ABORT();
        yield { name: item.name, error: error.message };
      }
    }
  }
}

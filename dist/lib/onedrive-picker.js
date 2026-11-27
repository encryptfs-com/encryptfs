// Local, accessible picker. Names are inserted as text, never provider HTML.
export function chooseOneDriveFiles({ list, signal }, document = globalThis.document) {
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog'); dialog.className = 'onedrive-picker';
    const heading = document.createElement('h2'); heading.textContent = 'Import from OneDrive';
    const path = document.createElement('p'), status = document.createElement('p'); status.setAttribute('role', 'status');
    const rows = document.createElement('div'); rows.className = 'onedrive-picker-files';
    const controls = document.createElement('div'); controls.className = 'onedrive-picker-controls';
    const button = (label, action) => { const node = document.createElement('button'); node.type = 'button'; node.className = 'secondary-button'; node.textContent = label; node.onclick = action; return node; };
    const selected = new Map(), parents = [{ name: 'OneDrive', url: 'me/drive/root/children' }]; let version = 0, next = null, settled = false;
    const finish = (error, files = []) => { if (settled) return; settled = true; version++; signal?.removeEventListener('abort', abort); dialog.close(); dialog.remove(); error ? reject(error) : resolve(files); };
    const abort = () => finish(new DOMException('OneDrive import cancelled.', 'AbortError'));
    const back = button('Back', () => { parents.pop(); load(); });
    const more = button('Load more', () => load(next, true));
    const submit = button('Import selected', () => finish(null, [...selected.values()])); submit.className = 'primary-button';
    const update = () => { submit.disabled = !selected.size; submit.textContent = selected.size ? `Import ${selected.size} selected` : 'Import selected'; };
    async function load(url = parents.at(-1).url, append = false) {
      const current = ++version; back.disabled = parents.length === 1; more.hidden = true;
      if (!append) rows.replaceChildren(); path.textContent = parents.map(item => item.name).join(' / '); status.textContent = 'Loading…';
      try {
        const page = await list(url); if (settled || current !== version) return;
        for (const item of page.items) {
          if (item.folder) {
            const open = button(`▸ ${item.name}`, () => { parents.push({ name: item.name, url: `me/drive/items/${encodeURIComponent(item.id)}/children` }); load(); });
            rows.append(open);
          } else if (item.file && typeof item.id === 'string') {
            const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(item.id);
            input.onchange = () => { input.checked ? selected.set(item.id, item) : selected.delete(item.id); update(); };
            label.append(input, document.createTextNode(item.name)); rows.append(label);
          }
        }
        next = page.next; more.hidden = !next; status.textContent = rows.childElementCount ? '' : 'This folder contains no files.';
      } catch { if (!settled && current === version) status.textContent = 'Unable to load this folder. Go back or close and try again.'; }
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    controls.append(back, more, button('Cancel', () => finish(null)), submit);
    dialog.append(heading, path, status, rows, controls); document.body.append(dialog); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    dialog.showModal(); update(); load();
  });
}

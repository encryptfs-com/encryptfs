import { createOutputBatch } from './lib/disk-output.js';
import { createEncryptedSession } from './lib/encrypted-storage.js';
import { DownloadReceipts } from './lib/download-receipts.js';
import { unlockedEntries, compareNames, batchProgress, contentProgress, isDevelopmentHost } from './lib/workspace-view.js';
import { OneDriveImportSource } from './lib/onedrive.js';
import { chooseOneDriveFiles } from './lib/onedrive-picker.js';
import { ONEDRIVE_CONFIG } from './onedrive-config.js';
import { inspect, MAX_BYTES, MAX_ENTRIES, safePath } from './lib/format.js';
import { LocalImportSource, LocalDownloadDestination } from './lib/transfers.js';
import { detectPreview, formatVideoDuration, readVideoDuration } from './lib/previews.js';
import { openVideoPreview, videoType } from './lib/video-preview.js';
import { createPdfPreview } from './lib/pdf-preview.js';
import { filterResults } from './lib/file-search.js';
import { GoogleDriveImportSource } from './lib/google-drive.js';
import { GOOGLE_DRIVE_CONFIG } from './drive-config.js';
import { DropboxImportSource } from './lib/dropbox.js';
import { DROPBOX_CONFIG } from './dropbox-config.js';
import { attachDelayedTooltip } from './lib/delayed-tooltip.js';

const $ = id => document.getElementById(id);
const state = { plain: [], encrypted: [], groups: [], plainSelection: new Set(), resultsSelection: new Set(), encryptedSelection: new Set(), activeTab: 'encrypt', resultsQuery: '', encryptedQuery: '', descending: false, failures: [], busy: false, cancelled: false, request: null, anchors: {}, previewURL: null };
const imports = new LocalImportSource();
const downloads = new LocalDownloadDestination();
const receipts = new DownloadReceipts({ onChange: () => { renderReceipts(); updateControls(); } });
const drive = new GoogleDriveImportSource(GOOGLE_DRIVE_CONFIG);
const dropbox = new DropboxImportSource(DROPBOX_CONFIG);
const onedrive = new OneDriveImportSource(ONEDRIVE_CONFIG, { select: chooseOneDriveFiles });
let providerController;
const videoPreviewThreshold = 64 * 1024 * 1024;
const storageRetryFiles = new Set();
let encryptedSessionPromise; let encryptedSessionGeneration = 0;
async function encryptedDirectory() {
  const generation = encryptedSessionGeneration;
  encryptedSessionPromise ??= createEncryptedSession();
  const pendingSession = encryptedSessionPromise;
  let session;
  try { session = await pendingSession; }
  catch (error) {
    if (encryptedSessionPromise === pendingSession) encryptedSessionPromise = null;
    checkCancelled();
    throw Object.assign(new Error(`Could not prepare temporary browser storage for encrypted output. Browser error: ${error.message}`, { cause: error }), { code: 'OUTPUT_STORAGE' });
  }
  if (generation !== encryptedSessionGeneration) { await session?.clear().catch(() => {}); throw new DOMException('Workspace cleared.', 'AbortError'); }
  checkCancelled(); return session?.directory;
}
const clearTooltip = attachDelayedTooltip($('clear-button'), $('clear-workspace-tooltip'));
let worker; let sequence = 0; const pending = new Map();
const iconPaths = {
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  extract: '<path d="M4 9h16v12H4zM3 4h18v5H3zM12 11v6m-3-3 3 3 3-3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  remove: '<path d="m6 6 12 12M6 18 18 6"/>'
};
function element(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
}
function iconButton(kind, label, callback) {
  const button = element('button', 'icon-button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[kind]}</svg>`;
  button.onclick = event => { event.stopPropagation(); callback(); }; return button;
}
function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MiB`;
}
const basename = path => path.split('/').at(-1);
const fileKey = (entry, index) => `${entry.id}:${index}`;
let notificationTimer;
function clearNotification() {
  clearTimeout(notificationTimer); $('messages').replaceChildren();
}
function message(text, error = false) {
  clearNotification();
  const box = element('div', `toast${error ? ' toast-error' : ''}`);
  const dismiss = iconButton('remove', 'Dismiss notification', clearNotification);
  const schedule = () => {
    if (!box.isConnected) return;
    clearTimeout(notificationTimer);
    if (!box.matches(':hover') && !box.contains(document.activeElement)) {
      notificationTimer = setTimeout(clearNotification, error ? 10000 : 6000);
    }
  };
  box.append(element('p', '', text), dismiss);
  box.onmouseenter = () => clearTimeout(notificationTimer);
  box.onmouseleave = schedule;
  box.onfocusin = () => clearTimeout(notificationTimer);
  box.onfocusout = event => { if (!box.contains(event.relatedTarget)) queueMicrotask(schedule); };
  $('messages').append(box); schedule();
}
function recordFailures(label, errors) {
  if (!errors.length) return;
  state.failures.push({ label, errors: [...errors] }); state.failures = state.failures.slice(-5);
  renderFailures();
}
function renderFailures() {
  const target = $('failure-list'); target.replaceChildren();
  $('failure-summary').hidden = !state.failures.length;
  $('failure-title').textContent = `Failed files (${state.failures.reduce((sum, batch) => sum + batch.errors.length, 0)})`;
  for (const batch of state.failures) {
    target.append(element('h3', '', batch.label));
    const list = element('ul'); batch.errors.forEach(text => list.append(element('li', '', text))); target.append(list);
  }
}
function renderReceipts() {
  const list = $('receipts-list'); list.replaceChildren(); $('download-receipts').hidden = !receipts.entries.length;
  for (const receipt of receipts.entries) {
    const row = element('div', 'download-receipt');
    const label = element('div'); label.append(element('strong', '', receipt.name), element('small', '', `${receipt.sourceName ? `From: ${receipt.sourceName} · ` : ''}Download requested · save not confirmed`));
    const retry = element('button', 'secondary-button', 'Retry download'); retry.type = 'button'; retry.disabled = state.busy;
    retry.onclick = () => operation('Retrying download', async () => { await downloads.write(receipt); message('Download requested again. Check your browser downloads.'); });
    row.append(label, retry, iconButton('remove', `Dismiss retry for ${receipt.name}`, () => receipts.remove(receipt.id))); list.append(row);
  }
}
function empty(target, symbol, title, description) {
  const box = element('div', 'empty-state'); box.append(element('span', 'empty-icon', symbol), element('strong', '', title), element('p', '', description)); target.append(box);
}
function rpc(action, payload, onProgress) {
  const request = ++sequence; state.request = request;
  return new Promise((resolve, reject) => {
    pending.set(request, { resolve, reject, onProgress });
    worker.postMessage({ request, action, payload });
  }).finally(() => { if (state.request === request) state.request = null; });
}
function progress(label, data) {
  const percent = data.total > 0 && !data.indeterminate ? ` · ${(100 * data.done / data.total).toFixed(1)}%${data.unit === 'bytes' ? ' of bytes' : ''}` : '';
  $('operation-label').textContent = `${label} · ${data.phase}${percent}`;
  if (data.total > 0 && !data.indeterminate) { $('operation-progress').max = data.total; $('operation-progress').value = data.done; }
  else $('operation-progress').removeAttribute('value');
}
async function operation(label, callback) {
  if (state.busy) return;
  state.busy = true; state.cancelled = false; $('operation').hidden = false; clearNotification();
  progress(label, { phase: 'Starting', total: 0 }); render();
  try { await callback(); }
  catch (error) { if (error.code !== 'AbortError' && error.name !== 'AbortError') recordFailures(label, [error.message]); message(error.code === 'AbortError' || error.name === 'AbortError' ? 'Operation cancelled. Completed results are still available.' : error.message, error.code !== 'AbortError' && error.name !== 'AbortError'); }
  finally { state.busy = false; state.cancelled = false; state.request = null; $('operation').hidden = true; render(); }
}
function checkCancelled() { if (state.cancelled) throw new DOMException('Operation cancelled.', 'AbortError'); }
function removePlain(id) {
  if (state.busy) return;
  if (durationProbe?.file.id === id) durationProbe.controller.abort();
  storageRetryFiles.delete(id);
  closePreview(); state.plain = state.plain.filter(file => file.id !== id); state.plainSelection.delete(id); state.resultsSelection.delete(id); render();
}
function removeEncrypted(id) {
  if (state.busy) return;
  worker.postMessage({ action: 'release', payload: { id } });
  state.encrypted = state.encrypted.filter(file => file.id !== id);
  for (const key of state.encryptedSelection) if (key.startsWith(`${id}:`)) state.encryptedSelection.delete(key);
  render();
}
function selectedOnDemandVideo() {
  if (state.encryptedSelection.size !== 1) return;
  for (const file of state.encrypted) {
    const index = file.manifest?.entries.findIndex((_, index) => state.encryptedSelection.has(fileKey(file, index)));
    if (index === undefined || index < 0) continue;
    const entry = file.manifest.entries[index];
    const type = entry.size >= videoPreviewThreshold && videoType(entry);
    if (type) return { file, item: { ...entry, index }, type };
    return;
  }
}
const selectionFor = area => area === 'plain' ? state.plainSelection : area === 'results' ? state.resultsSelection : state.encryptedSelection;
const listFor = area => $(`${area === 'plain' ? 'plain' : area === 'results' ? 'results' : 'encrypted'}-list`);
const filesFor = area => state.plain.filter(file => file.location === (area === 'results' ? 'results' : 'encrypt'));
function setActiveTab(tab, focus = false) {
  state.activeTab = tab;
  for (const name of ['encrypt', 'decrypt']) {
    $(`${name}-tab`).setAttribute('aria-selected', String(name === tab));
    $(`${name}-tab`).tabIndex = name === tab ? 0 : -1;
    $(`${name}-view`).hidden = name !== tab;
  }
  const flow = $('file-flow');
  if (flow.dataset.mode !== tab) {
    const files = flow.querySelector('.flow-files'), bridge = flow.querySelector('.flow-bridge'), vault = flow.querySelector('.flow-vault');
    flow.append(...(tab === 'encrypt' ? [files, bridge, vault] : [vault, bridge, files]));
  }
  flow.dataset.mode = tab;
  $('file-flow').setAttribute('aria-label', tab === 'encrypt' ? 'Encrypt photos, videos, and documents into .efs vaults' : 'Unlock and decrypt .efs vaults into photos, videos, and documents');
  $('flow-action').textContent = tab === 'encrypt' ? 'Encrypt with a password' : 'Unlock, then decrypt';
  $('drop-description').textContent = tab === 'encrypt' ? 'Drop files to encrypt, or click to browse.' : 'Drop .efs files to decrypt, or click to browse.';
  if (focus) $(`${tab}-tab`).focus();
}
function selectableRow({ key, name, size, badge, decrypted = false, area, preview, extract, download, remove, type, duration, disabled = false }) {
  const selection = selectionFor(area);
  const row = element('div', `file-row${selection.has(key) ? ' selected' : ''}`);
  row.dataset.key = key; row.setAttribute('role', 'group'); row.dataset.selected = String(selection.has(key)); row.setAttribute('aria-label', `${name}, ${badge}, ${formatSize(size)}`); row.setAttribute('aria-disabled', String(disabled)); row.tabIndex = disabled ? -1 : 0;
  const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = selection.has(key); checkbox.disabled = state.busy || disabled; checkbox.tabIndex = 0; checkbox.setAttribute('aria-label', `Select ${name}`);
  const nameCell = element('div', 'file-name-cell');
  const fileName = element('span', 'file-name', name); fileName.title = name;
  nameCell.append(checkbox, element('span', 'file-icon', type?.startsWith('image/') ? '▧' : type?.startsWith('video/') ? '▷' : '▤'), fileName);
  if (area === 'results') {
    const length = element('span', 'file-duration', duration || '');
    length.hidden = !duration;
    length.title = 'Video duration';
    nameCell.append(length);
  }
  const status = element('div', 'file-status'); status.title = type || badge;
  status.append(element('span', `badge ${decrypted ? 'decrypted' : area === 'encrypted' ? 'ready' : ''}`, badge));
  row.append(nameCell, status, element('span', 'file-size', formatSize(size)));
  const actions = element('div', 'row-actions');
  if (preview) actions.append(iconButton('eye', `Preview ${name}`, preview));
  if (extract) actions.append(iconButton('extract', `Extract ZIP ${name}`, extract));
  if (download) actions.append(iconButton('download', `Download ${name}`, download));
  if (remove) actions.append(iconButton('remove', `Remove ${name}`, remove));
  row.append(actions);
  row.onclick = event => { if (!state.busy && !disabled) selectRow(area, key, event, row); };
  if (preview) row.ondblclick = event => { if (!state.busy && !event.target.closest('button,input')) preview(); };
  row.onkeydown = event => {
    if (event.target !== row || state.busy || disabled) return;
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); selectRow(area, key, event, row); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(area, true); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); const list = visibleRows(area); const next = list[list.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) { next.focus(); selectRow(area, next.dataset.key, event, next); }
    }
  };
  return row;
}
function visibleRows(area) { return [...listFor(area).querySelectorAll('[data-key]')].filter(row => row.getClientRects().length && row.getAttribute('aria-disabled') !== 'true'); }
function selectRow(area, key, event, row) {
  const selection = selectionFor(area);
  const rows = visibleRows(area); const keys = rows.map(item => item.dataset.key); const anchor = state.anchors[area];
  if (event.shiftKey && keys.includes(anchor)) {
    if (!event.ctrlKey && !event.metaKey) selection.clear();
    const a = keys.indexOf(anchor); const b = keys.indexOf(key);
    for (const item of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) selection.add(item);
  } else if (event.ctrlKey || event.metaKey || event.target.type === 'checkbox' || event.key === ' ') {
    if (selection.has(key)) selection.delete(key); else selection.add(key); state.anchors[area] = key;
  } else { selection.clear(); selection.add(key); state.anchors[area] = key; }
  // Update in place so shift selection and keyboard focus survive.
  for (const item of rows) {
    const selected = selection.has(item.dataset.key); item.classList.toggle('selected', selected); item.dataset.selected = String(selected); item.querySelector('input').checked = selected;
  }
  if (event.target.type !== 'checkbox') row?.focus({ preventScroll: true }); updateControls();
  if (area === 'results' && selection.has(key)) {
    const file = state.plain.find(item => item.id === key); if (file) previewFile(file);
  }
}
function allKeys(area) {
  return area !== 'encrypted' ? (area === 'results' ? filterResults(filesFor(area), state.resultsQuery) : filesFor(area)).map(file => file.id) : state.encrypted.flatMap(file => unlockedEntries(file, state.encryptedQuery).map(entry => fileKey(file, entry.index)));
}
function selectAll(area, selected) {
  const selection = selectionFor(area);
  selection.clear(); if (selected) for (const key of allKeys(area)) selection.add(key);
  render();
}
function tree(parent, items, rowFactory) {
  const root = new Map();
  for (const item of items) {
    const parts = item.path.split('/'); let branch = root;
    for (const part of parts.slice(0, -1)) { if (!branch.has(part)) branch.set(part, new Map()); branch = branch.get(part); }
    branch.set(parts.at(-1), item);
  }
  function walk(target, branch) {
    for (const [name, value] of branch) {
      if (value instanceof Map) {
        const details = element('details'); details.open = true; details.append(element('summary', '', `▱ ${name}`));
        const children = element('div', 'tree'); walk(children, value); details.append(children); target.append(details);
      } else target.append(rowFactory(value));
    }
  }
  walk(parent, root);
}
function renderPlain(area = 'plain') {
  const list = listFor(area); list.replaceChildren(); const files = (area === 'results' ? filterResults(filesFor(area), state.resultsQuery) : filesFor(area)).sort(compareNames);
  if (!files.length) {
    if (area === 'results' && state.resultsQuery.trim() && filesFor('results').length) { empty(list, '⌕', 'No matching files', 'Try a different filename or folder name.'); return; }
    empty(list, area === 'results' ? '▤' : '＋', area === 'results' ? 'Decrypted files will appear here' : 'Add files to encrypt',
      area === 'results' ? 'Unlock names in the list above, then decrypt the files you want to see.' : 'Drop files or use Add files.');
    return;
  }
  const row = file => {
    const name = basename(file.path);
    const zip = /\.zip$/iu.test(name) || file.type === 'application/zip';
    return selectableRow({ key: file.id, name, size: file.blob.size,
      badge: file.origin === 'decrypted' ? 'Decrypted' : zip ? 'ZIP archive' : 'Imported',
      decrypted: file.origin === 'decrypted', area, type: file.type, duration: file.duration,
      preview: zip ? undefined : () => previewFile(file), extract: zip ? () => extractArchive(file, area) : undefined,
      download: () => downloads.write({ blob: file.blob, name }), remove: () => removePlain(file.id) });
  };
  const groups = new Map();
  for (const file of files) {
    if (!file.group) list.append(row(file));
    else { if (!groups.has(file.group)) groups.set(file.group, []); groups.get(file.group).push(file); }
  }
  for (const members of groups.values()) {
    const details = element('details', 'file-group'); details.open = true;
    const summary = element('summary', '', `▱ ${members[0].rootName}`); summary.append(element('span', `badge ${members[0].origin === 'decrypted' ? 'decrypted' : ''}`, members[0].origin === 'decrypted' ? 'Decrypted' : 'Imported'));
    const children = element('div', 'tree'); tree(children, members, row); details.append(summary, children); list.append(details);
  }
}
function renderEncrypted() {
  const list = $('encrypted-list'); list.replaceChildren();
  if (!state.encrypted.length) { empty(list, '◇', 'No encrypted files', 'Add .efs files to unlock their names and choose what to decrypt.'); return; }
  const visibleUnlocked = state.encrypted.reduce((sum, file) => sum + unlockedEntries(file, state.encryptedQuery).length, 0);
  if (state.encryptedQuery.trim() && !visibleUnlocked) list.append(element('p', 'search-hint', 'No matching unlocked filenames. Locked filenames cannot be searched.'));
  const sorted = [...state.encrypted].sort((a, b) => Number(Boolean(b.manifest)) - Number(Boolean(a.manifest)) || compareNames({ name: a.manifest?.name || a.name }, { name: b.manifest?.name || b.name }) * (state.descending ? -1 : 1));
  for (const file of sorted) {
    if (!file.manifest) {
      const row = element('div', 'file-row locked-row');
      const nameCell = element('div', 'file-name-cell'); const name = element('span', 'file-name', file.name); name.title = file.name;
      nameCell.append(element('span', 'file-icon', '◇'), name);
      const status = element('div', 'file-status'); status.append(element('span', `badge${file.error ? ' error' : ''}`, file.error ? 'Check failed' : file.matchNote || 'Locked'));
      const actions = element('div', 'row-actions'); actions.append(iconButton('remove', `Remove ${file.name}`, () => removeEncrypted(file.id)));
      row.append(nameCell, status, element('span', 'file-size', formatSize(file.file.size)), actions); list.append(row);
      if (file.error) list.append(element('p', 'row-error', file.error));
    } else {
      const available = unlockedEntries(file, state.encryptedQuery, state.descending);
      if (!available.length) continue;
      const row = item => {
        const type = item.size && videoType(item);
        return selectableRow({ key: fileKey(file, item.index), name: basename(item.path), size: item.size, badge: 'Ready to decrypt', area: 'encrypted', type: type || item.type,
          preview: type ? () => previewUnlockedVideo(file, item, type) : undefined });
      };
      if (file.manifest.kind === 'file') {
        const wrapper = element('div'); const line = row(available[0]);
        line.querySelector('.row-actions').append(iconButton('remove', `Remove ${file.manifest.name}`, () => removeEncrypted(file.id))); wrapper.append(line); list.append(wrapper);
      } else {
        const details = element('details', 'file-group ready-container'); details.open = true;
        const summary = element('summary', '', `▱ ${file.manifest.name}`); summary.append(element('span', 'badge ready', 'Ready to decrypt'));
        const heading = element('div', 'folder-row-heading'); const select = element('input'); select.type = 'checkbox'; select.disabled = state.busy;
        select.setAttribute('aria-label', `Select folder ${file.manifest.name}`);
        select.disabled = state.busy || !available.length;
        select.checked = available.length > 0 && available.every(entry => state.encryptedSelection.has(fileKey(file, entry.index)));
        select.indeterminate = available.some(entry => state.encryptedSelection.has(fileKey(file, entry.index))) && !select.checked;
        select.onchange = () => { available.forEach(entry => select.checked ? state.encryptedSelection.add(fileKey(file, entry.index)) : state.encryptedSelection.delete(fileKey(file, entry.index))); render(); };
        heading.append(select, element('span', '', `${available.length} files remaining`), iconButton('remove', `Remove ${file.manifest.name}`, () => removeEncrypted(file.id)));
        const children = element('div', 'tree'); tree(children, available, row);
        details.append(summary, heading, children); list.append(details);
      }
      if (file.error) list.append(element('p', 'row-error', file.error));
    }
  }
}
async function exportFiles(group, files) {
  await operation('Exporting encrypted files', async () => {
    let count = 0;
    for (const file of files) {
      checkCancelled(); await downloads.write(file); receipts.add(file);
      group.files = group.files.filter(item => item !== file); count++;
      if (!group.files.length) state.groups = state.groups.filter(item => item !== group);
    }
    message(`Download requested for ${count} ${count === 1 ? 'file' : 'files'}. Check your browser downloads. Retry copies are available below for 2 minutes.`);
  });
}
function renderExports() {
  const list = $('export-list'); list.replaceChildren(); $('export-section').hidden = !state.groups.length;
  for (const group of [...state.groups].reverse()) {
    const box = element('section', 'export-group');
    const heading = element('div', 'export-group-header');
    const status = group.savedTo ? `saved in ${group.savedTo}` : 'ready to export';
    heading.append(element('strong', '', `Encryption ${group.number} · ${group.files.length} ${group.files.length === 1 ? 'file' : 'files'} ${status}`));
    heading.append(iconButton('remove', `Remove export group ${group.number}`, () => {
      if (state.busy) return;
      if (!group.savedTo && !confirm('Remove these encrypted outputs from the workspace? Export them first if you want to keep them.')) return;
      state.groups = state.groups.filter(item => item !== group); render();
    })); box.append(heading);
    for (const file of group.files) {
      const entry = element('div', 'export-entry');
      const success = element('span', 'encryption-success', '✓'); success.setAttribute('role', 'img'); success.setAttribute('aria-label', 'Encryption complete'); entry.append(success);
      const info = element('div');
      const source = element('span', 'output-source', `From: ${file.sourceName}`);
      const size = element('small', '', `${formatSize(file.size)} · Encrypted .efs`);
      if (group.savedTo) {
        info.append(source, element('strong', '', file.name), size);
        entry.append(info); box.append(entry);
        continue;
      }
      const input = element('input'); input.value = file.name; input.setAttribute('aria-label', `Export filename ${file.id}`); input.disabled = state.busy;
      input.onchange = () => {
        let name = input.value;
        if (!name.toLowerCase().endsWith('.efs')) name += '.efs';
        if (!safePath(name) || name.includes('/')) { input.value = file.name; message('Choose a filename without path separators or reserved characters.', true); return; }
        file.name = name; input.value = name;
      };
      info.append(source, input, size);
      const button = element('button', 'secondary-button export-file-button', 'Export ↓'); button.type = 'button'; button.disabled = state.busy;
      button.setAttribute('aria-label', `Export encrypted file ${file.id}`); button.onclick = () => exportFiles(group, [file]);
      entry.append(info, button); box.append(entry);
    }
    if (!group.savedTo && group.files.length > 1) {
      const button = element('button', 'secondary-button', 'Export this group ↓'); button.disabled = state.busy;
      button.onclick = () => exportFiles(group, [...group.files]); box.append(button);
    }
    if (!group.savedTo) box.append(element('p', 'export-caption', 'Exported files leave this workspace. Keep your password — there’s no recovery.'));
    list.append(box);
  }
}
function updateControls() {
  const busy = state.busy;
  const ready = allKeys('encrypted');
  $('plain-count').textContent = filesFor('plain').length; $('results-count').textContent = filesFor('results').length; $('encrypted-count').textContent = state.encrypted.length;
  $('export-count').textContent = state.groups.reduce((sum, g) => sum + g.files.length, 0);
  $('plain-size').textContent = formatSize(filesFor('plain').reduce((sum, f) => sum + f.blob.size, 0));
  const totalUnlocked = state.encrypted.reduce((sum, file) => sum + unlockedEntries(file).length, 0);
  const lockedCount = state.encrypted.filter(file => !file.manifest).length;
  $('ready-count').textContent = `${totalUnlocked} unlocked · ${lockedCount} locked`;
  $('clear-encrypted-search').hidden = !state.encryptedQuery;
  $('encrypted-search-summary').textContent = state.encryptedQuery.trim() ? `${ready.length} of ${totalUnlocked} unlocked files · locked names cannot be searched` : '';
  $('sort-encrypted').textContent = state.descending ? 'Name ↓' : 'Name ↑';
  $('sort-encrypted').setAttribute('aria-label', `Sort unlocked filenames ${state.descending ? 'ascending' : 'descending'}`);
  const resultTotal = filesFor('results').length;
  $('results-search-summary').textContent = state.resultsQuery.trim() ? `${filterResults(filesFor('results'), state.resultsQuery).length} of ${resultTotal} files` : '';
  $('clear-results-search').hidden = !state.resultsQuery;
  for (const area of ['plain', 'encrypted', 'results']) {
    const input = $(`${area}-select-all`);
    const selection = selectionFor(area);
    const keys = allKeys(area); input.checked = keys.length > 0 && keys.every(key => selection.has(key));
    input.indeterminate = selection.size > 0 && !input.checked; input.disabled = busy || !keys.length;
  }
  $('encrypt-button').disabled = busy || !state.plainSelection.size;
  $('encrypt-storage-retry').hidden = typeof window.showDirectoryPicker !== 'function' ||
    !filesFor('plain').some(file => state.plainSelection.has(file.id) && storageRetryFiles.has(file.id));
  $('encrypt-to-folder').disabled = busy;
  $('decrypt-button').disabled = busy || !state.encryptedSelection.size;
  const onDemand = selectedOnDemandVideo();
  $('decrypt-button').textContent = onDemand ? 'Preview on demand' : `Decrypt selected${state.encryptedSelection.size ? ` (${state.encryptedSelection.size})` : ''} ↓`;
  $('unlock-button').disabled = busy || !state.encrypted.some(file => !file.manifest);
  $('unlock-form').hidden = !state.encrypted.length;
  $('decrypt-selection-summary').textContent = onDemand ? '1 selected · Decrypt during playback' :
    state.encryptedSelection.size ? `${state.encryptedSelection.size} selected · Decrypt to view below` : 'Select unlocked files to decrypt.';
  const selectedResults = filesFor('results').filter(file => state.resultsSelection.has(file.id));
  $('change-password').disabled = busy || !selectedResults.length;
  $('download-selected').disabled = busy || !selectedResults.length;
  $('results-selection-summary').textContent = selectedResults.length ? `${selectedResults.length} selected` : 'Select files to download or re-encrypt.';
  $('download-selected').textContent = `Download selected${selectedResults.length ? ` (${selectedResults.length})` : ''}`;
  $('change-password').textContent = `Re-encrypt selected${selectedResults.length ? ` (${selectedResults.length})` : ''}…`;
  for (const id of ['encrypt-password', 'confirm-password', 'unlock-password', 'as-folder', 'folder-name', 'clear-button', 'add-files', 'import-drive', 'disconnect-drive', 'import-dropbox', 'import-onedrive']) $(id).disabled = busy;
  for (const [id, source] of [['import-drive', drive], ['import-dropbox', dropbox], ['import-onedrive', onedrive]]) {
    $(id).hidden = !source.configured && !isDevelopmentHost(location.hostname);
    $(id).classList.toggle('provider-unconfigured', !source.configured);
  }
  for (const [id, source, name] of [['import-dropbox', dropbox, 'Dropbox'], ['import-onedrive', onedrive, 'OneDrive']]) {
    const label = !source.configured ? `${name} — not configured (development)` : source.ready ? `Import from ${name}` : `Connect to ${name}`; $(id).title = label; $(id).setAttribute('aria-label', label);
  }
  const driveLabel = !drive.configured ? 'Google Drive — not configured (development)' : !drive.ready || !drive.connected ? 'Connect to Google Drive' : 'Import from Google Drive';
  $('import-drive').setAttribute('aria-label', driveLabel); $('import-drive').title = driveLabel;
  $('disconnect-drive').hidden = !drive.connected;
  $('drop-zone').setAttribute('aria-disabled', String(busy));
  $('encrypt-tab-count').textContent = filesFor('plain').length + Number($('export-count').textContent);
  $('decrypt-tab-count').textContent = state.encrypted.length + resultTotal;
  $('decrypt-tab-count').title = `${state.encrypted.length} encrypted containers · ${resultTotal} decrypted files`;
  $('encrypt-tab-count').title = `${filesFor('plain').length} input files · ${$('export-count').textContent} encrypted outputs`;
  for (const button of document.querySelectorAll('#receipts-list button')) button.disabled = busy;
  setActiveTab(state.activeTab);
  for (const button of document.querySelectorAll('.row-actions button')) button.disabled = busy;
}
function render() {
  renderPlain(); renderPlain('results'); renderEncrypted(); renderExports(); renderReceipts(); renderFailures(); updateControls();
  void readResultDurations();
}

const durationProbed = new WeakSet();
let durationProbe;
function showResultDuration(file, duration) {
  file.duration = duration;
  const length = $('results-list').querySelector(`[data-key="${CSS.escape(file.id)}"] .file-duration`);
  if (length) { length.textContent = duration; length.hidden = false; }
}
async function readResultDurations() {
  if (durationProbe) return;
  while (!state.busy) {
    const file = filesFor('results').find(item => !item.duration && !durationProbed.has(item) &&
      (videoType(item) || item.type?.startsWith('video/')));
    if (!file) return;
    durationProbed.add(file);
    const controller = new AbortController();
    durationProbe = { file, controller };
    try {
      const renderer = await detectPreview(file.blob);
      if (renderer.kind === 'video' && !file.duration && !controller.signal.aborted && file.location === 'results') {
        const duration = await readVideoDuration(file.blob, renderer.type, controller.signal);
        if (duration && !controller.signal.aborted && file.location === 'results') showResultDuration(file, duration);
      }
    } catch { /* Unreadable metadata does not prevent other files from loading. */ }
    finally { durationProbe = undefined; }
  }
}

async function intake(fileList) {
  if (state.busy) return;
  await operation('Importing files', async () => addFiles(await imports.read(fileList)));
}
async function extractArchive(archive, area) {
  const name = basename(archive.path);
  await operation('Extracting ZIP', async () => {
    const maxFiles = MAX_ENTRIES - state.plain.length - state.encrypted.length;
    const files = await rpc('extract-zip', { blob: archive.blob, maxFiles }, data => progress('Extracting ZIP', data));
    checkCancelled();
    const group = `zip:${crypto.randomUUID()}`;
    const stem = name.replace(/\.zip$/iu, '');
    const rootName = safePath(stem) ? stem : name;
    const selection = selectionFor(area);
    selection.delete(archive.id);
    for (const file of files) {
      const id = crypto.randomUUID();
      state.plain.push({ ...file, id, rootName, group, location: archive.location, origin: archive.origin });
      selection.add(id);
    }
    message(`Extracted ${files.length} ${files.length === 1 ? 'file' : 'files'} from ${name}.`);
  });
}
async function addFiles(files, { announce = true, navigate = true } = {}) {
    const importId = crypto.randomUUID(); const destinations = new Set(); let count = 0, toEncrypt = 0, toDecrypt = 0; const failures = [];
    if (files.length + state.plain.length + state.encrypted.length > MAX_ENTRIES) throw new Error('This workspace supports up to 10,000 file entries.');
    for (const file of files) {
      checkCancelled();
      try {
        if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('This file size is not supported by the browser.');
        const header = await inspect(file);
        const id = crypto.randomUUID();
        if (header) { state.encrypted.push({ id, name: file.name, file, manifest: null, error: null }); destinations.add('decrypt'); toDecrypt++; }
        else {
          if (/\.efs$/iu.test(file.name)) throw new Error('This file has no valid .efs header. Get a complete copy of the encrypted file.');
          const relative = file.webkitRelativePath || file.name;
          if (!safePath(relative)) throw new Error('This filename has unsupported or unsafe path characters. Rename it before importing.');
          const parts = relative.split('/');
          state.plain.push({ id, path: parts.length > 1 ? parts.slice(1).join('/') : file.name, blob: file, type: file.type,
            lastModified: file.lastModified, origin: 'imported', location: 'encrypt', group: parts.length > 1 ? `import:${importId}:${parts[0]}` : null, rootName: parts[0] });
          state.plainSelection.add(id); destinations.add('encrypt'); toEncrypt++;
        }
        count++;
      } catch (error) { failures.push(`${file.name}: ${error.message}`); }
      progress('Importing files', { phase: `${count + failures.length} of ${files.length}`, done: count + failures.length, total: files.length });
    }
    if (navigate && destinations.size === 1) setActiveTab([...destinations][0]);
    if (announce) recordFailures('Import', failures);
    if (announce) message(`${count} ${count === 1 ? 'file added' : 'files added'} · ${toEncrypt} to encrypt · ${toDecrypt} to decrypt.${failures.length ? ` ${failures.length} could not be added. ${failures.slice(0, 3).join(' ')}` : ''}`, failures.length > 0);
    return { count, toEncrypt, toDecrypt, failures, destinations };
}

async function importProvider(source, name, iconName) {
  if (state.busy) return;
  if (!source.configured) { message(`${name} is not configured for this installation yet.`, true); return; }
  providerController = new AbortController();
  const signal = providerController.signal;
  if (!source.ready) {
    await operation(`Preparing ${name}`, async () => {
      await source.prepare({ signal });
      message(`${name} is ready. Click the ${iconName} icon again to choose files.`);
    });
    providerController = null; return;
  }
  // Open authorization/chooser synchronously in this click, before any await.
  const selection = source.pick({ signal, sizeLimit: MAX_BYTES });
  await operation(`Importing from ${name}`, async () => {
    const files = await selection; checkCancelled();
    if (!files.length) { message(`No ${name} files selected.`); return; }
    const failures = []; const destinations = new Set(); const initialTab = state.activeTab; let count = 0, toEncrypt = 0, toDecrypt = 0;
    for await (const result of source.read(files, { signal, remainingBytes: () => MAX_BYTES,
      maxFiles: Math.max(0, MAX_ENTRIES - state.plain.length - state.encrypted.length),
      onProgress: p => progress(name, p) })) {
      checkCancelled();
      if (result.error) { failures.push(`${result.name}: ${result.error}`); continue; }
      const added = await addFiles([result.file], { announce: false, navigate: false });
      count += added.count; toEncrypt += added.toEncrypt; toDecrypt += added.toDecrypt; failures.push(...added.failures); added.destinations.forEach(tab => destinations.add(tab)); render();
    }
    setActiveTab(destinations.size === 1 ? [...destinations][0] : initialTab);
    recordFailures(`Import from ${name}`, failures);
    message(`${count} ${count === 1 ? 'file imported' : 'files imported'} from ${name} · ${toEncrypt} to encrypt · ${toDecrypt} to decrypt.${failures.length ? ` ${failures.length} failed. ${failures.slice(0, 3).join(' ')}` : ''}`, failures.length > 0);
  });
  providerController = null;
}

const importDrive = () => importProvider(drive, 'Google Drive', 'Drive');
const importDropbox = () => importProvider(dropbox, 'Dropbox', 'Dropbox');

async function encryptSelected(event) {
  event.preventDefault();
  const saveToFolder = event.submitter?.id === 'encrypt-to-folder';
  const selected = filesFor('plain').filter(file => state.plainSelection.has(file.id) && (!saveToFolder || storageRetryFiles.has(file.id)));
  if (state.busy || !selected.length) return;
  const password = $('encrypt-password').value;
  if (password !== $('confirm-password').value) { $('confirm-password').setCustomValidity('Passwords do not match.'); $('confirm-password').reportValidity(); return; }
  const folder = $('as-folder').checked; const folderName = $('folder-name').value;
  if (folder && (!safePath(folderName) || folderName.includes('/'))) { message('Choose a valid folder name.', true); return; }
  const totalBytes = selected.reduce((sum, file) => sum + file.blob.size, 0);
  let produced = false;
  await operation('Encrypting', async () => {
    const parent = saveToFolder ? await window.showDirectoryPicker({ mode: 'readwrite', id: 'encryptfs-encrypted' }) : null;
    checkCancelled();
    $('encrypt-password').value = ''; $('confirm-password').value = '';
    const output = parent ? await createOutputBatch(parent) : null; checkCancelled();
    const group = { id: crypto.randomUUID(), number: ++encryptionNumber, files: [], savedTo: output && `${parent.name}/${output.name}` };
    const batches = folder ? [selected] : selected.map(file => [file]); const errors = [];
    let processedBytes = 0;
    for (let index = 0; index < batches.length; index++) {
      checkCancelled(); const batch = batches[index];
      progress(`Encrypting file ${index + 1} of ${batches.length}`, contentProgress(processedBytes, totalBytes, { phase: 'Starting' }));
      try {
        const entries = batch.map(file => ({ path: folder ? (file.group ? `${file.rootName}/${file.path}` : file.path) : basename(file.path), blob: file.blob, type: file.type, lastModified: file.lastModified }));
        const id = crypto.randomUUID();
        const outputName = `${id}.efs`;
        const directory = output ? output.directory : await encryptedDirectory();
        checkCancelled();
        const result = await rpc('encrypt', { entries, password, directory, outputName, savedToDisk: Boolean(output), kind: folder ? 'folder' : 'file', name: folder ? folderName : entries[0].path }, p => progress(`Encrypting file ${index + 1} of ${batches.length}`, contentProgress(processedBytes, totalBytes, p)));
        group.files.push({ id, name: outputName, sourceName: folder ? `${folderName} (${batch.length} files)` : batch[0].path, size: result.size, blob: output ? null : result });
        if (!state.groups.includes(group)) state.groups.push(group);
        const ids = new Set(batch.map(file => file.id));
        closePreview(); state.plain = state.plain.filter(file => !ids.has(file.id));
        for (const id of ids) { state.plainSelection.delete(id); storageRetryFiles.delete(id); }
        render();
      } catch (error) {
        if (error.code === 'AbortError' || error.name === 'AbortError') throw error;
        if (!saveToFolder) {
          for (const file of batch) {
            if (error.code === 'OUTPUT_STORAGE' || error.code === 'OUTPUT') storageRetryFiles.add(file.id);
            else storageRetryFiles.delete(file.id);
          }
        }
        errors.push(`${folder ? folderName : batch[0].path}: ${error.message}`);
      }
      finally { processedBytes += batch.reduce((sum, file) => sum + file.blob.size, 0); }
    }
    recordFailures('Encryption', errors);
    const summary = output && group.files.length
      ? `Saved ${group.files.length} encrypted ${group.files.length === 1 ? 'file' : 'files'} in ${group.savedTo}.`
      : group.files.length
      ? `${group.files.length} encrypted ${group.files.length === 1 ? 'file is' : 'files are'} ready to rename and download.`
      : 'Encryption failed.';
    message(`${summary}${errors.length ? ` ${errors.length} failed: ${errors.slice(0, 3).join(' ')}` : ''}`, errors.length > 0);
    produced = group.files.length > 0;
  });
  if (produced) revealResults('export-section');
}
function revealResults(id) {
  requestAnimationFrame(() => {
    const panel = $(id);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    if (reducedMotion) return;
    // Animate once on completion, rather than on every list render or selection.
    const rows = panel.querySelectorAll('.export-entry, .file-row');
    [...rows].slice(0, 12).forEach((row, index) => row.animate?.([
      { opacity: .45, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 240, delay: Math.min(index * 16, 96), easing: 'ease-out' }));
  });
}
let encryptionNumber = 0;
async function unlockFiles(event) {
  event.preventDefault();
  const password = $('unlock-password').value; if (!password) return; $('unlock-password').value = '';
  await operation('Unlocking filenames', async () => {
    const locked = state.encrypted.filter(file => !file.manifest); let matches = 0; let noMatch = 0; const errors = [];
    for (let index = 0; index < locked.length; index++) {
      checkCancelled(); progress(`Checking password: ${index + 1} of ${locked.length}`, batchProgress(index, locked.length, { phase: 'Checking password' })); const file = locked[index]; file.error = null; file.matchNote = null;
      try {
        file.manifest = await rpc('unlock', { id: file.id, file: file.file, password }, p => progress(`Checking password: ${index + 1} of ${locked.length}`, batchProgress(index, locked.length, p)));
        const entryCount = state.encrypted.reduce((sum, item) => sum + (item.manifest?.entries.length || 0), 0);
        if (entryCount > MAX_ENTRIES) {
          file.manifest = null; worker.postMessage({ action: 'release', payload: { id: file.id } });
          throw new Error('The workspace supports up to 10,000 unlocked entries. Remove some containers and retry.');
        }
        matches++; render();
      } catch (error) {
        if (error.code === 'AbortError' || error.name === 'AbortError') throw error;
        if (error.code === 'NO_MATCH') { noMatch++; file.matchNote = 'No password match'; } else { file.error = error.message; errors.push(`${file.name}: ${error.message}`); }
      }
    }
    recordFailures('Unlock filenames', errors);
    message(`${matches} ${matches === 1 ? 'container unlocked' : 'containers unlocked'}. Select the files you want to decrypt.${noMatch ? ` ${noMatch} remained locked (password did not match, or metadata is damaged).` : ''}${errors.length ? ` ${errors.length} could not be read: ${errors[0]}` : ''}`, errors.length > 0);
  });
}
async function decryptSelected() {
  if (state.busy) return;
  const onDemand = selectedOnDemandVideo();
  if (onDemand) return previewUnlockedVideo(onDemand.file, onDemand.item, onDemand.type);
  const selected = state.encrypted.flatMap(file => file.manifest ? file.manifest.entries.flatMap((entry, index) => state.encryptedSelection.has(fileKey(file, index)) ? [{ file, entry, index }] : []) : []);
  if (!selected.length) return;
  let produced = false;
  await operation('Decrypting selected files', async () => {
    let completed = 0; let firstResult; const errors = [];
    const totalBytes = selected.reduce((sum, item) => sum + item.entry.size, 0); let processedBytes = 0;
    for (const { file, entry, index } of selected) {
      checkCancelled(); progress(`Decrypting file ${completed + errors.length + 1} of ${selected.length}`, contentProgress(processedBytes, totalBytes, { phase: 'Starting' })); file.error = null;
      try {
        const existing = state.plain.find(item => item.sourceId === file.id && item.sourceIndex === index);
        if (existing) { state.encryptedSelection.delete(fileKey(file, index)); continue; }
        if (state.plain.length >= MAX_ENTRIES) throw new Error('The workspace supports up to 10,000 plaintext entries. Remove some files and retry.');

        const blob = await rpc('decrypt', { id: file.id, index }, p => progress(`Decrypting file ${completed + errors.length + 1} of ${selected.length}: ${basename(entry.path)}`, contentProgress(processedBytes, totalBytes, p)));
        const result = { id: crypto.randomUUID(), path: entry.path, blob, type: entry.type, lastModified: entry.lastModified, origin: 'decrypted', location: 'results',
          group: file.manifest.kind === 'folder' ? file.id : null, rootName: file.manifest.name, sourceId: file.id, sourceIndex: index };
        if (!produced) { state.resultsQuery = ''; $('results-search').value = ''; }
        state.plain.push(result);
        if (!firstResult && filterResults([result], state.resultsQuery).length) { firstResult = result; state.resultsSelection.clear(); state.resultsSelection.add(result.id); }
        file.decrypted ??= new Set(); file.decrypted.add(index);
        state.encryptedSelection.delete(fileKey(file, index));
        if (file.decrypted.size === file.manifest.entries.length) {
          state.encrypted = state.encrypted.filter(item => item !== file);
          worker.postMessage({ action: 'release', payload: { id: file.id } });
        }
        completed++; produced = true; render();
        if (firstResult === result) previewFile(result);
      } catch (error) {
        if (error.code === 'AbortError' || error.name === 'AbortError') throw error;
        file.error = error.message; errors.push(`${entry.path}: ${error.message}`);
      } finally {
        processedBytes += entry.size;
      }
    }
    recordFailures('Decryption', errors);
    message(`${completed} ${completed === 1 ? 'file decrypted' : 'files decrypted'}.${errors.length ? ` ${errors.length} failed: ${errors.slice(0, 3).join(' ')}` : ''}`, errors.length > 0);
  });
  if (produced) revealResults('results-pane');
}
let previewGeneration = 0; let disposePreview; let previewFileId;
function closePreview() {
  previewGeneration++; previewFileId = null; disposePreview?.(); disposePreview = null; $('preview-dialog').close(); $('preview-content').replaceChildren();
  $('inline-preview-content').replaceChildren(element('p', '', 'Select a decrypted file to preview it.'));
  $('inline-preview-title').textContent = 'Preview'; $('inline-preview-caption').textContent = ''; $('close-inline-preview').hidden = true;
  if (state.previewURL) URL.revokeObjectURL(state.previewURL); state.previewURL = null;
}
async function previewUnlockedVideo(file, item, type) {
  if (state.busy) return;
  closePreview();
  const controller = new AbortController();
  const { signal } = controller;
  const dialog = $('preview-dialog');
  const content = $('preview-content');
  const caption = $('preview-caption');
  const video = element('video');
  disposePreview = () => {
    controller.abort();
    video.removeAttribute('src');
    video.load();
  };
  $('preview-title').textContent = basename(item.path);
  caption.textContent = 'Starting on-demand preview…';
  dialog.showModal();
  function showError(message) {
    if (signal.aborted) return;
    caption.textContent = '';
    content.replaceChildren(element('p', 'preview-error', message));
    disposePreview();
    disposePreview = undefined;
  }
  try {
    const url = await openVideoPreview(worker, { id: file.id, index: item.index, type }, signal,
      error => showError(`On-demand preview failed. ${error}`));
    if (signal.aborted) return;
    video.controls = true;
    video.preload = 'metadata';
    video.onerror = () => showError(video.error?.message
      ? `On-demand playback failed. ${video.error.message}`
      : 'The browser could not play this video.');
    const updateMetadata = () => {
      if (!signal.aborted) caption.textContent = ['On-demand preview', formatSize(item.size), formatVideoDuration(video.duration)].filter(Boolean).join(' · ');
    };
    video.onloadedmetadata = video.ondurationchange = updateMetadata;
    content.replaceChildren(video);
    video.src = url;
  } catch (error) {
    showError(error.message);
  }
}
async function previewFile(file) {
  closePreview(); previewFileId = file.id; const generation = previewGeneration;
  const active = () => generation === previewGeneration;
  const inline = file.location === 'results';
  const title = $(inline ? 'inline-preview-title' : 'preview-title');
  const caption = $(inline ? 'inline-preview-caption' : 'preview-caption');
  const content = $(inline ? 'inline-preview-content' : 'preview-content');
  const failPreview = text => {
    if (!active()) return;
    const box = element('div', 'preview-error');
    const button = element('button', 'secondary-button', 'Download original'); button.type = 'button';
    button.onclick = () => downloads.write({ blob: file.blob, name: basename(file.path) });
    box.append(element('p', '', text), button); content.replaceChildren(box); caption.textContent = '';
  };
  content.replaceChildren(element('p', '', 'Loading preview…')); title.textContent = basename(file.path);
  caption.textContent = 'Detecting file format…';
  if (inline) $('close-inline-preview').hidden = false; else $('preview-dialog').showModal();
  try {
    const renderer = await detectPreview(file.blob); if (!active()) return;
    content.replaceChildren();
    if (renderer.kind === 'text') {
      const text = await file.blob.slice(0, 1024 * 1024).text(); if (!active()) return;
      content.append(element('pre', '', text || '(Empty text file)'));
      caption.textContent = file.blob.size > 1024 * 1024 ? 'Showing the first 1 MiB. Download for the complete file.' : 'Text preview';
    } else if (renderer.kind === 'pdf' && file.blob.size > 32 * 1024 * 1024) {
      failPreview('This PDF is too large for the inline viewer. Download the file and open it in a PDF viewer.');
    } else if (renderer.kind === 'pdf') {
      caption.textContent = 'Loading PDF…';
      const preview = createPdfPreview(file.blob, content, { active, onStatus: text => { if (active()) caption.textContent = text; } });
      disposePreview = preview.destroy;
      await preview.ready;
    } else if (renderer.kind === 'unsupported') {
      failPreview('Preview is not available for this file type.');
    } else {
      state.previewURL = URL.createObjectURL(file.blob.slice(0, file.blob.size, renderer.type));
      const node = element(renderer.kind === 'image' ? 'img' : 'video');
      node.onerror = () => failPreview('Your browser could not display this file. It may be damaged or use an unsupported format.');
      if (renderer.kind === 'image') { node.alt = basename(file.path); node.onload = () => { if (active()) caption.textContent = `${renderer.type} · ${formatSize(file.blob.size)}`; }; }
      else {
        node.controls = true; node.preload = 'metadata';
        const updateMetadata = () => {
          if (!active()) return;
          const duration = formatVideoDuration(node.duration);
          caption.textContent = [renderer.type, formatSize(file.blob.size), duration].filter(Boolean).join(' · ');
          if (!inline || !duration) return;
          showResultDuration(file, duration);
        };
        node.onloadedmetadata = node.ondurationchange = updateMetadata;
      }
      caption.textContent = 'Loading preview…'; node.src = state.previewURL; content.append(node);
    }
  } catch (error) { failPreview(`This file could not be previewed${error.message ? `: ${error.message}` : '.'}`); }
}
function clearWorkspace() {
  durationProbe?.controller.abort();
  storageRetryFiles.clear();
  encryptedSessionGeneration++;
  const oldSession = encryptedSessionPromise; encryptedSessionPromise = null;
  void oldSession?.then(session => session?.clear()).catch(() => {});
  clearTooltip.hide(); closePreview(); providerController?.abort(); providerController = null; drive.clear(); dropbox.clear(); onedrive.clear(); worker?.terminate();
  for (const { reject } of pending.values()) reject(new DOMException('Workspace cleared.', 'AbortError'));
  pending.clear(); state.plain = []; state.encrypted = []; state.groups = []; state.plainSelection.clear(); state.resultsSelection.clear(); state.encryptedSelection.clear(); state.anchors = {}; state.activeTab = 'encrypt'; state.resultsQuery = ''; $('results-search').value = ''; state.encryptedQuery = ''; $('encrypted-search').value = ''; state.descending = false; state.failures = []; receipts.clear();
  state.busy = false; state.cancelled = true; $('operation').hidden = true; clearNotification();
  for (const id of ['encrypt-password', 'confirm-password', 'unlock-password']) { $(id).value = ''; $(id).setCustomValidity(''); }
}
function startWorker() {
  worker = new Worker(new URL('./crypto-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const task = pending.get(data.request); if (!task) return;
    if (data.progress) { task.onProgress?.(data.progress); return; }
    pending.delete(data.request);
    if (data.error) task.reject(Object.assign(new Error(data.error.message), { code: data.error.code })); else task.resolve(data.result);
  };
  worker.onerror = () => {
    for (const task of pending.values()) task.reject(new Error('The encryption worker stopped. Please reload the application.'));
    pending.clear(); $('unsupported').hidden = false; $('workspace').hidden = true;
  };
}

const supported = window.isSecureContext && window.crypto?.subtle && window.crypto.randomUUID && window.Worker && window.Blob &&
  window.TextEncoder && window.TextDecoder && typeof ''.isWellFormed === 'function' && typeof HTMLDialogElement !== 'undefined';
if (!supported) { $('unsupported').hidden = false; $('workspace').hidden = true; }
else {
  try { startWorker(); } catch { $('unsupported').hidden = false; $('workspace').hidden = true; }
  render();
  void encryptedDirectory().catch(() => {});
  $('confirm-password').oninput = () => $('confirm-password').setCustomValidity('');
  $('encrypt-password').oninput = () => $('confirm-password').setCustomValidity('');
  $('file-input').onchange = event => { intake(event.target.files); event.target.value = ''; };
  $('drop-zone').onclick = () => { if (!state.busy) $('file-input').click(); };
  $('drop-zone').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!state.busy) $('file-input').click(); } };
  $('drop-zone').ondragover = event => { event.preventDefault(); if (!state.busy) $('drop-zone').classList.add('dragging'); };
  $('drop-zone').ondragleave = () => $('drop-zone').classList.remove('dragging');
  $('drop-zone').ondrop = event => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); intake(event.dataTransfer.files); };
  document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
  $('add-files').onclick = () => $('file-input').click();
  $('results-search').oninput = event => {
    state.resultsQuery = event.target.value;
    const visible = new Set(allKeys('results'));
    for (const key of state.resultsSelection) if (!visible.has(key)) state.resultsSelection.delete(key);
    if (previewFileId && !visible.has(previewFileId)) closePreview();
    renderPlain('results'); updateControls();
  };
  $('clear-results-search').onclick = () => { $('results-search').value = ''; $('results-search').dispatchEvent(new Event('input')); $('results-search').focus(); };
  $('encrypted-search').oninput = event => { state.encryptedQuery = event.target.value; state.encryptedSelection.clear(); renderEncrypted(); updateControls(); };
  $('clear-encrypted-search').onclick = () => { $('encrypted-search').value = ''; $('encrypted-search').dispatchEvent(new Event('input')); $('encrypted-search').focus(); };
  $('sort-encrypted').onclick = () => { state.descending = !state.descending; renderEncrypted(); updateControls(); };
  $('clear-failures').onclick = () => { state.failures = []; renderFailures(); };
  $('download-selected').onclick = () => {
    const selected = filesFor('results').filter(file => state.resultsSelection.has(file.id));
    if (!selected.length || state.busy) return;
    operation('Downloading selected files', async () => {
      for (const file of selected) { checkCancelled(); await downloads.write({ blob: file.blob, name: basename(file.path) }); }
      message(`Download requested for ${selected.length} files. Check your browser downloads.`);
    });
  };
  $('results-select-all').onchange = event => selectAll('results', event.target.checked);
  for (const name of ['encrypt', 'decrypt']) {
    $(`${name}-tab`).onclick = () => setActiveTab(name);
    $(`${name}-tab`).onkeydown = event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 'encrypt' : event.key === 'End' ? 'decrypt' : name === 'encrypt' ? 'decrypt' : 'encrypt'; setActiveTab(next, true);
      }
    };
  }
  $('import-drive').onclick = importDrive;
  $('import-dropbox').onclick = importDropbox;
  $('import-onedrive').onclick = () => importProvider(onedrive, 'OneDrive', 'OneDrive');
  $('disconnect-drive').onclick = () => { drive.clear(); updateControls(); message('Google Drive disconnected from this tab.'); };
  $('plain-select-all').onchange = event => selectAll('plain', event.target.checked);
  $('encrypted-select-all').onchange = event => selectAll('encrypted', event.target.checked);
  $('encrypt-form').onsubmit = encryptSelected; $('unlock-form').onsubmit = unlockFiles; $('decrypt-button').onclick = decryptSelected;
  $('as-folder').onchange = event => { $('folder-name-label').hidden = !event.target.checked; };
  $('change-password').onclick = () => {
    const selected = filesFor('results').filter(file => state.resultsSelection.has(file.id));
    if (!selected.length || state.busy) return;
    const moving = selected;
    if (durationProbe && moving.includes(durationProbe.file)) durationProbe.controller.abort();
    closePreview(); state.plainSelection.clear();
    for (const file of moving) { file.location = 'encrypt'; state.plainSelection.add(file.id); state.resultsSelection.delete(file.id); }
    setActiveTab('encrypt'); render();
    message('Choose a new password for these decrypted files. Save the new outputs, then delete old encrypted copies yourself.');
    $('encrypt-password').focus();
  };
  $('cancel-button').onclick = () => { state.cancelled = true; providerController?.abort(); if (state.request) worker.postMessage({ action: 'cancel', payload: { request: state.request } }); };
  $('clear-button').onclick = () => {
    if (!confirm('Clear all files, unlocked names, and encrypted outputs from this tab? Download anything you want to keep first.')) return;
    clearWorkspace(); startWorker(); render(); message('Workspace cleared. Your source files and saved downloads are untouched.');
  };
  for (const button of document.querySelectorAll('.password-toggle')) button.onclick = () => { const input = $(button.dataset.for); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; button.textContent = show ? 'Hide' : 'Show'; button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${button.dataset.for.startsWith('encrypt') ? 'encryption' : 'decryption'} password`); };
  window.addEventListener('pagehide', () => { clearWorkspace(); $('about-dialog').close(); render(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { clearWorkspace(); startWorker(); render(); } });
}
$('close-preview').onclick = closePreview;
$('close-inline-preview').onclick = closePreview;
$('preview-dialog').addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
$('about-button').onclick = () => $('about-dialog').showModal(); $('close-about').onclick = () => $('about-dialog').close();

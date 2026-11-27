import { filterResults } from './file-search.js';
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareNames(a, b) { return names.compare(a.path || a.name, b.path || b.name); }
export function unlockedEntries(file, query = '', descending = false) {
  if (!file.manifest) return [];
  const entries = file.manifest.entries.map((entry, index) => ({ ...entry, index,
    rootName: file.manifest.name, group: file.manifest.kind === 'folder' })).filter(entry => !file.decrypted?.has(entry.index));
  return filterResults(entries, query).sort((a, b) => compareNames(a, b) * (descending ? -1 : 1));
}
export function batchProgress(index, total, progress = {}) {
  const fraction = progress.total > 0 ? Math.max(0, Math.min(1, progress.done / progress.total)) : 0;
  return { ...progress, total: 1000, done: 1000 * (index + fraction) / Math.max(1, total) };
}
export function isDevelopmentHost(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || hostname === '::1' || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
}
export function contentProgress(completedBytes, totalBytes, progress = {}) {
  const done = Math.max(0, Math.min(totalBytes, completedBytes + (progress.total > 0 ? progress.done : 0)));
  return { ...progress, total: totalBytes, done, unit: 'bytes', indeterminate: !progress.total && !progress.finalizing };
}

import { encrypt } from '/lib/format.js';
import { pngFixture, pdfFixture } from './preview-fixtures.js';
import { GOOGLE_DRIVE_CONFIG } from '/drive-config.js';
import { isDriveConfigured } from '/lib/google-drive.js';
import { DROPBOX_CONFIG } from '/dropbox-config.js';
import { isDropboxConfigured } from '/lib/dropbox.js';

const results = document.getElementById('results'); let passed = 0; let failed = 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function waitFor(predicate, label, timeout = 15000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
}
async function test(name, callback) {
  const result = document.createElement('li'); result.textContent = `${name} …`; results.append(result);
  try { await callback(); result.textContent = `PASS — ${name}`; result.className = 'pass'; passed++; }
  catch (error) { result.textContent = `FAIL — ${name}: ${error.message}`; result.className = 'fail'; failed++; }
  document.getElementById('summary').textContent = `${passed} passed, ${failed} failed · running`;
}
function click(win, target, modifiers = {}) { target.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers })); }
function fill(win, input, value) { input.value = value; input.dispatchEvent(new win.Event('input', { bubbles: true })); }
function submit(win, form) { form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); }
async function loadFrame(width) {
  const frame = document.createElement('iframe'); frame.width = width; frame.title = `${width}px test viewport`; frame.src = '/';
  document.getElementById('fixture').replaceChildren(frame);
  await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; });
  const win = frame.contentWindow; const doc = win.document;
  await waitFor(() => doc.querySelector('#plain-list .empty-state'), 'workspace initialization');
  const id = name => doc.getElementById(name);
  const idle = () => waitFor(() => id('operation').hidden, 'operation completion');
  const importFiles = async files => {
    const transfer = new win.DataTransfer(); for (const file of files) transfer.items.add(file);
    id('file-input').files = transfer.files;
    id('file-input').dispatchEvent(new win.Event('change', { bubbles: true }));
    await idle();
  };
  return { frame, win, doc, id, idle, importFiles };
}
const firstPassword = 'vacation secret phrase';
const makeEfs = async (name, contents, password) => encrypt([{ path: name, blob: new Blob([contents]), type: 'text/plain', lastModified: 0 }], password);

for (const width of [1280, 390, 320]) {
  let app; let downloaded;
  await test(`${width}px: workspace starts empty without horizontal overflow`, async () => {
    app = await loadFrame(width);
    assert(app.doc.documentElement.scrollWidth <= width, `Page overflow: ${app.doc.documentElement.scrollWidth} > ${width}`);
    assert(app.id('plain-count').textContent === '0' && app.id('encrypted-count').textContent === '0', 'Workspace not empty');
    assert(!app.id('import-folder') && !app.id('folder-input'), 'Folder upload control returned');
    assert(!app.doc.querySelector('[role=listbox]'), 'Invalid listbox semantics returned');
    assert(app.id('plain-list').getAttribute('role') === 'group', 'File container must use group semantics');
    assert(!app.doc.querySelector('.privacy-pill'), 'Local processing indicator returned');
    assert(!app.doc.querySelector('.window-titlebar, .window-dots, .site-footer'), 'Decorative chrome or footer returned');
    assert(!app.id('encrypt-view').hidden && app.id('decrypt-view').hidden, 'Encrypt should be the initial tab');
    assert(app.id('file-flow').dataset.mode === 'encrypt' && app.id('file-flow').firstElementChild.classList.contains('flow-files'), 'Encrypt diagram direction incorrect');
    const guide = app.doc.querySelector('.flow-vault');
    assert(guide.getAttribute('href') === '/efs' && guide.target === '_blank' && guide.rel.includes('noopener'), 'Format guide must preserve the workspace in a separate tab');
    app.id('encrypt-tab').dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert(!app.id('decrypt-view').hidden && app.id('encrypt-view').hidden && app.doc.activeElement === app.id('decrypt-tab'), 'Keyboard tab switching failed');
    assert(app.id('file-flow').dataset.mode === 'decrypt' && app.id('file-flow').firstElementChild.classList.contains('flow-vault'), 'Decrypt diagram did not reverse');
    assert(app.id('flow-action').textContent === 'Unlock, then decrypt', 'Decrypt diagram action incorrect');
    click(app.win, app.id('encrypt-tab'));
    assert(app.doc.querySelectorAll('#encrypt-view .column-headings').length === 1, 'File-list columns missing');
  });
  if (!app) continue;
  const { win, doc, id, idle, importFiles } = app;
  const revealed = [];
  win.HTMLElement.prototype.scrollIntoView = function(options) { revealed.push({ id: this.id, options }); };
  await test(`${width}px: unconfigured Drive leaves local imports available`, async () => {
    if (isDriveConfigured(GOOGLE_DRIVE_CONFIG)) return; // Never trigger real OAuth from synthetic tests.
    click(win, id('import-drive'));
    assert(id('messages').textContent.includes('not configured'), 'Missing Google configuration was not explained');
    assert(!doc.querySelector('script[src^="https://accounts.google.com"], script[src^="https://apis.google.com"]'), 'Google loaded without configuration');
    assert(!id('add-files').disabled && !id('import-folder'), 'Local import was disabled');
  });
  await test(`${width}px: unconfigured Dropbox leaves local imports available`, async () => {
    if (isDropboxConfigured(DROPBOX_CONFIG)) return;
    click(win, id('import-dropbox'));
    assert(id('messages').textContent.includes('not configured'), 'Missing Dropbox configuration was not explained');
    assert(!doc.getElementById('dropboxjs'), 'Dropbox loaded without configuration');
    assert(!id('add-files').disabled && !id('import-folder'), 'Local import was disabled');
  });
  await test(`${width}px: clear workspace uses an accessible icon and delayed tooltip`, async () => {
    assert(id('clear-button').getAttribute('aria-label') === 'Clear workspace', 'Clear action lacks an accessible name');
    assert(id('clear-button').querySelector('img') && !id('clear-button').textContent.trim(), 'Clear action should be icon-only');
    id('clear-button').focus();
    await new Promise(resolve => setTimeout(resolve, 300)); assert(id('clear-workspace-tooltip').hidden, 'Tooltip appeared too early');
    await waitFor(() => !id('clear-workspace-tooltip').hidden, 'one-second tooltip');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(id('clear-workspace-tooltip').hidden, 'Escape did not dismiss the tooltip');
    id('clear-button').blur();
  });
  await test(`${width}px: imports, provenance, shift and keyboard selection`, async () => {
    await importFiles(['alpha.txt', 'beta.txt', 'gamma.txt'].map(name => new win.File([`Hello ${name}`], name, { type: 'text/plain' })));
    assert(id('plain-count').textContent === '3', 'Expected three files');
    assert([...id('plain-list').querySelectorAll('.badge')].every(node => node.textContent === 'Imported'), 'Imported origin missing');
    let rows = [...id('plain-list').querySelectorAll('[data-key]')];
    click(win, rows[0]); click(win, rows[2], { shiftKey: true });
    assert(id('plain-list').querySelectorAll('[data-selected="true"]').length === 3, 'Range selection failed');
    click(win, rows[1], { ctrlKey: true });
    assert(id('plain-list').querySelectorAll('[data-selected="true"]').length === 2, 'Toggle selection failed');
    rows[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    assert(id('plain-list').querySelectorAll('[data-selected="true"]').length === 3, 'Keyboard select all failed');
  });
  await test(`${width}px: text preview is inline and does not execute markup`, async () => {
    await importFiles([new win.File(['<img src=x onerror="window.previewAttack=true">'], 'markup.html', { type: 'text/html' })]);
    click(win, doc.querySelector('[aria-label="Preview markup.html"]'));
    await waitFor(() => id('preview-content').querySelector('pre'), 'text preview');
    assert(!win.previewAttack && !id('preview-content').querySelector('img'), 'Markup was interpreted');
    click(win, id('close-preview'));
    assert(!id('preview-dialog').open && !id('preview-content').children.length, 'Preview not released');
    click(win, doc.querySelector('[aria-label="Remove markup.html"]'));
  });
  await test(`${width}px: encrypt folder, remove plaintext, rename and export`, async () => {
    fill(win, id('encrypt-password'), firstPassword); fill(win, id('confirm-password'), firstPassword);
    id('as-folder').checked = true; id('as-folder').dispatchEvent(new win.Event('change'));
    fill(win, id('folder-name'), 'Vacation'); submit(win, id('encrypt-form')); await idle();
    await waitFor(() => revealed.some(call => call.id === 'export-section'), 'encrypted output revealed');
    assert(id('plain-count').textContent === '0', 'Plaintext remained after success');
    assert(id('encrypted-count').textContent === '0', 'New output incorrectly entered imported encrypted panel');
    assert(id('export-count').textContent === '1', 'Folder output missing');
    assert(id('export-list').querySelector('.output-source').textContent.includes('Vacation (3 files)'), 'Export source identification missing');
    assert(id('export-list').querySelector('[aria-label="Encryption complete"]'), 'Encryption success check missing');
    const name = id('export-list').querySelector('input');
    assert(/^[0-9a-f-]{36}\.efs$/.test(name.value), 'Default output is not UUID-based');
    fill(win, name, 'renamed'); name.dispatchEvent(new win.Event('change'));
    assert(name.value === 'renamed.efs', 'Rename did not preserve extension');
    const createURL = win.URL.createObjectURL.bind(win.URL);
    win.URL.createObjectURL = blob => { downloaded = blob; return createURL(blob); };
    doc.addEventListener('click', event => { if (event.target.closest('a[download]')) event.preventDefault(); });
    click(win, id('export-list').querySelector('.export-file-button'));
    await waitFor(() => downloaded, 'captured browser download'); await idle();
    assert(id('export-count').textContent === '0' && id('export-section').hidden, 'Exported output did not leave the export list');
    assert(!id('download-receipts').hidden && id('receipts-list').textContent.includes('renamed.efs'), 'Download retry receipt missing');
    click(win, id('receipts-list').querySelector('.secondary-button')); await idle();
    assert(id('export-count').textContent === '0', 'Retry restored output in export list');
    assert(!id('encrypt-password').value && !id('confirm-password').value, 'Password inputs retained plaintext');
  });
  await test(`${width}px: header routing, mixed passwords and name privacy`, async () => {
    assert(downloaded, 'No exported folder');
    const other = await makeEfs('business.txt', 'business data', 'different password');
    await importFiles([new win.File([downloaded], 'misleading.txt'), new win.File([other], 'other.efs')]);
    assert(id('encrypted-count').textContent === '2', 'Header-based routing failed');
    assert(!id('decrypt-view').hidden && id('encrypt-view').hidden, 'Encrypted imports did not open Decrypt');
    assert(!id('encrypted-list').textContent.includes('Vacation') && !id('encrypted-list').textContent.includes('business.txt'), 'Locked metadata leaked');
    fill(win, id('unlock-password'), firstPassword); submit(win, id('unlock-form')); await idle();
    assert(id('encrypted-list').textContent.includes('Vacation'), 'Matching folder name not revealed');
    assert(!id('encrypted-list').textContent.includes('business.txt'), 'Nonmatching name revealed');
    assert(id('plain-count').textContent === '0', 'Unlock automatically decrypted contents');
    assert(id('encrypted-list').firstElementChild.matches('.ready-container'), 'Ready entry did not sort first');
  });
  await test(`${width}px: selectively decrypt and preview a folder entry`, async () => {
    const rows = [...id('encrypted-list').querySelectorAll('[data-key]')]; assert(rows.length === 3, 'Expected three folder entries');
    click(win, rows[1]); click(win, id('decrypt-button')); await idle();
    await waitFor(() => revealed.some(call => call.id === 'results-pane'), 'decrypted output revealed');
    await waitFor(() => id('inline-preview-content').textContent.includes('Hello beta.txt'), 'automatic preview after decryption');
    assert(id('results-count').textContent === '1' && id('plain-count').textContent === '0', 'Decrypted files were not isolated in the results pane');
    assert(id('results-list').querySelector('details'), 'Decrypted folder not expandable');
    assert(id('results-list').querySelector('.badge.decrypted'), 'Decrypted provenance missing');
    assert(id('results-list').textContent.includes('beta.txt'), 'Wrong selected entry');
    assert(!id('encrypted-list').textContent.includes('beta.txt'), 'Decrypted entry remained in the upper list');
    assert(id('encrypted-list').querySelectorAll('[data-key]').length === 2, 'Remaining folder entries were not preserved');
    assert(id('ready-count').textContent === '2 unlocked · 1 locked', 'Ready count includes moved entries');
    assert(!id('download-selected').disabled && id('download-selected').textContent.includes('(1)'), 'Selected download scope missing');
    click(win, id('download-selected')); await idle();
    assert(id('results-count').textContent === '1', 'Downloading removed decrypted file');
    fill(win, id('encrypted-search'), 'gamma');
    assert(id('encrypted-list').querySelectorAll('[data-key]').length === 1, 'Unlocked search failed');
    click(win, id('encrypted-select-all'));
    assert(id('decrypt-button').textContent.includes('(1)'), 'Filtered selection included hidden files');
    click(win, id('clear-encrypted-search'));
    assert(id('encrypted-list').querySelectorAll('[data-key]').length === 2, 'Clearing unlocked search failed');
    assert(id('results-list').getBoundingClientRect().top > id('encrypted-list').getBoundingClientRect().bottom, 'Results should be below encrypted sources');
    click(win, doc.querySelector('[aria-label="Preview beta.txt"]'));
    await waitFor(() => id('inline-preview-content').textContent.includes('Hello beta.txt'), 'decrypted inline preview');
    assert(!id('preview-dialog').open, 'Decrypted preview should be inline');
    click(win, id('close-inline-preview'));
    click(win, id('results-list').querySelector('[data-key]'));
    await waitFor(() => id('inline-preview-content').textContent.includes('Hello beta.txt'), 'row selection preview');
    assert(doc.documentElement.scrollWidth <= width, 'Decrypt layout overflows horizontally');
    if (width < 700) assert(id('inline-preview-content').getBoundingClientRect().top > id('results-list').getBoundingClientRect().bottom, 'Mobile preview did not stack below results');
  });
  await test(`${width}px: change-password action selects decrypted data`, async () => {
    click(win, id('change-password'));
    assert(doc.activeElement === id('encrypt-password'), 'New-password input not focused');
    assert(!id('encrypt-view').hidden && id('results-count').textContent === '0', 'Change password did not move selected results into Encrypt');
    assert(id('plain-list').querySelectorAll('[data-selected="true"]').length === 1, 'Decrypted files not selected');
    assert(id('messages').textContent.includes('delete old encrypted copies'), 'Old copy responsibility missing');
  });
  await test(`${width}px: completed folders and files leave the encrypted section`, async () => {
    click(win, id('decrypt-tab'));
    fill(win, id('results-search'), 'does-not-match');
    click(win, id('encrypted-select-all')); click(win, id('decrypt-button')); await idle();
    assert(id('results-search').value === '', 'Stale search hid new decrypted results');
    assert(id('results-count').textContent === '2', 'Remaining folder entries did not move below');
    assert(id('encrypted-count').textContent === '1', 'Completed folder container remained above');
    assert(!id('encrypted-list').textContent.includes('Vacation'), 'Completed folder tree remained above');
    click(win, doc.querySelector('[aria-label="Remove alpha.txt"]'));
    assert(!id('encrypted-list').textContent.includes('alpha.txt'), 'Removing a result resurrected its encrypted entry');
    const single = await makeEfs('single.txt', 'move this file', firstPassword);
    await importFiles([new win.File([single], 'single.efs')]);
    fill(win, id('unlock-password'), firstPassword); submit(win, id('unlock-form')); await idle();
    const row = [...id('encrypted-list').querySelectorAll('[data-key]')].find(node => node.textContent.includes('single.txt'));
    assert(row, 'Single-file name did not unlock'); click(win, row); click(win, id('decrypt-button')); await idle();
    assert(id('results-list').textContent.includes('single.txt'), 'Single file did not appear below');
    assert(!id('encrypted-list').textContent.includes('single.txt') && id('encrypted-count').textContent === '1', 'Single-file container remained above');
  });
  await test(`${width}px: search expands nested folder matches and restores results`, async () => {
    const folder = await encrypt([
      { path: 'albums/nested/dot.png', blob: pngFixture(), type: 'image/png', lastModified: 0 },
      { path: 'docs/check.pdf', blob: pdfFixture(), type: 'application/pdf', lastModified: 0 },
      { path: 'notes/readme.txt', blob: new Blob(['Searchable notes']), type: 'text/plain', lastModified: 0 },
      { path: 'broken.png', blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]), type: 'image/png', lastModified: 0 }
    ], firstPassword, { kind: 'folder', name: 'Preview fixtures' });
    await importFiles([new win.File([folder], 'preview.efs')]);
    fill(win, id('unlock-password'), firstPassword); submit(win, id('unlock-form')); await idle();
    click(win, id('encrypted-select-all')); click(win, id('decrypt-button')); await idle();
    await waitFor(() => id('inline-preview-content').querySelector('img')?.naturalWidth > 0, 'automatic decoded image preview');
    const before = Number(id('results-count').textContent);
    const search = query => fill(win, id('results-search'), query);
    search('nested/dot');
    assert(id('results-list').querySelectorAll('[data-key]').length === 1, 'Search did not filter nested filenames');
    assert([...id('results-list').querySelectorAll('details')].every(node => node.open), 'Matching ancestor folders did not expand');
    assert(id('results-list').textContent.includes('albums') && id('results-list').textContent.includes('nested'), 'Search lost the folder tree');
    search('PREVIEW FIXTURES');
    assert(id('results-list').querySelectorAll('[data-key]').length === 4, 'Root folder search missed descendants');
    search('no matching file here');
    assert(id('results-list').textContent.includes('No matching files'), 'Empty search state missing');
    click(win, id('clear-results-search'));
    assert(id('results-list').querySelectorAll('[data-key]').length === before, 'Clearing search did not restore results');
    assert(doc.documentElement.scrollWidth <= width, 'Search controls overflow');
  });
  await test(`${width}px: PDF preview paints pages and checkbox selection opens it`, async () => {
    fill(win, id('results-search'), 'check.pdf');
    const checkbox = id('results-list').querySelector('input[type=checkbox]'); click(win, checkbox);
    await waitFor(() => id('inline-preview-content').querySelector('canvas')?.dataset.rendered === 'true', 'rendered PDF page');
    const canvas = id('inline-preview-content').querySelector('canvas');
    let pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    assert(pixel[2] > pixel[0], 'PDF page 1 was blank or incorrect');
    click(win, doc.querySelector('[aria-label="Next PDF page"]'));
    await waitFor(() => canvas.dataset.rendered === 'true' && doc.querySelector('.pdf-navigation').textContent.includes('Page 2'), 'second PDF page');
    pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    assert(pixel[0] > pixel[2], 'PDF page 2 was blank or incorrect');
    assert(!id('inline-preview-content').querySelector('iframe'), 'PDF should not use a blocked native viewer');
  });
  await test(`${width}px: broken previews show a usable fallback`, async () => {
    fill(win, id('results-search'), 'broken.png');
    click(win, id('results-list').querySelector('[data-key]'));
    await waitFor(() => id('inline-preview-content').querySelector('.preview-error'), 'failed image fallback');
    assert(id('inline-preview-content').textContent.includes('Download original'), 'Preview failure has no download action');
    click(win, id('clear-results-search'));
  });
  await test(`${width}px: malformed imports fail independently of ordinary files`, async () => {
    const invalid = new Uint8Array(await downloaded.arrayBuffer()); invalid[8] = 1;
    const before = Number(id('plain-count').textContent);
    await importFiles([new win.File([invalid], 'unsupported.efs'), new win.File(['still works'], 'healthy.txt', { type: 'text/plain' })]);
    assert(Number(id('plain-count').textContent) === before + 1, 'A bad import stopped a healthy file');
    assert(id('messages').textContent.includes('not supported'), 'Unsupported container error missing');
  });
  await test(`${width}px: cancellation preserves inputs for retry`, async () => {
    click(win, doc.querySelector('[aria-label="Preview healthy.txt"]').closest('[data-key]'));
    fill(win, id('encrypt-password'), firstPassword); fill(win, id('confirm-password'), firstPassword);
    id('as-folder').checked = false;
    const before = id('plain-count').textContent;
    submit(win, id('encrypt-form')); click(win, id('cancel-button')); await idle();
    assert(id('plain-count').textContent === before, 'Cancelled encryption removed inputs');
    assert(id('messages').textContent.toLowerCase().includes('cancelled'), 'Cancellation message missing');
  });
  await test(`${width}px: import failures survive toast dismissal`, async () => {
    await importFiles([new win.File(['bad'], '../invalid.txt')]);
    assert(!id('failure-summary').hidden && id('failure-list').textContent.includes('invalid.txt'), 'Import failure details missing');
    click(win, id('messages').querySelector('button'));
    assert(!id('messages').children.length && !id('failure-summary').hidden, 'Toast dismissal discarded failure details');
    click(win, id('clear-failures'));
    assert(id('failure-summary').hidden, 'Failure dismissal did not clear summary');
  });
  await test(`${width}px: mixed import notification reports successfully routed counts`, async () => {
    const encrypted = await makeEfs('count-test.txt', 'encrypted', firstPassword);
    await importFiles([
      new win.File(['ordinary'], 'ordinary.efs'),
      new win.File([encrypted], 'misleading.txt'),
      new win.File(['invalid'], '../invalid-count.txt')
    ]);
    assert(id('messages').textContent.includes('2 files added · 1 to encrypt · 1 to decrypt'), 'Mixed import routing counts incorrect');
    assert(id('messages').textContent.includes('1 could not be added'), 'Failed import was counted as successful');
  });
  await test(`${width}px: lifecycle cleanup discards data and unlocked state`, async () => {
    win.dispatchEvent(new win.PageTransitionEvent('pagehide', { persisted: true }));
    win.dispatchEvent(new win.PageTransitionEvent('pageshow', { persisted: true }));
    assert(id('plain-count').textContent === '0' && id('results-count').textContent === '0', 'Plaintext survived lifecycle cleanup');
    assert(id('encrypted-count').textContent === '0' && id('export-count').textContent === '0', 'Container state survived lifecycle cleanup');
    assert(id('download-receipts').hidden && !id('receipts-list').children.length, 'Retry copies survived tab lifecycle');
    assert(id('failure-summary').hidden && !id('failure-list').children.length, 'Failure details survived tab lifecycle');
    assert(id('change-password').disabled && id('download-selected').disabled, 'Empty selection actions enabled');
    assert(!id('encrypt-password').value && !id('unlock-password').value, 'Password fields survived lifecycle cleanup');
  });
  await test(`${width}px: reload clears files, unlocked metadata and passwords`, async () => {
    const loaded = new Promise(resolve => app.frame.onload = resolve); app.frame.contentWindow.location.reload(); await loaded;
    await waitFor(() => app.frame.contentDocument.querySelector('#plain-list .empty-state'), 'reloaded workspace');
    assert(app.frame.contentDocument.getElementById('encrypted-count').textContent === '0', 'Encrypted state restored');
    assert(app.frame.contentDocument.getElementById('export-count').textContent === '0', 'Export state restored');
  });
}

await test('unsupported browser gets an explanation', async () => {
  const frame = document.createElement('iframe'); frame.title = 'Unsupported browser test';
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Unsupported-browser test did not report its state')); }, 10000);
    function receive(event) {
      if (event.source !== frame.contentWindow || event.data?.type !== 'unsupported-test') return;
      clearTimeout(timer); window.removeEventListener('message', receive); resolve(event.data.visible);
    }
    window.addEventListener('message', receive);
  });
  // Load the real UI with a fixture that removes Worker before importing the app.
  const html = await (await fetch('/')).text();
  frame.srcdoc = html.replaceAll('href="./', 'href="/').replaceAll('src="./', 'src="/').replace('src="/app.js"', 'src="/tests/unsupported-fixture.js"');
  document.getElementById('fixture').append(frame);
  assert(await reply, 'Unsupported browser was not declined'); frame.remove();
});

document.getElementById('summary').textContent = `${passed} passed, ${failed} failed · complete`;
document.documentElement.dataset.testStatus = failed ? 'failed' : 'passed';
